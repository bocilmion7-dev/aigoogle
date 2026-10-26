import { describe, expect, it } from "vitest";
import { rankNews, scoreNews, whyFor, type NewsLike } from "../src/wawasan/rank.js";

const item = (over: Partial<NewsLike>): NewsLike => ({
  id: over.id ?? "n1",
  url: "https://example.test/1",
  title: "Berita",
  snippet: "",
  sourceName: "Kontan",
  sourceDomain: "kontan.co.id",
  publishedAt: new Date(),
  topic: "tren",
  industries: "aksesoris_gadget",
  ...over,
});

describe("skor & ranking berita", () => {
  const ctx = {
    industryKeys: ["aksesoris_gadget"],
    newsKeywords: ["aksesoris hp", "gadget"],
    productKeywords: ["iphone", "charger"],
  };

  it("kata kunci produk di judul lebih kuat + domain resmi dapat bonus", () => {
    const a = scoreNews(item({ title: "Harga iPhone baru naik", sourceDomain: "kontan.co.id" }), ctx);
    const b = scoreNews(item({ title: "Berita ekonomi umum", sourceDomain: "kontan.co.id" }), ctx);
    const official = scoreNews(item({ title: "Aturan impor elektronik", sourceDomain: "kemenkeu.go.id" }), ctx);
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.matched).toContain("iphone");
    expect(official.score).toBeGreaterThan(b.score);
  });

  it("dedupe judul mirip dan urut skor", () => {
    const rows = [
      item({ id: "1", title: "Harga iPhone naik minggu ini", publishedAt: new Date() }),
      item({ id: "2", title: "Harga iPhone naik minggu ini - Kontan", publishedAt: new Date() }),
      item({ id: "3", title: "Tren gadget lain", publishedAt: new Date() }),
    ];
    const out = rankNews(rows, ctx, 10);
    expect(out.map((o) => o.id)).toEqual(["1", "3"]);
  });

  it("why sesuai topik", () => {
    expect(whyFor("harga")).toContain("harga pokok");
    expect(whyFor("tren")).toContain("stok");
  });
});
