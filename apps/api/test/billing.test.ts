import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { computeWebhookSignature } from "../src/billing/midtrans.js";

let api: ReturnType<typeof createApp>;
let cookie = "";
let tenantId = "";

const ENV_BACKUP: Record<string, string | undefined> = {};
const ENV_KEYS = ["BILLING_ENABLED", "MIDTRANS_SERVER_KEY"] as const;

beforeAll(async () => {
  for (const k of ENV_KEYS) ENV_BACKUP[k] = process.env[k];
  process.env.BILLING_ENABLED = "0";
  process.env.MIDTRANS_SERVER_KEY = "";
  api = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `bil-${randomBytes(3).toString("hex")}`, name: "PT Bil", alias: "BIL" },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({ data: { tenantId: tenant.id, key: "admin", name: "Admin" } });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, providerUserId: `bu-${randomBytes(3).toString("hex")}`, email: "bil@demo.local", name: "Bil", roleId: role.id },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86400_000) } });
  cookie = `sid=${sid}`;
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    const v = ENV_BACKUP[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return prisma.$disconnect();
});

describe("billing dormant", () => {
  it("status: enabled=false, entitled=true (tanpa login → 401)", async () => {
    expect((await request(api).get("/api/billing/status")).status).toBe(401);
    const r = await request(api).get("/api/billing/status").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.enabled).toBe(false);
    expect(r.body.entitled).toBe(true);
    expect(r.body.plan).toBe("free");
  });
  it("subscribe → 503 billing_dormant", async () => {
    const r = await request(api).post("/api/billing/subscribe").set("Cookie", cookie);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("billing_dormant");
  });
  it("webhook → 403 saat dormant", async () => {
    const r = await request(api).post("/api/billing/webhook").send({ order_id: "x", status_code: "200", gross_amount: "10000", transaction_status: "settlement" });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("billing_dormant");
  });
});

describe("signature webhook (unit)", () => {
  const payload = { order_id: "ORD-1", status_code: "200", gross_amount: "150000", transaction_status: "settlement" };
  const key = "server-key-test";
  it("signature benar → verify true; salah → false", async () => {
    const { verifyWebhookSignature } = await import("../src/billing/midtrans.js");
    const sig = computeWebhookSignature(payload, key);
    expect(sig).toHaveLength(128);
    expect(verifyWebhookSignature(payload, key, sig)).toBe(true);
    expect(verifyWebhookSignature(payload, key, sig.replace(/.$/, "0"))).toBe(false);
    expect(verifyWebhookSignature({ ...payload, gross_amount: "1" }, key, sig)).toBe(false);
    expect(verifyWebhookSignature(payload, key, "")).toBe(false);
  });
});

describe("webhook update (mode aktif disuntik via env)", () => {
  it("payment ter-update + subscription expire saat deny", async () => {
    process.env.BILLING_ENABLED = "1";
    process.env.MIDTRANS_SERVER_KEY = "srv-test";
    const { isBillingEnabled } = await import("../src/billing/midtrans.js");
    expect(isBillingEnabled()).toBe(true);
    await prisma.subscription.create({ data: { tenantId, plan: "pro", status: "active" } });
    const payment = await prisma.payment.create({
      data: { tenantId, orderId: `ORD-${randomBytes(3).toString("hex")}`, amount: 150000, status: "pending" },
    });
    const payload = {
      order_id: payment.orderId,
      status_code: "200",
      gross_amount: "150000",
      transaction_status: "deny",
    };
    const sig = computeWebhookSignature(payload, "srv-test");
    // ubah karakter terakhir ke nilai yg BERBEDA dari aslinya (bila sudah "0" pakai "1")
    const flipped = sig.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    expect(flipped).not.toBe(sig);
    const bad = await request(api).post("/api/billing/webhook").set("X-Signature-Key", flipped).send(payload);
    expect(bad.status).toBe(401);
    // signature standar Midtrans ada di body (`signature_key`), bukan header
    const ok = await request(api).post("/api/billing/webhook").send({ ...payload, signature_key: sig });
    expect(ok.status).toBe(200);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("deny");
    const sub = await prisma.subscription.findFirst({ where: { tenantId } });
    expect(sub!.status).toBe("expired");
    const unknown = await request(api)
      .post("/api/billing/webhook")
      .set("X-Signature-Key", computeWebhookSignature({ ...payload, order_id: "nope" }, "srv-test"))
      .send({ ...payload, order_id: "nope" });
    expect(unknown.status).toBe(404);
    process.env.BILLING_ENABLED = "0";
    process.env.MIDTRANS_SERVER_KEY = "";
  });
});
