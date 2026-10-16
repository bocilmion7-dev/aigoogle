import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomBytes, generateKeyPairSync, createHash, createSign, createHmac } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { verifyMidtransNotification, normalizePublicKey, midtransSnapReady, tsWib } from "../src/billing/midtrans-snap.js";

let api: ReturnType<typeof createApp>;
let cookie = "";
let tenantId = "";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const pubB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

const ENV_BACKUP: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "BILLING_ENABLED",
  "MIDTRANS_SERVER_KEY",
  "MIDTRANS_CLIENT_ID",
  "MIDTRANS_CLIENT_SECRET",
  "MIDTRANS_MERCHANT_ID",
  "MIDTRANS_CHANNEL_ID",
  "MIDTRANS_MERCHANT_PRIVATE_KEY",
  "MIDTRANS_PUBLIC_KEY",
  "MIDTRANS_ENV",
  "MIDTRANS_PRO_PRICE",
] as const;

beforeAll(async () => {
  for (const k of ENV_KEYS) ENV_BACKUP[k] = process.env[k];
  process.env.BILLING_ENABLED = "1";
  process.env.MIDTRANS_SERVER_KEY = "srv-test";
  process.env.MIDTRANS_CLIENT_ID = "G1234325-SNAP";
  process.env.MIDTRANS_CLIENT_SECRET = "client-secret-test";
  process.env.MIDTRANS_MERCHANT_ID = "M801203800";
  process.env.MIDTRANS_CHANNEL_ID = "12345";
  process.env.MIDTRANS_MERCHANT_PRIVATE_KEY = privPem;
  process.env.MIDTRANS_PUBLIC_KEY = pubPem;
  process.env.MIDTRANS_ENV = "sandbox";
  process.env.MIDTRANS_PRO_PRICE = "49000";

  api = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `ms-${randomBytes(3).toString("hex")}`, name: "PT Midtrans", alias: "MT" },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({ data: { tenantId: tenant.id, key: "admin", name: "Admin" } });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      providerUserId: `msu-${randomBytes(3).toString("hex")}`,
      email: "midtrans@demo.local",
      name: "Midtrans",
      roleId: role.id,
    },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86400_000) } });
  cookie = `sid=${sid}`;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { tenantId } });
  await prisma.subscription.deleteMany({ where: { tenantId } });
  await prisma.waTopup.deleteMany({ where: { tenantId } });
  await prisma.waBalance.deleteMany({ where: { tenantId } });
  for (const k of ENV_KEYS) {
    const v = ENV_BACKUP[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await prisma.$disconnect();
});

describe("signature Midtrans BI-SNAP (unit)", () => {
  const path = "/v1.0/qr/qr-mpm-notify";
  const ts = "2026-10-15T10:00:00+07:00";
  const body = JSON.stringify({ originalPartnerReferenceNo: "sub-abc", latestTransactionStatus: "00" });

  function sign(method: string, p: string, b: string, t: string): string {
    const hash = createHash("sha256").update(b, "utf8").digest("hex").toLowerCase();
    const s = createSign("RSA-SHA256");
    s.update(`${method}:${p}:${hash}:${t}`);
    return s.sign(privPem, "base64");
  }

  it("signature benar → verify true; body/timestamp diganti → false", () => {
    const sig = sign("POST", path, body, ts);
    expect(verifyMidtransNotification(pubPem, "POST", path, body, ts, sig)).toBe(true);
    expect(verifyMidtransNotification(pubPem, "POST", path, body + " ", ts, sig)).toBe(false);
    expect(verifyMidtransNotification(pubPem, "POST", path, body, "2026-10-15T11:00:00+07:00", sig)).toBe(false);
    expect(verifyMidtransNotification(pubPem, "POST", path, body, ts, "")).toBe(false);
  });

  it("public key base64 DER polos → dinormalkan & verify tetap true", () => {
    const sig = sign("POST", path, body, ts);
    expect(normalizePublicKey(pubB64)).toContain("-----BEGIN PUBLIC KEY-----");
    expect(verifyMidtransNotification(pubB64, "POST", path, body, ts, sig)).toBe(true);
  });

  it("midtransSnapReady = true saat semua kredensial terisi", () => {
    expect(midtransSnapReady()).toBe(true);
  });
});

describe("subscribe & notifikasi QRIS Midtrans", () => {
  it("POST /billing/subscribe → generate QRIS (fetch di-stub) & balas qris", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/access-token/b2b")) {
        return new Response(
          JSON.stringify({
            responseCode: "2007300",
            responseMessage: "Successful",
            accessToken: "tok-abc",
            tokenType: "Bearer",
            expiresIn: "900",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          responseCode: "2004700",
          responseMessage: "Request has been processed successfully",
          referenceNo: "REF-123",
          partnerReferenceNo: "sub-abc",
          qrUrl: "https://merchants.sbx.midtrans.com/qr/abc.png",
          qrContent: "000201ISO",
          additionalInfo: { isStatic: false },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await request(api).post("/api/billing/subscribe").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.orderId).toMatch(/^sub-/);
    expect(r.body.amount).toBe(49000);
    expect(r.body.qris.qrUrl).toContain("qr/abc.png");

    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(String((init.headers as Record<string, string>)["Authorization"])).toBe("Bearer tok-abc");
    expect(String((init.headers as Record<string, string>)["X-PARTNER-ID"])).toBe("M801203800");
    expect(String((init.headers as Record<string, string>)["CHANNEL-ID"])).toBe("12345");
    expect(String((init.headers as Record<string, string>)["X-EXTERNAL-ID"])).toBe(r.body.orderId);
    const body = JSON.parse(String(init.body));
    expect(body.amount.value).toBe("49000.00");
    expect(body.additionalInfo.isStatic).toBe(false);

    const row = await prisma.payment.findUnique({ where: { orderId: r.body.orderId } });
    expect(row?.amount).toBe(49000);
    expect(row?.paymentMethod).toBe("qris");
  });

  it("notifikasi Midtrans: signature sah → payment settlement + subscription aktif (idempoten)", async () => {
    const payment = await prisma.payment.create({
      data: { tenantId, orderId: `sub-${randomBytes(8).toString("hex")}`, amount: 49000, status: "pending" },
    });
    const payload = {
      originalReferenceNo: "999",
      originalPartnerReferenceNo: payment.orderId,
      latestTransactionStatus: "00",
      transactionStatusDesc: "success",
      amount: { value: "49000.00", currency: "IDR" },
    };
    const raw = JSON.stringify(payload);
    const ts = "2026-10-15T12:00:00+07:00";
    const hash = createHash("sha256").update(raw, "utf8").digest("hex").toLowerCase();
    const s = createSign("RSA-SHA256");
    s.update(`POST:/v1.0/qr/qr-mpm-notify:${hash}:${ts}`);
    const sig = s.sign(privPem, "base64");

    const r1 = await request(api)
      .post("/v1.0/qr/qr-mpm-notify")
      .set("Content-Type", "application/json")
      .set("X-Timestamp", ts)
      .set("X-Signature", sig)
      .send(payload);
    expect(r1.status).toBe(200);
    expect(r1.body.responseCode).toBe("2005200");

    const p = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(p?.status).toBe("settlement");
    const sub = await prisma.subscription.findFirst({ where: { tenantId } });
    expect(sub?.plan).toBe("pro");
    expect(sub?.status).toBe("active");
    expect(sub?.expiresAt!.getTime()).toBeGreaterThan(Date.now());

    const r2 = await request(api)
      .post("/v1.0/qr/qr-mpm-notify")
      .set("Content-Type", "application/json")
      .set("X-Timestamp", ts)
      .set("X-Signature", sig)
      .send(payload);
    expect(r2.status).toBe(200);
    const subs = await prisma.subscription.findMany({ where: { tenantId } });
    expect(subs.length).toBe(1);
  });

  it("notifikasi signature salah → 401 & payment tetap pending", async () => {
    const payment = await prisma.payment.create({
      data: { tenantId, orderId: `sub-${randomBytes(8).toString("hex")}`, amount: 49000, status: "pending" },
    });
    const r = await request(api)
      .post("/v1.0/qr/qr-mpm-notify")
      .set("Content-Type", "application/json")
      .set("X-Timestamp", "2026-10-15T12:00:00+07:00")
      .set("X-Signature", Buffer.alloc(256).toString("base64"))
      .send({ originalPartnerReferenceNo: payment.orderId, latestTransactionStatus: "00" });
    expect(r.status).toBe(401);
    const p = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(p?.status).toBe("pending");
  });

  it("GET /billing/payment/:orderId → status polling", async () => {
    const payment = await prisma.payment.create({
      data: { tenantId, orderId: `sub-${randomBytes(8).toString("hex")}`, amount: 49000, status: "pending" },
    });
    const r = await request(api).get(`/api/billing/payment/${payment.orderId}`).set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "pending", settled: false, amount: 49000 });
  });

  it("POST /wa/topup provider=midtrans → buat QRIS BI-SNAP (fetch di-stub)", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/access-token/b2b")) {
        return new Response(
          JSON.stringify({ responseCode: "2007300", accessToken: "tok-mt", tokenType: "Bearer", expiresIn: "900" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          responseCode: "2004700",
          responseMessage: "Request has been processed successfully",
          referenceNo: "MTREF-123",
          partnerReferenceNo: "mt-abc",
          qrUrl: "https://merchants.sbx.midtrans.com/qr/mt.png",
          qrContent: "000201ISO",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await request(api).post("/api/wa/topup").set("Cookie", cookie).send({ amount: 10000, provider: "midtrans" });
    expect(r.status).toBe(200);
    expect(r.body.provider).toBe("midtrans");
    expect(r.body.qris.qrUrl).toContain("mt.png");
    expect(r.body.orderId).toMatch(/^mt-/);
    expect(r.body.credits).toBe(50);

    const row = await prisma.waTopup.findUnique({ where: { orderId: r.body.orderId } });
    expect(row?.paymentMethod).toBe("midtrans");
    expect(row?.providerRef).toBe("MTREF-123");
    await prisma.waTopup.delete({ where: { orderId: r.body.orderId } });
  });

  it("notifikasi Midtrans utk order mt- → waTopup settlement + saldo bertambah (idempoten)", async () => {
    const topup = await prisma.waTopup.create({
      data: { tenantId, orderId: `mt-${randomBytes(8).toString("hex")}`, amount: 6000, credits: 30 },
    });
    const payload = {
      originalReferenceNo: "999",
      originalPartnerReferenceNo: topup.orderId,
      latestTransactionStatus: "00",
      amount: { value: "6000.00", currency: "IDR" },
    };
    const raw = JSON.stringify(payload);
    const ts = "2026-10-15T13:00:00+07:00";
    const hash = createHash("sha256").update(raw, "utf8").digest("hex").toLowerCase();
    const s = createSign("RSA-SHA256");
    s.update(`POST:/v1.0/qr/qr-mpm-notify:${hash}:${ts}`);
    const sig = s.sign(privPem, "base64");

    const bal0 = await prisma.waBalance.findUnique({ where: { tenantId } });
    const r1 = await request(api)
      .post("/v1.0/qr/qr-mpm-notify")
      .set("Content-Type", "application/json")
      .set("X-Timestamp", ts)
      .set("X-Signature", sig)
      .send(payload);
    expect(r1.status).toBe(200);
    expect(r1.body.responseCode).toBe("2005200");

    const row = await prisma.waTopup.findUnique({ where: { orderId: topup.orderId } });
    expect(row?.status).toBe("settlement");
    const bal1 = await prisma.waBalance.findUnique({ where: { tenantId } });
    expect((bal1?.amount ?? 0) - (bal0?.amount ?? 0)).toBe(30);

    const r2 = await request(api)
      .post("/v1.0/qr/qr-mpm-notify")
      .set("Content-Type", "application/json")
      .set("X-Timestamp", ts)
      .set("X-Signature", sig)
      .send(payload);
    expect(r2.status).toBe(200);
    const bal2 = await prisma.waBalance.findUnique({ where: { tenantId } });
    expect(bal2?.amount).toBe(bal1?.amount);
  });
});
