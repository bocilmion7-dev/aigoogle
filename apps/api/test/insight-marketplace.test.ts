import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import {
  aggregateOffers,
  isRelevantShopping,
  normalizeMarketplace,
  parseShoppingResults,
} from "../src/wawasan/marketplace.js";
import { wibDate } from "../src/wawasan/time.js";

let api: ReturnType<typeof createApp>;
let tenantId = "";
let userId = "";
let cookie = "";

beforeAll(async () => {
  process.env.SERPAPI_KEY = "kunci-uji";
  api = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `mk-${randomBytes(3).toString("hex")}`, name: "PT Market", alias: "MKT" },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({ data: { tenantId, key: "admin", name: "Admin" } });
  const user = await prisma.user.create({
    data: {
      tenantId,
      providerUserId: `mk-${randomBytes(3).toString("hex")}`,
      email: `mk-${randomBytes(3).toString("hex")}@demo.local`,
      name: "Market Admin",
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
        matched: ["charger"],
        topItems: ["Charger Iphone"],
        topProducts: [{ name: "Charger Iphone", price: 200000, revenue: 400000 }],
      },
    },
  });
  await prisma.marketplacePrice.createMany({
    data: [
      { tenantId, productName: "Charger Iphone", marketplace: "Shopee", price: 185000, title: "Charger iPhone Shopee", link: "https://shopee.co.id/a" },
      { tenantId, productName: "Charger Iphone", marketplace: "Shopee", price: 245000, title: "Charger iPhone Shopee set", link: "https://shopee.co.id/a2" },
      { tenantId, productName: "Charger Iphone", marketplace: "Tokopedia", price: 190000, title: "Charger iPhone Tokopedia", link: "https://tokopedia.com/b" },
      { tenantId, productName: "Charger Iphone", marketplace: "Lazada", price: 210000, title: "Charger iPhone Lazada", link: "https://lazada.co.id/c" },
    ],
  });
  // tandai sudah refresh hari ini (jangan panggil API eksternal)
  for (const key of [`insight:marketplace_last:${tenantId}`, `insight:price_last:${tenantId}`]) {
    await prisma.appSetting.upsert({ where: { key }, create: { key, value: wibDate() }, update: { value: wibDate() } });
  }
});

afterAll(async () => {
  delete process.env.SERPAPI_KEY;
  await prisma.marketplacePrice.deleteMany({ where: { tenantId } });
  await prisma.newsDigest.deleteMany({ where: { tenantId } });
  await prisma.tenantIndustry.deleteMany({ where: { tenantId } });
  await prisma.appSetting.deleteMany({ where: { key: { contains: tenantId } } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.role.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("harga antar marketplace", () => {
  it("parse hasil Google Shopping + normalisasi marketplace", () => {
    const items = parseShoppingResults({
      shopping_results: [
        { title: "Charger iPhone", source: "Shopee Indonesia", price: "Rp185.000", link: "https://shopee.co.id/a" },
        { title: "Charger iPhone", source: "Tokopedia", extracted_price: 190000, link: "https://tokopedia.com/b" },
        { title: "Tanpa harga", source: "Lazada", link: "https://lazada.co.id/c" },
      ],
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ marketplace: "Shopee", price: 185000 });
    expect(items[1]).toMatchObject({ marketplace: "Tokopedia", price: 190000 });
    expect(normalizeMarketplace("TikTok Shop")).toBe("TikTok Shop");
  });

  it("GET /api/insight menyertakan perbandingan marketplace + termurah", async () => {
    const r = await request(api).get("/api/insight").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.marketplaceReady).toBe(true);
    const mp = (r.body.marketplaces as Array<Record<string, unknown>>).find((m) => m.productName === "Charger Iphone")!;
    expect(mp).toBeTruthy();
    expect(mp.ownPrice).toBe(200000);
    expect(mp.cheapestMarketplace).toBe("Shopee");
    expect(mp.cheapestPrice).toBe(185000);
    expect(mp.deltaPct).toBe(8); // (200.000-185.000)/185.000 ≈ 8%
    const items = mp.items as Array<{ marketplace: string; price: number; maxPrice: number }>;
    expect(items.map((i) => i.marketplace)).toEqual(["Shopee", "Tokopedia", "Lazada"]);
    expect(items[0]!.price).toBe(185000);
    expect(items[0]!.maxPrice).toBe(245000); // rentang min–max per marketplace
    expect(items[1]!.price).toBe(190000);
    expect(items[2]!.maxPrice).toBe(210000);
  });

  it("agregasi penawaran → min–max per marketplace, buang yang tak relevan", () => {
    const offers = [
      { marketplace: "Shopee", price: 90000, title: "Charger iPhone 5 original", link: "https://shopee.co.id/a" },
      { marketplace: "Shopee", price: 150000, title: "Charger iPhone 5 set", link: "https://shopee.co.id/b" },
      { marketplace: "Tokopedia", price: 120000, title: "Charger untuk iPhone 5", link: "https://tokopedia.com/c" },
      { marketplace: "eBay", price: 40000, title: "Charger iPhone 5 cable", link: "https://ebay.com/d" },
      { marketplace: "Lazada", price: 3000, title: "iPhone 5 charger dock", link: "https://lazada.co.id/e" },
      { marketplace: "Shopee", price: 100000, title: "Kabel data Samsung Type C", link: "https://shopee.co.id/f" },
    ];
    const items = aggregateOffers(offers, "Charger Iphone 5/5S", 200000);
    expect(items.map((i) => i.marketplace)).toEqual(["Shopee", "Tokopedia"]);
    expect(items[0]).toMatchObject({ price: 90000, maxPrice: 150000 });
    expect(items[1]).toMatchObject({ price: 120000, maxPrice: 120000 });
    // bukan penjual luar negeri
    expect(items.some((i) => i.marketplace === "eBay")).toBe(false);
    // di luar pita harga wajar (3.000 vs 200.000)
    expect(items.some((i) => i.marketplace === "Lazada")).toBe(false);
  });

  it("utamakan marketplace Indonesia; kalau tak ada, pakai toko lokal", () => {
    const local = aggregateOffers(
      [
        { marketplace: "Jakartanotebook", price: 95000, title: "Charger iPhone 5", link: "https://jakartanotebook.com/a" },
        { marketplace: "Microless.com", price: 110000, title: "Charger iPhone 5", link: "https://microless.com/b" },
      ],
      "Charger Iphone 5/5S",
      200000
    );
    expect(local.map((i) => i.marketplace)).toEqual(["Jakartanotebook", "Microless.com"]);

    const withMp = aggregateOffers(
      [
        { marketplace: "Jakartanotebook", price: 50000, title: "Charger iPhone 5", link: "https://jakartanotebook.com/a" },
        { marketplace: "Shopee", price: 90000, title: "Charger iPhone 5", link: "https://shopee.co.id/b" },
      ],
      "Charger Iphone 5/5S",
      200000
    );
    expect(withMp.map((i) => i.marketplace)).toEqual(["Shopee"]);
  });

  it("relevansi judul: wajib kata produk + nomor model utuh", () => {
    expect(isRelevantShopping("Tempered Glass iPhone 6 4.7 inch", "Anti Gores Iphone 6")).toBe(true);
    expect(isRelevantShopping("Tempered Glass iPhone 16 Pro Max", "Anti Gores Iphone 6")).toBe(false);
    expect(isRelevantShopping("Casing hp cover karakter", "Hard Case")).toBe(true);
    expect(isRelevantShopping("Sepatu lari pria", "Hard Case")).toBe(false);
  });

  it("iPhone 6S 128GB hanya cocok dengan model & kapasitas yang sama", () => {
    const p = "iPhone 6S 128 GB";
    expect(isRelevantShopping("Apple iPhone 6S 128GB Garansi Resmi", p)).toBe(true);
    expect(isRelevantShopping("iPhone 6s 128 GB second mulus", p)).toBe(true);
    expect(isRelevantShopping("iPhone 6 128GB", p)).toBe(false);
    expect(isRelevantShopping("iPhone 7 128GB", p)).toBe(false);
    expect(isRelevantShopping("iPhone 16 128GB", p)).toBe(false);
    expect(isRelevantShopping("iPhone 6S Plus 128GB", p)).toBe(false);
    expect(isRelevantShopping("iPhone 6S Pro 128GB", p)).toBe(false);
    expect(isRelevantShopping("iPhone 6S 64GB", p)).toBe(false);
    expect(isRelevantShopping("iPhone 6S 32 GB", p)).toBe(false);
    // judul multi-kapasitas → ambigu, tolak
    expect(isRelevantShopping("iPhone 6S 16gb/32gb/64gb/128gb second", p)).toBe(false);
  });

  it("generik: cocok ketat lintas bidang usaha (bukan hanya HP)", () => {
    // semen 50kg: beda berat / beda merek ditolak
    const semen = "Semen Tiga Roda 50 kg";
    expect(isRelevantShopping("Semen Tiga Roda 50kg sak", semen)).toBe(true);
    expect(isRelevantShopping("Semen Gresik 50 kg", semen)).toBe(false);
    expect(isRelevantShopping("Semen Tiga Roda 40 kg", semen)).toBe(false);

    // oli 1L: beda volume ditolak
    const oli = "Oli Shell Helix 1 L";
    expect(isRelevantShopping("Shell Helix 1L sintetik", oli)).toBe(true);
    expect(isRelevantShopping("Shell Helix 4 Liter", oli)).toBe(false);

    // kabel 2 meter: beda panjang ditolak
    const kabel = "Kabel HDMI 2 m";
    expect(isRelevantShopping("Kabel HDMI 2 meter 4K", kabel)).toBe(true);
    expect(isRelevantShopping("Kabel HDMI 5 m", kabel)).toBe(false);

    // sepatu ukuran 42: beda ukuran ditolak
    const sepatu = "Sepatu Nike Air 42";
    expect(isRelevantShopping("Nike Air ukuran 42 original", sepatu)).toBe(true);
    expect(isRelevantShopping("Nike Air ukuran 44", sepatu)).toBe(false);
  });
});
