import { prisma } from "../db.js";
import { fetchRssXml, googleNewsUrl, parseGoogleNews } from "./sources.js";
import { wibDate } from "./time.js";

/**
 * Pemantau harga pasar/pesaing untuk produk yang benar-benar dijual tenant.
 * Sumber: berita/marketplace yang terindeks Google News per nama produk
 * (hanya domain whitelist). Angka diambil dari teks artikel — bukan karangan.
 */

export interface PriceSource {
  title: string;
  url: string;
  sourceName: string;
  publishedAt: string | null;
}

export interface PriceComparison {
  productName: string;
  ownPrice: number | null;
  marketMin: number | null;
  marketMax: number | null;
  marketMedian: number | null;
  deltaPct: number | null;
  sampleCount: number;
  /** product = harga produk spesifik; brand = kisaran umum barang sejenis */
  scope: "product" | "brand";
  sources: PriceSource[];
}

interface ProductRef {
  name: string;
  price: number | null;
  revenue: number;
}

/** Produk teratas tenant (dari evidence deteksi industri). */
export async function topTenantProducts(tenantId: string, limit = 5): Promise<ProductRef[]> {
  const rows = await prisma.tenantIndustry.findMany({ where: { tenantId }, select: { evidence: true } });
  const byName = new Map<string, ProductRef>();
  for (const r of rows) {
    const ev = (r.evidence ?? {}) as {
      topProducts?: Array<{ name?: string; price?: number; revenue?: number }>;
      topItems?: string[];
    };
    if (Array.isArray(ev.topProducts)) {
      for (const p of ev.topProducts) {
        const name = String(p.name ?? "").trim();
        if (!name) continue;
        const prev = byName.get(name.toLowerCase());
        const price = Number(p.price) > 0 ? Number(p.price) : null;
        const revenue = Number(p.revenue) || 0;
        if (!prev || revenue > prev.revenue) byName.set(name.toLowerCase(), { name, price, revenue });
      }
    }
  }
  return [...byName.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
}

/** Semua harga rupiah dalam teks ("Rp 1.299.000", "Rp1,2 juta", "Rp4–8 juta"). */
export function parsePrices(text: string): number[] {
  const t = text.replace(/\u00a0/g, " ");
  const re = /(?:Rp|IDR)\s*\.?\s*(\d[\d.,]*)\s*(juta|jt|ribu|rb|k)?/gi;
  const out: number[] = [];
  for (const m of t.matchAll(re)) {
    let n = Number(m[1].replace(/\./g, "").replace(/,/g, "."));
    const suf = (m[2] ?? "").toLowerCase();
    if (suf === "juta" || suf === "jt") n *= 1_000_000;
    else if (suf === "ribu" || suf === "rb" || suf === "k") n *= 1_000;
    if (Number.isFinite(n) && n >= 500 && n <= 5_000_000_000) out.push(Math.round(n));
  }
  return out;
}

/** Ambil harga rupiah pertama pada teks. */
export function parsePrice(text: string): number | null {
  return parsePrices(text)[0] ?? null;
}

/** aturan "barang sejenis": tipe produk + opsi merek → query harga pasar */
const TYPE_RULES: Array<{ match: string[]; query: string; groups: string[][] }> = [
  { match: ["anti gores", "tempered", "screen guard"], query: "tempered glass", groups: [["tempered", "anti gores", "anti-gores", "screen guard"]] },
  { match: ["hard case", "casing", "case", "cover"], query: "casing hp", groups: [["casing", "case", "cover", "hard case"]] },
  { match: ["charger", "kabel", "cable", "adapter"], query: "charger hp", groups: [["charger", "kabel", "cable", "adapter"]] },
  { match: ["powerbank", "power bank"], query: "powerbank", groups: [["powerbank", "power bank"]] },
  { match: ["earphone", "headset", "tws", "airpods"], query: "tws earphone", groups: [["tws", "earphone", "headset", "airpods"]] },
  { match: ["lcd", "screen"], query: "lcd hp", groups: [["lcd", "layar"]] },
  { match: ["baterai", "battery"], query: "baterai hp", groups: [["baterai", "battery"]] },
  { match: ["mouse", "keyboard", "keycap"], query: "aksesoris komputer", groups: [["mouse", "keyboard", "keycap"]] },
];

const BRANDS = ["iphone", "samsung", "xiaomi", "oppo", "vivo", "realme", "infinix", "asus", "lenovo", "acer"];
const CAPACITY = new Set(["16", "32", "64", "128", "256", "512", "1024", "2048"]);
const NON_PHONE = /(tablet|laptop|komputer|kamera|monitor|printer|\btv\b)/i;

/** nomor model (bukan kapasitas penyimpanan/tahun) */
export function modelNumbers(productName: string): string[] {
  return [
    ...new Set(
      productName
        .toLowerCase()
        .replace(/[^\p{L}\p{N} ]+/gu, " ")
        .split(/\s+/)
        .filter((w) => /^\d{1,4}$/.test(w) && !CAPACITY.has(w) && Number(w) < 2000)
    ),
  ];
}

interface QuerySpec {
  query: string;
  /** tiap grup wajib punya salah satu kata muncul di teks */
  groups: string[][];
  /** nomor model yang wajib muncul (untuk produk non-tipe, mis. iPhone 6) */
  numbers: string[];
}

export function matchGroups(text: string, groups: string[][]): boolean {
  const t = text.toLowerCase();
  return groups.every((alts) => alts.some((w) => t.includes(w)));
}

/** nomor model harus menempel pada merek (mis. "iphone 6s", "samsung galaxy s7") */
export function phoneModelMatch(text: string, brand: string, numbers: string[]): boolean {
  if (!brand || !numbers.length) return false;
  const t = text.toLowerCase();
  if (!t.includes(brand)) return false;
  return numbers.some((n) => new RegExp(`${brand}[^0-9]{0,14}${n}([^0-9]|$)`).test(t));
}

/** daftar query per produk: tipe barang sejenis, atau beberapa variasi harga HP. */
export function buildQueryList(productName: string): QuerySpec[] {
  const name = productName.toLowerCase().replace(/\s+/g, " ").trim();
  const brand = BRANDS.find((b) => name.includes(b)) ?? "";
  const type = TYPE_RULES.find((r) => r.match.some((m) => name.includes(m)));
  if (type) {
    return [
      {
        query: `${type.query}${brand ? ` ${brand}` : ""}`,
        groups: brand ? [type.groups[0]!, [brand]] : [type.groups[0]!],
        numbers: [],
      },
    ];
  }
  const numbers = modelNumbers(productName);
  if (brand && numbers.length) {
    const n = numbers[0]!;
    return [
      { query: `harga ${brand} ${n}`, groups: [[brand]], numbers },
      { query: `harga ${brand} ${n} bekas`, groups: [[brand]], numbers },
      { query: `daftar harga ${brand} ${n}`, groups: [[brand]], numbers },
    ];
  }
  return [{ query: `${productName} harga`, groups: [], numbers }];
}

/** Susun query harga pasar: barang sejenis (tipe+merek) atau nama produk untuk HP. */
export function buildQuerySpec(productName: string): QuerySpec {
  const name = productName.toLowerCase().replace(/\s+/g, " ").trim();
  const brand = BRANDS.find((b) => name.includes(b)) ?? "";
  const type = TYPE_RULES.find((r) => r.match.some((m) => name.includes(m)));
  if (type) {
    return {
      query: `${type.query}${brand ? ` ${brand}` : ""}`,
      groups: brand ? [type.groups[0]!, [brand]] : [type.groups[0]!],
      numbers: [],
    };
  }
  // produk non-aksesoris (mis. iPhone 6 128GB): pakai nama + nomor model
  return { query: `${productName} harga`, groups: [], numbers: modelNumbers(productName) };
}

/**
 * Cocokkan nama produk dengan teks berita secara KETAT:
 * - nama lengkap muncul → cocok
 * - wajib ada minimal satu kata (≥3 huruf) dari nama produk
 * - bila nama memuat nomor model (6, 128), nomor itu harus muncul sebagai angka utuh
 *   (mencegah "iPhone 6" cocok dengan "iPhone 16" / "2026").
 */
export function matchesProduct(text: string, productName: string): boolean {
  const t = text.toLowerCase();
  const normName = productName.toLowerCase().replace(/\s+/g, " ").trim();
  if (normName && t.includes(normName)) return true;
  const words = productName
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const letters = [...new Set(words.filter((w) => /\p{L}/u.test(w) && w.length >= 3))];
  const numbers = [...new Set(words.filter((w) => /^\d{1,4}$/.test(w)))];
  if (!letters.length) return false;
  if (!letters.some((w) => t.includes(w))) return false;
  if (numbers.length) {
    const hasNumber = numbers.some((n) => new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(t));
    if (!hasNumber) return false;
  }
  return true;
}

/** Perbarui sinyal harga tenant (maks 5 produk/hari). */
export async function refreshPriceSignals(tenantId: string): Promise<number> {
  const products = await topTenantProducts(tenantId, 5);
  if (!products.length) return 0;
  let inserted = 0;
  for (const p of products) {
    const specs = buildQueryList(p.name);
    for (const spec of specs) {
      // harga barang sejenis tetap relevan > 7 hari → jendela 180 hari
      const xml = await fetchRssXml(googleNewsUrl(spec.query, 180));
      if (!xml) continue;
      for (const it of parseGoogleNews(xml).slice(0, 15)) {
        const text = `${it.title} ${it.snippet}`;
        const marketPrice = parsePrice(text);
        if (!marketPrice) continue;
        const brand = BRANDS.find((b) => p.name.toLowerCase().includes(b)) ?? "";
        // jangan tertukar dengan tablet/laptop/kamera dll.
        if (NON_PHONE.test(text) && !NON_PHONE.test(p.name)) continue;
        if (spec.groups.length) {
          if (!matchGroups(text, spec.groups)) continue;
          if (spec.numbers.length && brand && !phoneModelMatch(text, brand, spec.numbers)) continue;
        } else {
          if (!matchesProduct(text, p.name)) continue;
          if (spec.numbers.length) {
            const ok = spec.numbers.some((n) => new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(text.toLowerCase()));
            if (!ok) continue;
          }
        }
        await prisma.priceSignal
          .upsert({
            where: { tenantId_sourceUrl: { tenantId, sourceUrl: it.url } },
            create: {
              tenantId,
              productName: p.name,
              ownPrice: p.price,
              marketPrice,
              title: it.title.slice(0, 300),
              snippet: it.snippet,
              sourceName: it.sourceName.slice(0, 120),
              sourceUrl: it.url,
              publishedAt: it.publishedAt,
            },
            update: { fetchedAt: new Date(), marketPrice, ownPrice: p.price },
          })
          .then(() => {
            inserted += 1;
          })
          .catch(() => null);
      }
    }
  }
  await prisma.priceSignal
    .deleteMany({ where: { tenantId, fetchedAt: { lt: new Date(Date.now() - 14 * 86400_000) } } })
    .catch(() => null);
  return inserted;
}

/** Pastikan pemantauan harga sudah jalan hari ini (sekali/hari). */
export async function ensurePriceSignals(tenantId: string): Promise<void> {
  const key = `insight:price_last:${tenantId}`;
  const today = wibDate();
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (row?.value === today) return;
  await refreshPriceSignals(tenantId).catch(() => 0);
  await prisma.appSetting
    .upsert({ where: { key }, create: { key, value: today }, update: { value: today } })
    .catch(() => null);
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

/** Bandingkan harga jual tenant vs harga pasar terpantau. */
export async function priceComparison(tenantId: string): Promise<PriceComparison[]> {
  const [products, rows] = await Promise.all([
    topTenantProducts(tenantId, 6),
    prisma.priceSignal.findMany({
      where: { tenantId, fetchedAt: { gte: new Date(Date.now() - 14 * 86400_000) } },
      orderBy: { fetchedAt: "desc" },
      take: 200,
    }),
  ]);
  const byProduct = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.productName.toLowerCase();
    const list = byProduct.get(key) ?? [];
    list.push(r);
    byProduct.set(key, list);
  }
  const out: PriceComparison[] = [];
  const keys = new Set<string>();
  for (const p of products) {
    keys.add(p.name.toLowerCase());
    const sig = byProduct.get(p.name.toLowerCase()) ?? [];
    const prices = sig.map((s) => s.marketPrice).filter((n) => Number.isFinite(n) && n > 0);
    const own = p.price && p.price > 0 ? p.price : null;
    if (prices.length) {
      const marketMedian = median(prices);
      out.push({
        productName: p.name,
        ownPrice: own,
        marketMin: Math.min(...prices),
        marketMax: Math.max(...prices),
        marketMedian,
        deltaPct: own && marketMedian ? Math.round(((own - marketMedian) / marketMedian) * 100) : null,
        sampleCount: prices.length,
        scope: "product",
        sources: sig.slice(0, 3).map((s) => ({
          title: s.title,
          url: s.sourceUrl,
          sourceName: s.sourceName,
          publishedAt: s.publishedAt ? s.publishedAt.toISOString() : null,
        })),
      });
      continue;
    }
    // tidak ada harga produk yang cocok → jujur "belum terpantau"
    out.push({
      productName: p.name,
      ownPrice: own,
      marketMin: null,
      marketMax: null,
      marketMedian: null,
      deltaPct: null,
      sampleCount: 0,
      scope: "product",
      sources: [],
    });
  }
  // produk yang tidak lagi teratas tapi punya sinyal tetap ditampilkan (maks 2)
  for (const [key, sig] of byProduct) {
    if (keys.has(key) || out.length >= 8) continue;
    const prices = sig.map((s) => s.marketPrice);
    const marketMedian = median(prices);
    out.push({
      productName: sig[0]!.productName,
      ownPrice: sig[0]!.ownPrice && sig[0]!.ownPrice > 0 ? sig[0]!.ownPrice : null,
      marketMin: Math.min(...prices),
      marketMax: Math.max(...prices),
      marketMedian,
      deltaPct: null,
      sampleCount: prices.length,
      scope: "product",
      sources: sig.slice(0, 3).map((s) => ({
        title: s.title,
        url: s.sourceUrl,
        sourceName: s.sourceName,
        publishedAt: s.publishedAt ? s.publishedAt.toISOString() : null,
      })),
    });
  }
  return out;
}
