import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { buildQueryList, buildQuerySpec, matchGroups, matchesProduct, parsePrice, phoneModelMatch } from "../src/wawasan/market-price.js";
import { wibDate } from "../src/wawasan/time.js";

let api: ReturnType<typeof createApp>;
let tenantId = "";
let userId = "";
let cookie = "";

beforeAll(async () => {
  api = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `pr-${randomBytes(3).toString("hex")}`, name: "PT Harga", alias: "PRC" },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({ data: { tenantId, key: "admin", name: "Admin" } });
  const user = await prisma.user.create({
    data: {
      tenantId,
      providerUserId: `pr-${randomBytes(3).toString("hex")}`,
      email: `pr-${randomBytes(3).toString("hex")}@demo.local`,
      name: "Harga Admin",
      roleId: role.id,
    },
  });
  userId = user.id;
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId, expiresAt: new Date(Date.now() + 86_400_000) } });
  cookie = `sid=${sid}`;

  await prisma.tenantIndustry.create({
    data: {
      tenantId,
      industry: "aksesoris_gadget",
      weight: 0.9,
      evidence: {
        label: "Aksesoris & Gadget",
        matched: ["iphone"],
        topItems: ["Anti Gores Iphone 5", "Charger Iphone"],
        topProducts: [
          { name: "Anti Gores Iphone 5", price: 50000, revenue: 500000 },
          { name: "Charger Iphone", price: 150000, revenue: 300000 },
        ],
      },
    },
  });
  const now = new Date();
  await prisma.priceSignal.createMany({
    data: [
      {
        tenantId,
        productName: "Anti Gores Iphone 5",
        ownPrice: 50000,
        marketPrice: 45000,
        title: "Harga anti gores iPhone 5 di marketplace",
        sourceName: "Kontan",
        sourceUrl: "https://www.kontan.co.id/a",
        publishedAt: now,
      },
      {
        tenantId,
        productName: "Anti Gores Iphone 5",
        ownPrice: 50000,
        marketPrice: 55000,
        title: "Harga tempered glass iPhone 5 terbaru",
        sourceName: "Bisnis",
        sourceUrl: "https://www.bisnis.com/b",
        publishedAt: now,
      },
    ],
  });
  // lewati refresh jaringan: tandai sudah diperbarui hari ini
  await prisma.appSetting.upsert({
    where: { key: `insight:price_last:${tenantId}` },
    create: { key: `insight:price_last:${tenantId}`, value: wibDate() },
    update: { value: wibDate() },
  });
});

afterAll(async () => {
  await prisma.priceSignal.deleteMany({ where: { tenantId } });
  await prisma.newsDigest.deleteMany({ where: { tenantId } });
  await prisma.tenantIndustry.deleteMany({ where: { tenantId } });
  await prisma.appSetting.deleteMany({ where: { key: `insight:price_last:${tenantId}` } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.role.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("harga pasar & pesaing", () => {
  it("parse harga rupiah dari teks berita", () => {
    expect(parsePrice("Harga Rp 1.299.000 di toko")).toBe(1299000);
    expect(parsePrice("dijual Rp1,2 juta")).toBe(1200000);
    expect(parsePrice("mulai Rp50rb")).toBe(50000);
    expect(parsePrice("tidak ada harga")).toBeNull();
  });

  it("cocokkan nama produk dengan teks berita (ketat, hindari salah produk)", () => {
    expect(matchesProduct("Harga Anti Gores iPhone 5 murah", "Anti Gores Iphone 5")).toBe(true);
    expect(matchesProduct("Berita ekonomi makro", "Anti Gores Iphone 5")).toBe(false);
    // artikel produk lain tidak boleh dianggap harga produk kita
    expect(matchesProduct("Harga HP Samsung Galaxy A07 Rp2,59 juta", "Iphone 6 S 128 GB")).toBe(false);
    expect(matchesProduct("Tecno Megabook laptop harga Rp8,5 juta", "Iphone 6  32 GB")).toBe(false);
    expect(matchesProduct("Harga iPhone 16 terbaru", "Iphone 6 S 128 GB")).toBe(false);
    expect(matchesProduct("Harga iPhone 6 second terbaru", "Iphone 6 S 128 GB")).toBe(true);
  });

  it("barang sejenis: query tipe + merek dan pencocokan grup", () => {
    const spec = buildQuerySpec("Anti Gores Iphone 6");
    expect(spec.query).toContain("tempered glass");
    expect(spec.query).toContain("iphone");
    expect(matchGroups("Daftar harga tempered glass iPhone terbaru", spec.groups)).toBe(true);
    expect(matchGroups("Harga laptop gaming terbaru", spec.groups)).toBe(false);

    const casing = buildQuerySpec("Hard Case");
    expect(casing.query).toContain("casing");
    expect(matchGroups("Harga casing HP terbaru", casing.groups)).toBe(true);

    const phone = buildQueryList("Iphone 6 S 128 GB");
    expect(phone.length).toBeGreaterThan(1);
    expect(phone[0]!.query).toContain("iphone 6");
    expect(phone[0]!.numbers).toEqual(["6"]); // 128 GB = kapasitas, bukan model
    expect(phoneModelMatch("Harga iPhone 6S bekas Rp2 juta", "iphone", ["6"])).toBe(true);
    expect(phoneModelMatch("6 iPhone harga Rp2 jutaan", "iphone", ["6"])).toBe(false);
    expect(phoneModelMatch("Harga iPhone 16 terbaru", "iphone", ["6"])).toBe(false);
  });

  it("GET /api/insight menyertakan perbandingan harga pasar", async () => {
    const r = await request(api).get("/api/insight").set("Cookie", cookie);
    expect(r.status).toBe(200);
    const prices = r.body.prices as Array<Record<string, unknown>>;
    expect(prices.length).toBeGreaterThanOrEqual(2);
    const first = prices.find((p) => p.productName === "Anti Gores Iphone 5")!;
    expect(first).toMatchObject({
      ownPrice: 50000,
      marketMin: 45000,
      marketMax: 55000,
      marketMedian: 50000,
      sampleCount: 2,
    });
    expect(first.deltaPct).toBe(0);
    expect((first.sources as unknown[]).length).toBe(2);
    // produk tanpa sinyal pasar tetap muncul (jujur "belum terpantau")
    const charger = prices.find((p) => p.productName === "Charger Iphone")!;
    expect(charger.marketMedian).toBeNull();
  });
});
