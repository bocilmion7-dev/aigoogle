import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";

vi.mock("../src/providers/accounting/connection.js", () => ({ accurateCtxFor: vi.fn() }));
vi.mock("../src/providers/accounting/index.js", () => ({ accurateProvider: vi.fn() }));
vi.mock("../src/wa/service.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/wa/service.js")>();
  return { ...mod, sendWaText: vi.fn(async () => ({ ok: true })) } as typeof mod;
});
vi.mock("../src/shipping/biteship.js", () => ({
  biteshipReady: vi.fn(() => true),
  biteshipKeyMode: vi.fn(() => "test"),
  defaultCouriers: vi.fn(() => "jne,jnt"),
  searchAreas: vi.fn(async () => [{ id: "AREA-1", name: "Kuningan, Jakarta Selatan. 12950", postalCode: "12950" }]),
  createShipment: vi.fn(async () => ({
    id: "ORD-1",
    status: "confirmed",
    waybillId: "AWB1",
    trackingId: "TRK1",
    trackingLink: "https://track.biteship.com/TRK1",
    courier: { company: "jne", type: "reg" },
  })),
  trackingPageUrl: vi.fn((id: string) => (id ? `https://track.biteship.com/${id}` : "")),
  track: vi.fn(async () => ({
    id: "TRK-1",
    waybillId: "AWB1",
    courier: { company: "jne", name: "JNE" },
    status: "picked",
    history: [{ note: "Paket diinput", status: "picked", updatedAt: "2026-10-25T08:00:00+07:00" }],
  })),
}));

import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { accurateCtxFor } from "../src/providers/accounting/connection.js";
import { accurateProvider } from "../src/providers/accounting/index.js";
import { saveShopOrder, getShopOrder, type ShopOrder } from "../src/wa/shop-order.js";
import { syncShopOrderPaid } from "../src/wa/shop-accurate.js";
import { createShipment, track } from "../src/shipping/biteship.js";
import { sendWaText } from "../src/wa/service.js";

type MockFn = ReturnType<typeof vi.fn>;

let api: ReturnType<typeof createApp>;
let tenantA = "";
let tenantB = "";
let cookieAdmin = "";
let cookieStaff = "";
let pendingId = "";
let paidId = "";
let foreignId = "";

const provider = {
  execute: vi.fn(async () => ({ item: { no: "BRG-001" } })),
  findOrCreateCustomer: vi.fn(
    async (): Promise<{ customerNo: string; name: string; mobilePhone?: string } | null> => ({
      customerNo: "CUST-1",
      name: "Budi Santoso",
      mobilePhone: "628111",
    })
  ),
  listCustomers: vi.fn(async () => [{ customerNo: "CUST-1", name: "Budi Santoso", mobilePhone: "628111" }]),
  createSalesOrder: vi.fn(async () => ({ id: "so-1", number: "SO.2026.10.00001" })),
  createSalesInvoice: vi.fn(async () => ({ id: "inv-1", number: "SI.2026.10.00001" })),
  createSalesReceipt: vi.fn(async () => ({ id: "rec-1", number: "SR.2026.10.00001" })),
  closeSalesOrder: vi.fn(async () => undefined),
};

const orderOf = (id: string, tenantId: string, status: ShopOrder["status"]): ShopOrder => ({
  orderId: id,
  tenantId,
  buyerPhone: "628111222333",
  buyerName: "Budi Santoso",
  items: [{ name: "Kopi Susu", no: "BRG-001", qty: 2, price: 15000, subtotal: 30000, stock: 9 }],
  total: 30000,
  status,
  qrUrl: "https://example.test/qr",
  qrContent: "000201",
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
  createdAt: new Date().toISOString(),
});

async function makeUser(tenantId: string, perms: string[]): Promise<string> {
  const role = await prisma.role.create({
    data: { tenantId, key: `r-${randomBytes(3).toString("hex")}`, name: "Role" },
  });
  if (perms.length) {
    await prisma.rolePermission.createMany({ data: perms.map((permissionKey) => ({ roleId: role.id, permissionKey })) });
  }
  const user = await prisma.user.create({
    data: {
      tenantId,
      providerUserId: `ou-${randomBytes(3).toString("hex")}`,
      email: `ord-${randomBytes(3).toString("hex")}@demo.local`,
      name: "Order User",
      roleId: role.id,
    },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) } });
  return `sid=${sid}`;
}

const ALL_PERMS = [
  "app:users.manage",
  "accurate:customer.view",
  "accurate:customer.save",
  "accurate:sales-order.save",
  "accurate:sales-invoice.save",
  "accurate:sales-receipt.save",
];

beforeAll(async () => {
  process.env.BITESHIP_WEBHOOK_TOKEN = "test-token";
  api = createApp();
  const mk = async (name: string) =>
    (
      await prisma.tenant.create({
        data: { provider: "accurate", providerDbId: `ot-${randomBytes(3).toString("hex")}`, name, alias: name.slice(0, 4) },
      })
    ).id;
  tenantA = await mk("PT Orders A");
  tenantB = await mk("PT Orders B");
  cookieAdmin = await makeUser(tenantA, ALL_PERMS);
  cookieStaff = await makeUser(tenantA, ["accurate:customer.view"]);
  pendingId = `shop-mock-${randomBytes(4).toString("hex")}`;
  paidId = `shop-mock-${randomBytes(4).toString("hex")}`;
  foreignId = `shop-mock-${randomBytes(4).toString("hex")}`;
  await saveShopOrder(orderOf(pendingId, tenantA, "pending"));
  await saveShopOrder(orderOf(paidId, tenantA, "paid"));
  await saveShopOrder(orderOf(foreignId, tenantB, "pending"));
});

beforeEach(() => {
  vi.clearAllMocks();
  (accurateCtxFor as unknown as MockFn).mockResolvedValue({
    tenantId: tenantA,
    host: "http://mock",
    session: "s",
    accessToken: "a",
  });
  (accurateProvider as unknown as MockFn).mockReturnValue(provider);
  provider.execute.mockResolvedValue({ item: { no: "BRG-001" } });
  provider.findOrCreateCustomer.mockResolvedValue({ customerNo: "CUST-1", name: "Budi Santoso", mobilePhone: "628111" });
  provider.createSalesOrder.mockResolvedValue({ id: "so-1", number: "SO.2026.10.00001" });
  provider.createSalesInvoice.mockResolvedValue({ id: "inv-1", number: "SI.2026.10.00001" });
  provider.createSalesReceipt.mockResolvedValue({ id: "rec-1", number: "SR.2026.10.00001" });
});

afterAll(async () => {
  delete process.env.BITESHIP_WEBHOOK_TOKEN;
  await prisma.waMessageLog.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  await prisma.appSetting.deleteMany({ where: { key: { startsWith: "wa:biteship_order:" } } });
  await prisma.appSetting.deleteMany({ where: { key: { startsWith: "wa:shop_order:shop-mock-" } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  await prisma.session.deleteMany({ where: { user: { tenantId: { in: [tenantA, tenantB] } } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  await prisma.role.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await prisma.$disconnect();
});

describe("GET /api/orders", () => {
  it("hanya pesanan perusahaan sendiri + stage", async () => {
    const r = await request(api).get("/api/orders").set("Cookie", cookieAdmin);
    expect(r.status).toBe(200);
    expect(r.body.accurateConnected).toBe(true);
    const ids = r.body.orders.map((o: { orderId: string }) => o.orderId);
    expect(ids).toContain(pendingId);
    expect(ids).toContain(paidId);
    expect(ids).not.toContain(foreignId);
    const paid = r.body.orders.find((o: { orderId: string }) => o.orderId === paidId);
    expect(paid.stage).toBe("lunas");
  });

  it("filter status", async () => {
    const r = await request(api).get("/api/orders?status=pending").set("Cookie", cookieAdmin);
    const ids = r.body.orders.map((o: { orderId: string }) => o.orderId);
    expect(ids).toContain(pendingId);
    expect(ids).not.toContain(paidId);
  });

  it("tanpa login → 401", async () => {
    expect((await request(api).get("/api/orders")).status).toBe(401);
  });
});

describe("pelanggan Accurate", () => {
  it("autocomplete butuh izin customer.view", async () => {
    const admin = await request(api).get("/api/orders/customers?q=budi").set("Cookie", cookieAdmin);
    expect(admin.status).toBe(200);
    expect(admin.body[0]).toMatchObject({ customerNo: "CUST-1", name: "Budi Santoso" });
    const staff = await request(api).get("/api/orders/customers?q=budi").set("Cookie", cookieStaff);
    expect(staff.status).toBe(200);
  });

  it("tanpa izin customer.save → 403 saat memetakan pelanggan", async () => {
    const r = await request(api)
      .post(`/api/orders/${pendingId}/accurate`)
      .set("Cookie", cookieStaff)
      .send({ doc: "customer" });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("tidak_punya_hak");
  });
});

describe("input pesanan (sales order)", () => {
  it("buat pelanggan baru + SO memakai kode barang Accurate", async () => {
    const r = await request(api)
      .post(`/api/orders/${pendingId}/accurate`)
      .set("Cookie", cookieAdmin)
      .send({ doc: "sales-order", customerName: "Budi Santoso" });
    expect(r.status).toBe(200);
    expect(provider.findOrCreateCustomer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ phone: "628111222333", createName: "Budi Santoso" })
    );
    expect(provider.createSalesOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        customerNo: "CUST-1",
        items: [expect.objectContaining({ itemNo: "BRG-001", qty: 2, price: 15000 })],
      })
    );
    expect(r.body.order.stage).toBe("pesanan-acc");
    const saved = await getShopOrder(pendingId);
    expect(saved?.accurate?.salesOrder?.number).toBe("SO.2026.10.00001");
    expect(saved?.accurate?.customerNo).toBe("CUST-1");
    const audit = await prisma.auditLog.findFirst({
      where: { tenantId: tenantA, action: "orders.accurate_sales_order" },
    });
    expect(audit).toBeTruthy();
  });

  it("tanpa izin sales-order.save → 403", async () => {
    const r = await request(api)
      .post(`/api/orders/${pendingId}/accurate`)
      .set("Cookie", cookieStaff)
      .send({ doc: "sales-order" });
    expect(r.status).toBe(403);
  });

  it("pesanan perusahaan lain → 404", async () => {
    const r = await request(api)
      .post(`/api/orders/${foreignId}/accurate`)
      .set("Cookie", cookieAdmin)
      .send({ doc: "sales-order" });
    expect(r.status).toBe(404);
  });

  it("tanpa pelanggan & tanpa nama → pesan agar isi nama dulu", async () => {
    provider.findOrCreateCustomer.mockResolvedValueOnce(null);
    const order = orderOf(`shop-mock-${randomBytes(4).toString("hex")}`, tenantA, "pending");
    order.buyerName = "";
    await saveShopOrder(order);
    const r = await request(api)
      .post(`/api/orders/${order.orderId}/accurate`)
      .set("Cookie", cookieAdmin)
      .send({ doc: "sales-order" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("accurate_gagal");
    expect(String(r.body.message)).toContain("isi nama pelanggan");
    expect(provider.createSalesOrder).not.toHaveBeenCalled();
    await prisma.appSetting.delete({ where: { key: `wa:shop_order:${order.orderId}` } });
  });
});

describe("faktur & penerimaan kas", () => {
  it("faktur ditolak sebelum lunas", async () => {
    const r = await request(api)
      .post(`/api/orders/${pendingId}/accurate`)
      .set("Cookie", cookieAdmin)
      .send({ doc: "sales-invoice" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("belum_dibayar");
    expect(provider.createSalesInvoice).not.toHaveBeenCalled();
  });

  it("lunas → faktur lalu penerimaan kas tersimpan", async () => {
    const inv = await request(api)
      .post(`/api/orders/${paidId}/accurate`)
      .set("Cookie", cookieAdmin)
      .send({ doc: "sales-invoice" });
    expect(inv.status).toBe(200);
    expect(inv.body.order.stage).toBe("difakturkan");

    const rec = await request(api)
      .post(`/api/orders/${paidId}/accurate`)
      .set("Cookie", cookieAdmin)
      .send({ doc: "sales-receipt" });
    expect(rec.status).toBe(200);
    expect(rec.body.order.stage).toBe("selesai");
    expect(provider.createSalesReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ invoiceNo: "SI.2026.10.00001", amount: 30000 })
    );
  });

  it("penerimaan kas tanpa faktur → 409", async () => {
    const r = await request(api)
      .post(`/api/orders/${pendingId}/accurate`)
      .set("Cookie", cookieAdmin)
      .send({ doc: "sales-receipt" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("belum_difakturkan");
  });
});

describe("sinkron otomatis saat lunas", () => {
  it("membuat faktur + penerimaan kas & menyimpan nomornya", async () => {
    const id = `shop-mock-${randomBytes(4).toString("hex")}`;
    await saveShopOrder(orderOf(id, tenantA, "paid"));
    const updated = await syncShopOrderPaid(id);
    expect(updated?.accurate?.salesInvoice?.number).toBe("SI.2026.10.00001");
    expect(updated?.accurate?.salesReceipt?.number).toBe("SR.2026.10.00001");
    expect(updated?.accurate?.syncedAt).toBeTruthy();
    expect(updated?.accurate?.lastError).toBeUndefined();
    const audit = await prisma.auditLog.findFirst({
      where: { tenantId: tenantA, action: "wa.shop_order_accurate" },
    });
    expect(audit).toBeTruthy();
    await prisma.appSetting.delete({ where: { key: `wa:shop_order:${id}` } });
  });

  it("gagal Accurate tidak melempar — error disimpan utk diulang", async () => {
    const id = `shop-mock-${randomBytes(4).toString("hex")}`;
    await saveShopOrder(orderOf(id, tenantA, "paid"));
    provider.createSalesInvoice.mockRejectedValueOnce(new Error("akun kas tidak ditemukan"));
    const updated = await syncShopOrderPaid(id);
    expect(updated?.accurate?.lastError).toContain("akun kas");
    const audit = await prisma.auditLog.findFirst({
      where: { tenantId: tenantA, action: "wa.shop_order_accurate_failed" },
    });
    expect(audit).toBeTruthy();
    await prisma.appSetting.delete({ where: { key: `wa:shop_order:${id}` } });
  });

  it("Accurate belum terhubung → lastError jelas", async () => {
    const id = `shop-mock-${randomBytes(4).toString("hex")}`;
    await saveShopOrder(orderOf(id, tenantA, "paid"));
    (accurateCtxFor as unknown as MockFn).mockResolvedValueOnce(null);
    const updated = await syncShopOrderPaid(id);
    expect(updated?.accurate?.lastError).toContain("Accurate belum terhubung");
    await prisma.appSetting.delete({ where: { key: `wa:shop_order:${id}` } });
  });
});


describe("pengiriman (Biteship)", () => {
  it("setelan asal pengiriman: default kosong, hanya admin bisa mengubah", async () => {
    const before = await request(api).get("/api/shipping/settings").set("Cookie", cookieAdmin);
    expect(before.status).toBe(200);
    expect(before.body.biteshipReady).toBe(true);
    expect(before.body.origin.postalCode).toBe("");

    const denied = await request(api)
      .put("/api/shipping/settings")
      .set("Cookie", cookieStaff)
      .send({ postalCode: "12250" });
    expect(denied.status).toBe(403);

    const ok = await request(api)
      .put("/api/shipping/settings")
      .set("Cookie", cookieAdmin)
      .send({
        contactName: "Gudang",
        phone: "08123456789",
        organization: "Toko Uji",
        address: "Jl. Contoh No. 1, Jakarta",
        postalCode: "12250",
      });
    expect(ok.status).toBe(200);
    expect(ok.body.origin.postalCode).toBe("12250");
  });

  it("cari area butuh login admin", async () => {
    const r = await request(api).get("/api/shipping/areas?q=kuningan").set("Cookie", cookieAdmin);
    expect(r.status).toBe(200);
    expect(r.body[0].postalCode).toBe("12950");
  });

  it("pesanan ambil sendiri tidak bisa diinput ke Biteship", async () => {
    const r = await request(api).post(`/api/orders/${pendingId}/biteship`).set("Cookie", cookieAdmin);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("bukan_kurir");
  });

  it("pesanan kurir lunas → resi tersimpan; pelacakan mengembalikan riwayat", async () => {
    const id = `shop-mock-${randomBytes(4).toString("hex")}`;
    const o = orderOf(id, tenantA, "paid");
    o.fulfillment = "courier";
    o.shipping = {
      destinationAddress: "Jl. Tujuan No. 2, Jakarta",
      destinationPostalCode: "12950",
      courierName: "JNE",
      courierCode: "jne",
      serviceName: "Reguler",
      serviceCode: "reg",
      price: 10000,
      weightGram: 1000,
    };
    await saveShopOrder(o);

    const r = await request(api).post(`/api/orders/${id}/biteship`).set("Cookie", cookieAdmin);
    expect(r.status).toBe(200);
    expect(r.body.shipment.waybillId).toBe("AWB1");
    expect(r.body.shipment.trackingId).toBe("TRK1");
    expect(r.body.order.shipping.biteshipOrderId).toBe("ORD-1");
    expect(r.body.order.shipping.trackingId).toBe("TRK1");
    expect(r.body.order.shipping.trackingLink).toBe("https://track.biteship.com/TRK1");
    expect(r.body.buyerNotified).toBe(true);
    // link yang dibagikan = halaman lacak publik aplikasi (bukan track.biteship.com)
    expect(sendWaText).toHaveBeenCalledWith(
      tenantA,
      "628111222333",
      expect.stringContaining(`/lacak/${id}`)
    );
    expect(createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        courier: { company: "jne", type: "reg" },
        destination: expect.objectContaining({ postalCode: "12950" }),
      })
    );

    const tr = await request(api).get(`/api/orders/${id}/tracking`).set("Cookie", cookieAdmin);
    expect(tr.status).toBe(200);
    expect(tr.body.tracking.waybillId).toBe("AWB1");
    expect(tr.body.tracking.history[0].status).toBe("picked");
    expect(track).toHaveBeenCalledWith("TRK1", undefined);

    const audit = await prisma.auditLog.findFirst({
      where: { tenantId: tenantA, action: "orders.biteship_order" },
    });
    expect(audit).toBeTruthy();
    await prisma.appSetting.delete({ where: { key: `wa:shop_order:${id}` } });
  });

  it("order sandbox (nomor semu > 32 char) → wajib isi no HP penerima; dipakai & tersimpan", async () => {
    const id = `shop-mock-${randomBytes(4).toString("hex")}`;
    const o = orderOf(id, tenantA, "paid");
    o.buyerPhone = `sandbox:test-${randomBytes(8).toString("hex")}`; // > 32 char → dulu ditolak Biteship
    o.fulfillment = "courier";
    o.shipping = {
      destinationAddress: "Jl. Tujuan No. 2, Jakarta",
      destinationPostalCode: "12950",
      courierName: "JNE",
      courierCode: "jne",
      serviceName: "Reguler",
      serviceCode: "reg",
      price: 10000,
      weightGram: 1000,
    };
    await saveShopOrder(o);

    const bad = await request(api).post(`/api/orders/${id}/biteship`).set("Cookie", cookieAdmin).send({});
    expect(bad.status).toBe(409);
    expect(bad.body.error).toBe("telepon_penerima_kosong");

    const ok = await request(api)
      .post(`/api/orders/${id}/biteship`)
      .set("Cookie", cookieAdmin)
      .send({ receiverPhone: "0812-3456-7890" });
    expect(ok.status).toBe(200);
    expect(createShipment).toHaveBeenCalledWith(
      expect.objectContaining({ destination: expect.objectContaining({ phone: "081234567890" }) })
    );
    const saved = await getShopOrder(id);
    expect(saved?.shipping?.destinationPhone).toBe("081234567890");
    await prisma.appSetting.delete({ where: { key: `wa:shop_order:${id}` } });
  });

  it("halaman lacak publik → status + riwayat tanpa login", async () => {
    const id = `shop-mock-${randomBytes(4).toString("hex")}`;
    const o = orderOf(id, tenantA, "paid");
    o.fulfillment = "courier";
    o.shipping = {
      destinationAddress: "Jl. Tujuan No. 2, Jakarta",
      destinationPostalCode: "12950",
      courierName: "JNE",
      courierCode: "jne",
      serviceName: "Reguler",
      serviceCode: "reg",
      price: 10000,
      weightGram: 1000,
      biteshipOrderId: "ORD-1",
      trackingId: "TRK1",
      waybillId: "AWB1",
      status: "picked",
    };
    await saveShopOrder(o);

    const r = await request(api).get(`/api/public/track/${id}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ orderId: id, courier: "JNE Reguler", waybillId: "AWB1", status: "picked" });
    expect(String(r.body.statusLabel)).toContain("dijemput");
    expect(r.body.history.length).toBeGreaterThan(0);

    expect((await request(api).get("/api/public/track/shop-tidakada")).status).toBe(404);
    await prisma.appSetting.delete({ where: { key: `wa:shop_order:${id}` } });
  });

  it("order sandbox → notifikasi resi + link lacak tercatat di chat sandbox (tanpa WA asli)", async () => {
    const id = `shop-mock-${randomBytes(4).toString("hex")}`;
    const o = orderOf(id, tenantA, "paid");
    o.buyerPhone = `sandbox:${"x".repeat(40)}`;
    o.fulfillment = "courier";
    o.shipping = {
      destinationAddress: "Jl. Tujuan No. 2, Jakarta",
      destinationPostalCode: "12950",
      destinationPhone: "081234567890",
      courierName: "JNE",
      courierCode: "jne",
      serviceName: "Reguler",
      serviceCode: "reg",
      price: 10000,
      weightGram: 1000,
    };
    await saveShopOrder(o);

    const r = await request(api).post(`/api/orders/${id}/biteship`).set("Cookie", cookieAdmin).send({});
    expect(r.status).toBe(200);
    expect(r.body.buyerNotified).toBe(true);
    expect(sendWaText).not.toHaveBeenCalled();
    const log = await prisma.waMessageLog.findFirst({
      where: { tenantId: tenantA, to: o.buyerPhone, direction: "out" },
    });
    expect(log?.body).toContain(`/lacak/${id}`);
    await prisma.waMessageLog.deleteMany({ where: { to: o.buyerPhone } });
    await prisma.appSetting.delete({ where: { key: `wa:shop_order:${id}` } });
  });

  it("klik ganda Input ke Biteship → hanya satu yang diproses (anti-dobel)", async () => {
    const id = `shop-mock-${randomBytes(4).toString("hex")}`;
    const o = orderOf(id, tenantA, "paid");
    o.fulfillment = "courier";
    o.shipping = {
      destinationAddress: "Jl. Tujuan No. 2, Jakarta",
      destinationPostalCode: "12950",
      destinationPhone: "081234567890",
      courierName: "JNE",
      courierCode: "jne",
      serviceName: "Reguler",
      serviceCode: "reg",
      price: 10000,
      weightGram: 1000,
    };
    await saveShopOrder(o);
    (createShipment as unknown as MockFn).mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return {
        id: "ORD-LOCK",
        status: "confirmed",
        waybillId: "AWB-LOCK",
        trackingId: "TRK-LOCK",
        trackingLink: "https://track.biteship.com/TRK-LOCK",
        courier: { company: "jne", type: "reg" },
      };
    });

    const p1 = request(api).post(`/api/orders/${id}/biteship`).set("Cookie", cookieAdmin).send({});
    const done1 = p1.then((r) => r);
    await new Promise((r) => setTimeout(r, 40));
    const r2 = await request(api).post(`/api/orders/${id}/biteship`).set("Cookie", cookieAdmin).send({});
    const r1 = await done1;
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
    const blocked = r1.status === 409 ? r1 : r2;
    expect(blocked.body.error).toBe("sedang_diproses");
    expect(createShipment).toHaveBeenCalledTimes(1);
    await prisma.appSetting.delete({ where: { key: `wa:shop_order:${id}` } });
  });

  it("pelacakan sebelum ada resi → 409", async () => {
    const r = await request(api).get(`/api/orders/${pendingId}/tracking`).set("Cookie", cookieAdmin);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("belum_ada_resi");
  });
});


describe("webhook Biteship & notifikasi pelanggan", () => {
  async function courierOrder(id: string) {
    const o = orderOf(id, tenantA, "paid");
    o.fulfillment = "courier";
    o.shipping = {
      destinationAddress: "Jl. Tujuan No. 2, Jakarta",
      destinationPostalCode: "12950",
      courierName: "JNE",
      courierCode: "jne",
      serviceName: "Reguler",
      serviceCode: "reg",
      price: 10000,
      weightGram: 1000,
      biteshipOrderId: "ORD-1",
      trackingId: "TRK1",
      waybillId: "AWB1",
    };
    await saveShopOrder(o);
    return o;
  }

  it("order.status → status tersimpan + WA update (sekali saja)", async () => {
    const id = `shop-mock-${randomBytes(4).toString("hex")}`;
    await courierOrder(id);
    vi.clearAllMocks();

    const payload = {
      event: "order.status",
      order_id: "ORD-1",
      courier_tracking_id: "TRK1",
      courier_waybill_id: "AWB1",
      courier_company: "JNE",
      courier_type: "REG",
      courier_link: "https://track.biteship.com/TRK1",
      status: "inTransit",
    };
    const r = await request(api).post("/api/shipping/biteship/webhook").set("X-Webhook-Token", "test-token").send(payload);
    expect(r.status).toBe(200);
    expect(r.body.matched).toBe(true);
    expect(r.body.notified).toBe(true);
    const saved = await getShopOrder(id);
    expect(saved?.shipping?.status).toBe("inTransit");
    expect(saved?.shipping?.lastNotifiedStatus).toBe("inTransit");
    expect(sendWaText).toHaveBeenCalledWith(
      tenantA,
      "628111222333",
      expect.stringContaining("dalam perjalanan")
    );

    vi.clearAllMocks();
    const again = await request(api).post("/api/shipping/biteship/webhook").set("X-Webhook-Token", "test-token").send(payload);
    expect(again.status).toBe(200);
    expect(again.body.notified).toBe(false);
    expect(sendWaText).not.toHaveBeenCalled();
    await prisma.appSetting.delete({ where: { key: `wa:shop_order:${id}` } });
  });

  it("order.waybill_id → resi baru dikirim ke pembeli sekali", async () => {
    const id = `shop-mock-${randomBytes(4).toString("hex")}`;
    const o = orderOf(id, tenantA, "paid");
    o.fulfillment = "courier";
    o.shipping = {
      destinationAddress: "Jl. Tujuan No. 2, Jakarta",
      destinationPostalCode: "12950",
      courierName: "JNE",
      courierCode: "jne",
      serviceName: "Reguler",
      serviceCode: "reg",
      biteshipOrderId: "ORD-2",
      trackingId: "TRK2",
    };
    await saveShopOrder(o);
    vi.clearAllMocks();
    const payload = {
      event: "order.waybill_id",
      order_id: "ORD-2",
      courier_tracking_id: "TRK2",
      courier_waybill_id: "AWB2",
      courier_company: "JNE",
      courier_type: "REG",
      courier_link: "https://track.biteship.com/TRK2",
    };
    const r = await request(api).post("/api/shipping/biteship/webhook").set("X-Webhook-Token", "test-token").send(payload);
    expect(r.status).toBe(200);
    expect(sendWaText).toHaveBeenCalledWith(
      tenantA,
      "628111222333",
      expect.stringContaining(`/lacak/${id}`)
    );
    const saved = await getShopOrder(id);
    expect(saved?.shipping?.waybillId).toBe("AWB2");
    expect(saved?.shipping?.waybillNotified).toBe(true);
    await prisma.appSetting.delete({ where: { key: `wa:shop_order:${id}` } });
  });

  it("webhook dengan token salah → 401", async () => {
    process.env.BITESHIP_WEBHOOK_TOKEN = "rahasia";
    try {
      const r = await request(api)
        .post("/api/shipping/biteship/webhook")
        .set("X-Webhook-Token", "salah")
        .send({ event: "order.status", order_id: "ORD-1", status: "picked" });
      expect(r.status).toBe(401);
    } finally {
      delete process.env.BITESHIP_WEBHOOK_TOKEN;
    }
  });
});
