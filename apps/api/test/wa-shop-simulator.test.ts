import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

/** notifikasi WA dipantau — jangan kirim jaringan dari test */
const h = vi.hoisted(() => ({
  sendWaText: vi.fn(async (_tenantId: string, _to: string, _body: string) => ({ ok: true })),
}));
vi.mock("../src/wa/service.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/wa/service.js")>();
  return { ...mod, sendWaText: h.sendWaText } as typeof mod;
});

let api: ReturnType<typeof createApp>;
let tenantA = "";
let tenantB = "";
let cookieAdmin = "";
let cookieStaff = "";
let orderId = "";
let otherOrderId = "";
let sandboxOrderId = "";
const ownerPhone = "628999000";
const buyerPhone = "628111000";
const sandboxPeer = "sandbox:u-test-1";

const orderPayload = (id: string, tenantId: string, buyer: string) => ({
  orderId: id,
  tenantId,
  buyerPhone: buyer,
  buyerName: "Pembeli Uji",
  items: [{ name: "Kopi Susu", no: "I1", qty: 2, price: 15000, subtotal: 30000, stock: 9 }],
  total: 30000,
  status: "pending",
  qrUrl: "https://example.test/qr",
  qrContent: "000201",
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
  createdAt: new Date().toISOString(),
});

async function makeUser(tenantId: string, withPerm: boolean): Promise<string> {
  const role = await prisma.role.create({
    data: { tenantId, key: withPerm ? "admin" : `st-${randomBytes(2).toString("hex")}`, name: withPerm ? "Admin" : "Staf" },
  });
  if (withPerm) {
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionKey: "app:users.manage" } });
  }
  const user = await prisma.user.create({
    data: {
      tenantId,
      providerUserId: `ssu-${randomBytes(3).toString("hex")}`,
      email: `ss-${randomBytes(3).toString("hex")}@demo.local`,
      name: withPerm ? "Admin Toko" : "Staf Toko",
      roleId: role.id,
    },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) } });
  return `sid=${sid}`;
}

beforeAll(async () => {
  api = createApp();
  tenantA = (
    await prisma.tenant.create({
      data: { provider: "accurate", providerDbId: `sa-${randomBytes(3).toString("hex")}`, name: "PT Simulator A", alias: "SA" },
    })
  ).id;
  tenantB = (
    await prisma.tenant.create({
      data: { provider: "accurate", providerDbId: `sb-${randomBytes(3).toString("hex")}`, name: "PT Simulator B", alias: "SB" },
    })
  ).id;
  cookieAdmin = await makeUser(tenantA, true);
  cookieStaff = await makeUser(tenantA, false);

  orderId = `shop-${randomBytes(6).toString("hex")}`;
  otherOrderId = `shop-${randomBytes(6).toString("hex")}`;
  sandboxOrderId = `shop-${randomBytes(6).toString("hex")}`;
  await prisma.payment.create({ data: { tenantId: tenantA, orderId, amount: 30000, status: "pending" } });
  await prisma.payment.create({ data: { tenantId: tenantB, orderId: otherOrderId, amount: 30000, status: "pending" } });
  await prisma.payment.create({ data: { tenantId: tenantA, orderId: sandboxOrderId, amount: 30000, status: "pending" } });
  await prisma.appSetting.upsert({
    where: { key: `wa:shop_order:${orderId}` },
    create: { key: `wa:shop_order:${orderId}`, value: JSON.stringify(orderPayload(orderId, tenantA, buyerPhone)) },
    update: { value: JSON.stringify(orderPayload(orderId, tenantA, buyerPhone)) },
  });
  await prisma.appSetting.upsert({
    where: { key: `wa:shop_order:${otherOrderId}` },
    create: { key: `wa:shop_order:${otherOrderId}`, value: JSON.stringify(orderPayload(otherOrderId, tenantB, "628222000")) },
    update: { value: JSON.stringify(orderPayload(otherOrderId, tenantB, "628222000")) },
  });
  await prisma.appSetting.upsert({
    where: { key: `wa:shop_order:${sandboxOrderId}` },
    create: {
      key: `wa:shop_order:${sandboxOrderId}`,
      value: JSON.stringify(orderPayload(sandboxOrderId, tenantA, sandboxPeer)),
    },
    update: { value: JSON.stringify(orderPayload(sandboxOrderId, tenantA, sandboxPeer)) },
  });
  await prisma.appSetting.upsert({
    where: { key: `wa:owner_phone:${tenantA}` },
    create: { key: `wa:owner_phone:${tenantA}`, value: ownerPhone },
    update: { value: ownerPhone },
  });
});

beforeEach(() => {
  h.sendWaText.mockClear();
});

afterAll(async () => {
  const keys = [
    `wa:shop_order:${orderId}`,
    `wa:shop_order:${otherOrderId}`,
    `wa:shop_order:${sandboxOrderId}`,
    `wa:owner_phone:${tenantA}`,
  ];
  await prisma.appSetting.deleteMany({ where: { key: { in: keys } } });
  await prisma.waMessageLog.deleteMany({ where: { to: sandboxPeer } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  await prisma.payment.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  await prisma.session.deleteMany({ where: { user: { tenantId: { in: [tenantA, tenantB] } } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  await prisma.role.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await prisma.$disconnect();
});

describe("daftar pesanan toko per percakapan", () => {
  it("GET /api/wa/shop/orders?peer → hanya pesanan perusahaan ini + flag simulator", async () => {
    const r = await request(api).get(`/api/wa/shop/orders?peer=${buyerPhone}`).set("Cookie", cookieAdmin);
    expect(r.status).toBe(200);
    expect(r.body.simulator).toBe(true);
    expect(r.body.orders).toHaveLength(1);
    expect(r.body.orders[0].orderId).toBe(orderId);
    expect(r.body.orders[0].status).toBe("pending");
    expect(r.body.orders[0].total).toBe(30000);
  });

  it("tanpa login → 401", async () => {
    expect((await request(api).get("/api/wa/shop/orders")).status).toBe(401);
  });
});

describe("simulator pembayaran pesanan toko", () => {
  it("staf tanpa hak kelola user → 403", async () => {
    const r = await request(api).post(`/api/wa/shop/orders/${orderId}/settle-test`).set("Cookie", cookieStaff);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("tidak_punya_hak");
    const p = await prisma.payment.findUnique({ where: { orderId } });
    expect(p?.status).toBe("pending");
  });

  it("admin → pesanan LUNAS (jalur sama dgn notifikasi Midtrans) + WA pemilik & pembeli", async () => {
    const r = await request(api).post(`/api/wa/shop/orders/${orderId}/settle-test`).set("Cookie", cookieAdmin);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, orderId, status: "paid" });

    const p = await prisma.payment.findUnique({ where: { orderId } });
    expect(p?.status).toBe("settlement");
    expect(p?.paymentMethod).toBe("qris");

    const row = await prisma.appSetting.findUnique({ where: { key: `wa:shop_order:${orderId}` } });
    expect(JSON.parse(row!.value).status).toBe("paid");

    const tos = h.sendWaText.mock.calls.map((c) => c[1]);
    expect(tos).toContain(ownerPhone);
    expect(tos).toContain(buyerPhone);
    const ownerMsg = String(h.sendWaText.mock.calls.find((c) => c[1] === ownerPhone)?.[2] ?? "");
    expect(ownerMsg).toContain("sudah DIBAYAR");
    expect(ownerMsg).toContain(orderId);

    const paid = await prisma.auditLog.findFirst({ where: { tenantId: tenantA, action: "wa.shop_order_paid" } });
    expect(paid).toBeTruthy();
    expect(paid!.detail).toContain("simulator");
    const sim = await prisma.auditLog.findFirst({ where: { tenantId: tenantA, action: "wa.shop_order_settle_test" } });
    expect(sim).toBeTruthy();
    expect(sim!.userId).toBeTruthy();
  });

  it("dipanggil ulang → 409 sudah_settle (idempoten)", async () => {
    const r = await request(api).post(`/api/wa/shop/orders/${orderId}/settle-test`).set("Cookie", cookieAdmin);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("sudah_settle");
    const audit = await prisma.auditLog.count({ where: { tenantId: tenantA, action: "wa.shop_order_paid" } });
    expect(audit).toBe(1);
  });

  it("order sandbox (buyer sandbox:*) → info sukses tercatat di chat sandbox, tanpa WA sungguhan", async () => {
    const r = await request(api).post(`/api/wa/shop/orders/${sandboxOrderId}/settle-test`).set("Cookie", cookieAdmin);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, orderId: sandboxOrderId, status: "paid" });

    // pesan sukses muncul di percakapan sandbox (waMessageLog, arah keluar)
    const log = await prisma.waMessageLog.findFirst({
      where: { tenantId: tenantA, to: sandboxPeer, direction: "out", body: { contains: "Pembayaran diterima" } },
    });
    expect(log).toBeTruthy();
    expect(log!.body).toContain(sandboxOrderId.replace(/^shop-/, ""));
    expect(log!.body).toContain("Rp30.000");
    expect(log!.status).toBe("sent");
    expect(log!.costCredits).toBe(0);

    // jangan ada WA sungguhan ke nomor semu sandbox
    const tos = h.sendWaText.mock.calls.map((c) => c[1]);
    expect(tos).not.toContain(sandboxPeer);
    // pemilik tetap diberi tahu
    expect(tos).toContain(ownerPhone);
  });

  it("order milik perusahaan lain → 404", async () => {
    const r = await request(api).post(`/api/wa/shop/orders/${otherOrderId}/settle-test`).set("Cookie", cookieAdmin);
    expect(r.status).toBe(404);
    const p = await prisma.payment.findUnique({ where: { orderId: otherOrderId } });
    expect(p?.status).toBe("pending");
  });

  it("MIDTRANS_ENV=production → simulator dimatikan (409 bukan_sandbox)", async () => {
    const prev = process.env.MIDTRANS_ENV;
    process.env.MIDTRANS_ENV = "production";
    try {
      const list = await request(api).get(`/api/wa/shop/orders?peer=${buyerPhone}`).set("Cookie", cookieAdmin);
      expect(list.body.simulator).toBe(false);
      const r = await request(api)
        .post(`/api/wa/shop/orders/shop-${randomBytes(4).toString("hex")}/settle-test`)
        .set("Cookie", cookieAdmin);
      expect(r.status).toBe(409);
      expect(r.body.error).toBe("bukan_sandbox");
    } finally {
      if (prev === undefined) delete process.env.MIDTRANS_ENV;
      else process.env.MIDTRANS_ENV = prev;
    }
  });
});
