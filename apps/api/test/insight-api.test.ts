import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { setLLMForTest } from "../src/ai/llm-client.js";
import { FakeLLMClient } from "../src/ai/fake-llm.js";

let api: ReturnType<typeof createApp>;
let tenantId = "";
let userId = "";
let cookie = "";
const newsIds: string[] = [];

beforeAll(async () => {
  api = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `in-${randomBytes(3).toString("hex")}`, name: "PT Insight", alias: "INS" },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({ data: { tenantId, key: "admin", name: "Admin" } });
  const user = await prisma.user.create({
    data: {
      tenantId,
      providerUserId: `in-${randomBytes(3).toString("hex")}`,
      email: `in-${randomBytes(3).toString("hex")}@demo.local`,
      name: "Insight Admin",
      roleId: role.id,
    },
  });
  userId = user.id;
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId, expiresAt: new Date(Date.now() + 86_400_000) } });
  cookie = `sid=${sid}`;

  // profil industri ter-cache (tanpa perlu koneksi Accurate)
  await prisma.tenantIndustry.create({
    data: {
      tenantId,
      industry: "aksesoris_gadget",
      weight: 0.92,
      evidence: { label: "Aksesoris & Gadget", matched: ["iphone", "charger"], topItems: ["Anti Gores Iphone 5"] },
    },
  });

  const now = new Date();
  const rows = [
    {
      url: "https://www.kontan.co.id/news/iphone-baru",
      title: "Harga iPhone baru diprediksi naik bulan ini",
      snippet: "Kenaikan harga iPhone memengaruhi penjualan aksesoris.",
      sourceName: "Kontan",
      sourceDomain: "kontan.co.id",
      publishedAt: now,
      topic: "harga",
      industries: "aksesoris_gadget",
      hash: `h-${randomBytes(4).toString("hex")}`,
    },
    {
      url: "https://www.cnbcindonesia.com/news/tren-gadget",
      title: "Tren gadget dan aksesoris HP menjelang akhir tahun",
      snippet: "Permintaan aksesoris HP meningkat.",
      sourceName: "CNBC Indonesia",
      sourceDomain: "cnbcindonesia.com",
      publishedAt: now,
      topic: "tren",
      industries: "aksesoris_gadget",
      hash: `h-${randomBytes(4).toString("hex")}`,
    },
    {
      url: "https://www.kemenkeu.go.id/berita/pajak-umkm",
      title: "Aturan pajak UMKM terbaru",
      snippet: "Kewajiban pajak usaha mikro kecil menengah.",
      sourceName: "Kemenkeu",
      sourceDomain: "kemenkeu.go.id",
      publishedAt: now,
      topic: "regulasi",
      industries: "umum",
      hash: `h-${randomBytes(4).toString("hex")}`,
    },
  ];
  for (const r of rows) {
    const created = await prisma.newsItem.create({ data: r });
    newsIds.push(created.id);
  }
});

afterAll(async () => {
  setLLMForTest(null);
  await prisma.newsAskLog.deleteMany({ where: { tenantId } });
  await prisma.newsDigest.deleteMany({ where: { tenantId } });
  await prisma.tenantIndustry.deleteMany({ where: { tenantId } });
  await prisma.newsItem.deleteMany({ where: { id: { in: newsIds } } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.role.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("API Insight", () => {
  it("GET /api/insight → label industri + feed harian terurut", async () => {
    const r = await request(api).get("/api/insight").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.industries[0]).toMatchObject({ key: "aksesoris_gadget", label: "Aksesoris & Gadget" });
    expect(Array.isArray(r.body.items)).toBe(true);
    expect(r.body.items.length).toBeGreaterThan(0);
    const first = r.body.items[0];
    expect(first.title).toBeTruthy();
    expect(first.why.length).toBeGreaterThan(10);
    expect(["harga", "tren", "regulasi", "umum"]).toContain(first.topic);
    // digest tersimpan untuk hari ini (refresh sekali sehari)
    const digest = await prisma.newsDigest.findFirst({ where: { tenantId }, orderBy: { generatedAt: "desc" } });
    expect(digest).toBeTruthy();
  });

  it("search bar tanpa konteks relevan → menolak jujur tanpa memanggil LLM", async () => {
    const fake = new FakeLLMClient([]);
    setLLMForTest(() => fake);
    const r = await request(api)
      .post("/api/insight/ask")
      .set("Cookie", cookie)
      .send({ question: "bitcoin ethereum blockchain" });
    expect(r.status).toBe(200);
    expect(r.body.answer).toBe("Belum ada informasi terkini soal itu.");
    expect(r.body.sources).toEqual([]);
    expect(fake.calls.length).toBe(0);
  });

  it("search bar dengan konteks → jawaban AI + sumber", async () => {
    const fake = new FakeLLMClient([{ parts: [{ text: "Harga iPhone diperkirakan naik [1]. Pantau dampaknya ke harga jual." }] }]);
    setLLMForTest(() => fake);
    const r = await request(api)
      .post("/api/insight/ask")
      .set("Cookie", cookie)
      .send({ question: "bagaimana harga iphone terbaru?" });
    expect(r.status).toBe(200);
    expect(r.body.answer).toContain("iPhone");
    expect(r.body.sources.length).toBeGreaterThan(0);
    expect(r.body.sources[0].url).toContain("kontan.co.id");
    expect(fake.calls.length).toBe(1);
    const log = await prisma.newsAskLog.count({ where: { tenantId } });
    expect(log).toBeGreaterThan(0);
  });

  it("batas harian tercapai → 429", async () => {
    await prisma.newsAskLog.createMany({
      data: Array.from({ length: 20 }, () => ({ tenantId, userId, question: "uji batas" })),
    });
    const r = await request(api).post("/api/insight/ask").set("Cookie", cookie).send({ question: "harga iphone?" });
    expect(r.status).toBe(429);
    expect(r.body.error).toBe("batas_harian");
  });
});
