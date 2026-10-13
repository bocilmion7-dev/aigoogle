import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomBytes, generateKeyPairSync, createHash, createSign } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { generateQris, verifyWinpayCallback, normalizePublicKey, winpayReady } from "../src/billing/winpay.js";

let api: ReturnType<typeof createApp>;
let cookie = "";
let tenantId = "";

const SETTING_KEYS = ["paymentProvider", "winpayEnv", "winpayClientId", "winpayPrivateKey", "winpayPublicKey"] as const;
let settingBackup: { key: string; value: string }[] = [];

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const pubB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

beforeAll(async () => {
  api = createApp();
  settingBackup = await prisma.appSetting.findMany({ where: { key: { in: [...SETTING_KEYS] } } });
  await prisma.appSetting.deleteMany({ where: { key: { in: [...SETTING_KEYS] } } });
  await prisma.appSetting.createMany({
    data: [
      { key: "paymentProvider", value: "winpay" },
      { key: "winpayPrivateKey", value: privPem },
      { key: "winpayPublicKey", value: pubPem },
    ],
  });
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `wp-${randomBytes(3).toString("hex")}`, name: "PT Winpay", alias: "WP" },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({ data: { tenantId: tenant.id, key: "admin", name: "Admin" } });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      providerUserId: `wpu-${randomBytes(3).toString("hex")}`,
      email: "winpay@demo.local",
      name: "Winpay",
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
  await prisma.waTopup.deleteMany({ where: { tenantId } });
  await prisma.appSetting.deleteMany({ where: { key: { in: [...SETTING_KEYS] } } });
  if (settingBackup.length) await prisma.appSetting.createMany({ data: settingBackup });
  await prisma.$disconnect();
});

describe("signature Winpay (unit)", () => {
  const path = "/v1.0/qr/qr-mpm-notify";
  const ts = "2026-10-13T10:00:00+07:00";
  const body = JSON.stringify({ originalPartnerReferenceNo: "wa-abc", latestTransactionStatus: "00" });

  function sign(method: string, p: string, b: string, t: string): string {
    const hash = createHash("sha256").update(b, "utf8").digest("hex").toLowerCase();
    const s = createSign("RSA-SHA256");
    s.update(`${method}:${p}:${hash}:${t}`);
    return s.sign(privPem, "base64");
  }

  it("signature benar → verify true; body/timestamp diganti → false", () => {
    const sig = sign("POST", path, body, ts);
    expect(verifyWinpayCallback(pubPem, "POST", path, body, ts, sig)).toBe(true);
    expect(verifyWinpayCallback(pubPem, "POST", path, body + " ", ts, sig)).toBe(false);
    expect(verifyWinpayCallback(pubPem, "POST", path, body, "2026-10-13T11:00:00+07:00", sig)).toBe(false);
    expect(verifyWinpayCallback(pubPem, "POST", path, body, ts, "")).toBe(false);
  });

  it("public key base64 DER polos → dinormalkan & verify tetap true", () => {
    const sig = sign("POST", path, body, ts);
    expect(normalizePublicKey(pubB64)).toContain("-----BEGIN PUBLIC KEY-----");
    expect(verifyWinpayCallback(pubB64, "POST", path, body, ts, sig)).toBe(true);
  });
});

describe("topup QRIS Winpay", () => {
  it("winpayReady = true dengan kunci merchant (client id + private key); provider winpay", async () => {
    expect(await winpayReady()).toBe(true);
  });

  it("POST /wa/topup → kirim generate ke Winpay (fetch di-stub) & balas qris", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          responseCode: "2004700",
          responseMessage: "Success",
          qrUrl: "https://snap.winpay.id/qr/abc.png",
          qrContent: "000201ISO",
          additionalInfo: { contractId: "qr-test-contract", expiredAt: "2026-10-13T10:15:00+07:00", isStatic: false },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await request(api).post("/api/wa/topup").set("Cookie", cookie).send({ amount: 10000 });
    expect(r.status).toBe(200);
    expect(r.body.provider).toBe("winpay");
    expect(r.body.qris.qrUrl).toContain("qr/abc.png");
    expect(r.body.credits).toBe(50);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String((init.headers as Record<string, string>)["X-PARTNER-ID"])).toHaveLength(36);

    const row = await prisma.waTopup.findUnique({ where: { orderId: r.body.orderId } });
    expect(row?.paymentMethod).toBe("winpay");
    expect(row?.providerRef).toBe("qr-test-contract");
  });

  it("Winpay menolak signature → 502 qris_gagal (pesan ramah di sisi web)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ responseCode: "4014700", responseMessage: "Invalid signature" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          })
      )
    );
    const r = await request(api).post("/api/wa/topup").set("Cookie", cookie).send({ amount: 2000 });
    expect(r.status).toBe(502);
    expect(r.body.error).toBe("qris_gagal");
  });

  it("GET /wa/topup/:orderId/status → settled=false, kredit & saldo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              responseCode: "2004700",
              qrUrl: "https://snap.winpay.id/qr/x.png",
              qrContent: "000201",
              additionalInfo: { contractId: "c2", expiredAt: "2026-10-13T10:15:00+07:00", isStatic: false },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
      )
    );
    const top = await request(api).post("/api/wa/topup").set("Cookie", cookie).send({ amount: 4000 });
    const st = await request(api).get(`/api/wa/topup/${top.body.orderId}/status`).set("Cookie", cookie);
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ status: "pending", settled: false, credits: 20 });
    expect(typeof st.body.balance).toBe("number");
  });

  it("notifikasi Winpay: signature sah → settlement + kredit masuk (idempoten)", async () => {
    const order = await prisma.waTopup.create({
      data: { tenantId, orderId: `wa-${randomBytes(8).toString("hex")}`, amount: 6000, credits: 30 },
    });
    const payload = {
      originalReferenceNo: "999",
      originalPartnerReferenceNo: order.orderId,
      latestTransactionStatus: "00",
      amount: { value: "6000.00", currency: "IDR" },
    };
    const raw = JSON.stringify(payload);
    const ts = "2026-10-13T12:00:00+07:00";
    const hash = createHash("sha256").update(raw, "utf8").digest("hex").toLowerCase();
    const s = createSign("RSA-SHA256");
    s.update(`POST:/api/v1.0/qr/qr-mpm-notify:${hash}:${ts}`);
    const sig = s.sign(privPem, "base64");

    const bal0 = await prisma.waBalance.findUnique({ where: { tenantId } });
    const r1 = await request(api)
      .post("/api/v1.0/qr/qr-mpm-notify")
      .set("Content-Type", "application/json")
      .set("X-Timestamp", ts)
      .set("X-Signature", sig)
      .send(payload);
    expect(r1.status).toBe(200);
    expect(r1.body.responseCode).toBe("2005200");

    const row = await prisma.waTopup.findUnique({ where: { orderId: order.orderId } });
    expect(row?.status).toBe("settlement");
    const bal1 = await prisma.waBalance.findUnique({ where: { tenantId } });
    expect((bal1?.amount ?? 0) - (bal0?.amount ?? 0)).toBe(30);

    // ulang lagi → tak mengkredit dua kali
    const r2 = await request(api)
      .post("/api/v1.0/qr/qr-mpm-notify")
      .set("Content-Type", "application/json")
      .set("X-Timestamp", ts)
      .set("X-Signature", sig)
      .send(payload);
    expect(r2.status).toBe(200);
    const bal2 = await prisma.waBalance.findUnique({ where: { tenantId } });
    expect(bal2?.amount).toBe(bal1?.amount);
  });

  it("tanpa public key Winpay: topup tetap siap; notifikasi ditolak (verifikasi butuh public key)", async () => {
    await prisma.appSetting.deleteMany({ where: { key: "winpayPublicKey" } });
    expect(await winpayReady()).toBe(true);
    const r = await request(api)
      .post("/api/v1.0/qr/qr-mpm-notify")
      .set("Content-Type", "application/json")
      .set("X-Timestamp", "2026-10-13T12:00:00+07:00")
      .set("X-Signature", Buffer.alloc(256).toString("base64"))
      .send({ originalPartnerReferenceNo: "wa-x", latestTransactionStatus: "00" });
    expect(r.status).toBe(401);
    await prisma.appSetting.upsert({
      where: { key: "winpayPublicKey" },
      create: { key: "winpayPublicKey", value: pubPem },
      update: { value: pubPem },
    });
  });

  it("notifikasi signature salah → 401 & tak mengkredit", async () => {
    const order = await prisma.waTopup.create({
      data: { tenantId, orderId: `wa-${randomBytes(8).toString("hex")}`, amount: 2000, credits: 10 },
    });
    const r = await request(api)
      .post("/api/v1.0/qr/qr-mpm-notify")
      .set("Content-Type", "application/json")
      .set("X-Timestamp", "2026-10-13T12:00:00+07:00")
      .set("X-Signature", Buffer.alloc(256).toString("base64"))
      .send({ originalPartnerReferenceNo: order.orderId, latestTransactionStatus: "00" });
    expect(r.status).toBe(401);
    const row = await prisma.waTopup.findUnique({ where: { orderId: order.orderId } });
    expect(row?.status).toBe("pending");
  });
});
