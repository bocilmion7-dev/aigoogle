import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { createApp as createMockApp } from "@mock/accurate";
import { prisma } from "../src/db.js";

let api: ReturnType<typeof createApp>;
let mockSrv: Server;
let mockBase: string;
let cookie = "";
let tenantId = "";
let userId = "";
let roleId = "";
let otherTenantId = "";
let lastOrderId = "";
let firstProductId = "";

beforeAll(async () => {
  mockSrv = createMockApp().listen(0);
  await new Promise((r) => mockSrv.once("listening", r));
  mockBase = `http://127.0.0.1:${(mockSrv.address() as { port: number }).port}`;
  process.env.MOCK_ACCURATE_URL = mockBase;
  api = createApp();
  const tenant = await prisma.tenant.create({
    data: {
      provider: "accurate",
      providerDbId: `c-${randomBytes(4).toString("hex")}`,
      name: "PT Storefront",
      alias: "SF",
    },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({ data: { tenantId, key: "admin", name: "Admin" } });
  roleId = role.id;
  await prisma.rolePermission.createMany({
    data: ["app:users.manage"].map((permissionKey) => ({ roleId, permissionKey })),
  });
  const user = await prisma.user.create({
    data: {
      tenantId,
      providerUserId: `u-${randomBytes(4).toString("hex")}`,
      email: `sf-${randomBytes(3).toString("hex")}@demo.local`,
      name: "Admin Storefront",
      roleId,
    },
  });
  userId = user.id;
  const auth = await fetch(`${mockBase}/oauth/authorize?redirect_uri=${encodeURIComponent("http://x/cb")}&user=admin`, { redirect: "manual" });
  const code = new URL(auth.headers.get("location")!).searchParams.get("code")!;
  const tokRes = await fetch(`${mockBase}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: "http://x/cb", client_id: "c", client_secret: "s" }),
  });
  const tok = (await tokRes.json()) as { access_token: string; refresh_token: string; expires_in: number };
  const open = (await (await fetch(`${mockBase}/api/open-db.do?id=1001`, { headers: { Authorization: `Bearer ${tok.access_token}` } })).json()) as { session: string; host: string };
  const { encryptToken } = await import("../src/crypto.js");
  await prisma.connection.create({
    data: {
      tenantId,
      provider: "accurate",
      accessTokenEnc: encryptToken(tok.access_token),
      refreshTokenEnc: encryptToken(tok.refresh_token),
      expiresAt: new Date(Date.now() + tok.expires_in * 1000),
      host: open.host,
      session: open.session,
    },
  });
  const other = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `o-${randomBytes(4).toString("hex")}`, name: "PT Lain", alias: "LAIN" },
  });
  otherTenantId = other.id;
  await prisma.storefront.create({ data: { tenantId: other.id, slug: "toko-sudah-dipakai" } });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId, expiresAt: new Date(Date.now() + 86_400_000) } });
  cookie = `sid=${sid}`;
});

afterAll(async () => {
  const { setLLMForTest } = await import("../src/ai/llm-client.js");
  setLLMForTest(null);
  await prisma.appSetting.deleteMany({ where: { key: { startsWith: "wa:shop_order:" }, value: { contains: tenantId } } });
  await prisma.aiLedger.deleteMany({ where: { tenantId } });
  await prisma.aiWallet.deleteMany({ where: { tenantId } });
  await prisma.llmUsage.deleteMany({ where: { tenantId } });
  await prisma.payment.deleteMany({ where: { tenantId } });
  await prisma.auditLog.deleteMany({ where: { tenantId } });
  await prisma.storefrontProduct.deleteMany({ where: { tenantId } });
  await prisma.storefront.deleteMany({ where: { tenantId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.rolePermission.deleteMany({ where: { roleId } });
  await prisma.role.deleteMany({ where: { id: roleId } });
  await prisma.connection.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.storefront.deleteMany({ where: { tenantId: otherTenantId } });
  await prisma.tenant.deleteMany({ where: { id: otherTenantId } });
  mockSrv.closeAllConnections();
  await new Promise((r) => mockSrv.close(r));
  await prisma.$disconnect();
});

describe("storefront", () => {
  it("GET admin membuat slug random dan pengaturan default", async () => {
    const res = await request(api).get("/api/storefront").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.slug).toMatch(/^toko-[a-f0-9]{8}$/);
    expect(res.body.mode).toBe("product");
    expect(res.body.template).toBe("product-1");
    expect(res.body.publicUrl).toContain(`/t/${res.body.slug}`);
  });

  it("slug availability + ganti slug + template hanya sesuai mode", async () => {
    const check = await request(api).get("/api/storefront/slug?slug=toko-uji-baru").set("Cookie", cookie);
    expect(check.status).toBe(200);
    expect(check.body.available).toBe(true);

    const taken = await request(api).get("/api/storefront/slug?slug=toko-sudah-dipakai").set("Cookie", cookie);
    expect(taken.status).toBe(200);
    expect(taken.body.available).toBe(false);
    expect(taken.body.reason).toContain("dipakai");

    const bad = await request(api)
      .put("/api/storefront")
      .set("Cookie", cookie)
      .send({ mode: "service", template: "product-2" });
    expect(bad.status).toBe(400);

    const conflict = await request(api)
      .put("/api/storefront")
      .set("Cookie", cookie)
      .send({ slug: "toko-sudah-dipakai" });
    expect(conflict.status).toBe(409);

    const ok = await request(api)
      .put("/api/storefront")
      .set("Cookie", cookie)
      .send({
        slug: "toko-uji-baru",
        mode: "service",
        template: "service-2",
        theme: "forest",
        bannerUrl: "/icon-192.png",
        tagline: "Layanan profesional",
        description: "Kami siap membantu.",
        whatsapp: "081234567890",
      });
    expect(ok.status).toBe(200);
    expect(ok.body.slug).toBe("toko-uji-baru");
    expect(ok.body.mode).toBe("service");
    expect(ok.body.template).toBe("service-2");
    expect(ok.body.theme).toBe("forest");
    expect(ok.body.bannerUrl).toBe("/icon-192.png");
    expect(ok.body.whatsapp).toBe("081234567890");

    const nonflat = await request(api)
      .put("/api/storefront")
      .set("Cookie", cookie)
      .send({ mode: "product", template: "product-4" });
    expect(nonflat.status).toBe(200);
    expect(nonflat.body.template).toBe("product-4");

    const nonflatService = await request(api)
      .put("/api/storefront")
      .set("Cookie", cookie)
      .send({ mode: "service", template: "service-4" });
    expect(nonflatService.status).toBe(200);
    expect(nonflatService.body.template).toBe("service-4");
  });

  it("sinkron produk dari Accurate + enrich lokal", async () => {
    const sync = await request(api).post("/api/storefront/products/sync").set("Cookie", cookie);
    expect(sync.status).toBe(200);
    expect(sync.body.created).toBeGreaterThan(0);

    const list = await request(api).get("/api/storefront/products").set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.products.length).toBeGreaterThan(0);
    const p = list.body.products[0];
    expect(p.itemNo).toBeTruthy();
    expect(p.price).toBeGreaterThan(0);

    const update = await request(api)
      .put(`/api/storefront/products/${p.id}`)
      .set("Cookie", cookie)
      .send({
        title: "Produk Unggulan",
        description: "Deskripsi storefront",
        images: ["/icon-192.png", "/icon-512.png"],
        category: "Contoh",
        featured: true,
      });
    expect(update.status).toBe(200);
    expect(update.body.product.title).toBe("Produk Unggulan");
    expect(update.body.product.featured).toBe(true);
    expect(update.body.product.images).toHaveLength(2);
    firstProductId = p.id;

    const pub = await request(api).get("/api/public/storefront/toko-uji-baru");
    expect(pub.status).toBe(200);
    expect(pub.body.store.mode).toBe("service");
    expect(pub.body.store.theme).toBe("forest");
    expect(pub.body.store.bannerUrl).toBe("/icon-192.png");
    const enriched = pub.body.products.find((x: { title: string }) => x.title === "Produk Unggulan");
    expect(enriched.images).toHaveLength(2);
  });

  it("AI membuat deskripsi produk (fake LLM) dan memakai saldo", async () => {
    const { FakeLLMClient } = await import("../src/ai/fake-llm.js");
    const { setLLMForTest } = await import("../src/ai/llm-client.js");
    await prisma.aiWallet.upsert({
      where: { userId },
      create: { userId, tenantId, balance: 100_000 },
      update: { balance: 100_000 },
    });
    setLLMForTest(
      () => new FakeLLMClient([{ parts: [{ text: "Kopi arabika pilihan dengan aroma fruity dan body seimbang." }] }])
    );
    const res = await request(api)
      .post(`/api/storefront/products/${firstProductId}/ai-description`)
      .set("Cookie", cookie)
      .send({ tone: "menjual", keywords: "arabika, premium" });
    expect(res.status).toBe(200);
    expect(res.body.description).toContain("Kopi arabika");
    setLLMForTest(null);
  });

  it("generate deskripsi massal memproses batch produk", async () => {
    const { FakeLLMClient } = await import("../src/ai/fake-llm.js");
    const { setLLMForTest } = await import("../src/ai/llm-client.js");
    setLLMForTest(
      () =>
        new FakeLLMClient([
          { parts: [{ text: "Deskripsi massal produk pertama." }] },
          { parts: [{ text: "Deskripsi massal produk kedua." }] },
          { parts: [{ text: "Deskripsi massal produk ketiga." }] },
        ])
    );
    const res = await request(api)
      .post("/api/storefront/products/ai-description-bulk")
      .set("Cookie", cookie)
      .send({ scope: "all", tone: "informatif", after: null, limit: 10 });
    expect(res.status).toBe(200);
    expect(res.body.processed).toBeGreaterThan(0);
    expect(res.body.updated).toBe(res.body.processed);
    expect(res.body.done).toBe(true);
    const rows = await prisma.storefrontProduct.findMany({ where: { tenantId } });
    expect(rows.every((row) => row.description.length > 0)).toBe(true);
    setLLMForTest(null);
  });

  it("storefront produk membuat order publik", async () => {
    await request(api)
      .put("/api/storefront")
      .set("Cookie", cookie)
      .send({ mode: "product", template: "product-1" });
    const list = await request(api).get("/api/storefront/products").set("Cookie", cookie);
    const p = list.body.products.find((x: { active: boolean; price: number | null }) => x.active && (x.price ?? 0) > 0);
    expect(p).toBeTruthy();
    const res = await request(api)
      .post("/api/public/storefront/toko-uji-baru/order")
      .send({
        customerName: "Pembeli Uji",
        phone: "081234567890",
        fulfillment: "pickup",
        items: [{ id: p.id, qty: 1 }],
      });
    expect(res.status).toBe(200);
    expect(res.body.orderId).toMatch(/^shop-/);
    expect(res.body.total).toBeGreaterThan(0);
    const status = await request(api).get(`/api/public/storefront/toko-uji-baru/order/${res.body.orderId}`);
    expect(status.status).toBe(200);
    expect(status.body.status).toBe("pending");
    lastOrderId = res.body.orderId;
  });

  it("lacak publik menerima nomor resi dan menolak yang tidak dikenal", async () => {
    const { patchShopOrder } = await import("../src/wa/shop-order.js");
    await patchShopOrder(lastOrderId, (o) => {
      o.shipping = {
        ...(o.shipping ?? {}),
        waybillId: "WYB-TEST-123",
        courierCode: "jne",
        courierName: "JNE",
        serviceName: "REG",
        status: "in_transit",
      };
    });
    const found = await request(api).get(
      "/api/public/storefront/toko-uji-baru/track?resi=WYB-TEST-123"
    );
    expect(found.status).toBe(200);
    expect(found.body.orderId).toBe(lastOrderId);
    expect(found.body.waybillId).toBe("WYB-TEST-123");
    expect(found.body.courier).toContain("JNE");

    const missing = await request(api).get(
      "/api/public/storefront/toko-uji-baru/track?resi=WYB-TIDAK-ADA"
    );
    expect(missing.status).toBe(404);
  });
});
