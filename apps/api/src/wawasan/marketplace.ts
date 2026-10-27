import { prisma } from "../db.js";
import { buildQuerySpec, matchGroups, matchesProductSpec, modelNumbers, parsePrice, parseProductSpec, topTenantProducts } from "./market-price.js";
import { wibDate } from "./time.js";

/**
 * Perbandingan harga ANTAR MARKETPLACE (Shopee, Tokopedia, Lazada, Blibli, …).
 * Marketplace memblokir scraping langsung, jadi data diambil dari price API
 * (Google Shopping via SerpAPI). Aktif bila env SERPAPI_KEY diisi.
 * Tiap marketplace hanya disimpan rentang harga min–max, bukan tiap penawaran.
 */

const SERPAPI_URL = "https://serpapi.com/search.json";
const MAX_AGE_MS = 7 * 86400_000;
/** jaring pengaman kuota SerpAPI harian (lintas semua tenant) */
const DEFAULT_DAILY_LIMIT = 60;
/** selisih harga masih masuk akal dibanding harga jual (menangkal spare part / barang salah) */
const PRICE_BAND = 15;
const MAX_MARKETPLACES = 6;

export function marketplaceReady(): boolean {
  return !!process.env.SERPAPI_KEY;
}

function dailyLimit(): number {
  const n = Number(process.env.SERPAPI_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_LIMIT;
}

/** Marketplace Indonesia yang menjadi acuan perbandingan. */
export const KNOWN_MARKETPLACES = new Set([
  "Shopee",
  "Tokopedia",
  "Lazada",
  "Blibli",
  "Bukalapak",
  "Bhinneka",
  "Erafone",
  "iBox",
  "TikTok Shop",
  "JD.ID",
]);

/** Penjual luar negeri — tidak relevan untuk harga pasar Indonesia. */
const FOREIGN_SOURCE =
  /(ebay|amazon|aliexpress|alibaba|banggood|wish\.com|etsy|walmart|rakuten|carousell|mercari|qoo10|temu|shein)/i;

/** Barang lain yang sering tertangkap Google Shopping (tablet, laptop, dll.). */
const WRONG_ITEM = /(tablet|\btab\b|laptop|komputer|kamera|monitor|printer|\btv\b|smartwatch|jam tangan|\bhdd\b|\bssd\b|enclosure|hardisk|hard disk|flashdisk|memory card|\bsd card\b|power ?bank)/i;
/** "Hard Case"/"casing" adalah aksesori HP — bukan hard case penyimpanan (HDD/SSD). */
const STORAGE_CASE = /(hard\s*case|hdd|ssd|hardisk|hard disk|enclosure|flashdisk|memory card)/i;
const PRODUCT_IS_KIND = /(tablet|laptop|komputer|kamera|monitor|printer|\btv\b|smartwatch)/i;

/** Barang sejenis yang bukan kategori produk tenant (dompet, kacamata, …). */
const FOREIGN_CATEGORY = /(kacamata|earphone|headset|tws|airpods|dompet|sepatu|topi|\btas\b|stiker|gelas)/i;

export interface ShoppingOffer {
  marketplace: string;
  price: number;
  title: string;
  link: string;
}

export interface MarketplaceItem {
  marketplace: string;
  /** penawaran termurah */
  price: number;
  /** penawaran termahal */
  maxPrice: number;
  title: string;
  link: string;
}

/** Hasil agregasi — membawa juga referensi penawaran termahal untuk disimpan. */
export interface AggregatedItem extends MarketplaceItem {
  maxTitle: string;
  maxLink: string;
}

export interface MarketplaceComparison {
  productName: string;
  ownPrice: number | null;
  items: MarketplaceItem[];
  cheapestMarketplace: string | null;
  cheapestPrice: number | null;
  deltaPct: number | null;
  fetchedAt: string | null;
}

/** Nama sumber Google Shopping → nama marketplace yang rapi. */
export function normalizeMarketplace(source: string): string {
  const s = source.toLowerCase();
  if (s.includes("shopee")) return "Shopee";
  if (s.includes("tokopedia")) return "Tokopedia";
  if (s.includes("lazada")) return "Lazada";
  if (s.includes("blibli")) return "Blibli";
  if (s.includes("bukalapak")) return "Bukalapak";
  if (s.includes("bhinneka")) return "Bhinneka";
  if (s.includes("erafone")) return "Erafone";
  if (s.includes("ibox")) return "iBox";
  if (s.includes("tiktok")) return "TikTok Shop";
  if (s.includes("jd.id") || s.includes("jd id")) return "JD.ID";
  return source.trim().slice(0, 40);
}

/** Parse respons SerpAPI Google Shopping → penawaran mentah. */
export function parseShoppingResults(json: unknown): ShoppingOffer[] {
  const rows = (json as { shopping_results?: unknown[] })?.shopping_results;
  if (!Array.isArray(rows)) return [];
  const out: ShoppingOffer[] = [];
  for (const raw of rows) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const source = String(o.source ?? "").trim();
    if (!source) continue;
    const extracted = Number(o.extracted_price ?? NaN);
    const price = Number.isFinite(extracted) && extracted > 0 ? extracted : parsePrice(String(o.price ?? ""));
    const link = String(o.link ?? o.product_link ?? "").trim();
    const title = String(o.title ?? "").trim().slice(0, 200);
    if (!price || !link) continue;
    out.push({ marketplace: normalizeMarketplace(source), price: Math.round(price), title, link });
  }
  return out;
}

/**
 * Judul penawaran termasuk kategori lain (kacamata, dompet, earphone, …)
 * padahal bukan kategori produk tenant → bukan barang sejenis.
 */
function wrongCategory(title: string, productName: string): boolean {
  const m = title.match(FOREIGN_CATEGORY);
  if (!m) return false;
  return !productName.toLowerCase().includes(m[0].toLowerCase());
}

/**
 * Judul penawaran harus benar-benar soal produk yang sama:
 * minimal satu kata berhuruf dari nama produk (atau kategori sejenisnya,
 * mis. "casing" untuk "Hard Case"), dan bila ada nomor model
 * (mis. "6" pada "Anti Gores Iphone 6") nomor itu harus muncul utuh.
 */
export function isRelevantShopping(title: string, productName: string): boolean {
  const t = title.toLowerCase();
  const querySpec = buildQuerySpec(productName);
  const words = productName
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const letters = words.filter((w) => /\p{L}/u.test(w) && w.length >= 3);
  const byWord = letters.some((w) => t.includes(w));
  const isType = querySpec.groups.length > 0;

  // Barang sejenis (aksesori: casing, charger, anti gores …) → pencocokan kategori.
  if (isType) {
    if (!byWord && !matchGroups(t, querySpec.groups)) return false;
    if (wrongCategory(t, productName)) return false;
    const nums = modelNumbers(productName);
    if (nums.length && !nums.some((n) => new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(t))) return false;
    return true;
  }

  // ── Pencocokan KETAT generik (semua bidang usaha) ──
  if (!byWord) return false;
  if (wrongCategory(t, productName)) return false;

  // Kata pembeda (merek/nama produk) wajib muncul; kata pertama dianggap kategori
  // sehingga boleh tidak muncul (mis. "Oli Shell Helix" vs "Shell Helix 1L").
  const distinctive = letters.slice(1);
  if (distinctive.length && !distinctive.every((w) => t.includes(w))) return false;

  const spec = parseProductSpec(productName);
  const hasStrong = spec.models.length > 0 || spec.numbers.length > 0 || spec.measures.length > 0;
  if (hasStrong) return matchesProductSpec(title, spec);

  const numbers = modelNumbers(productName);
  if (numbers.length && !numbers.some((n) => new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(t))) {
    return false;
  }
  return true;
}

/**
 * Seleksi penawaran untuk satu produk → HARGA MIN–MAX per marketplace:
 * 1) bukan penjual luar negeri, 2) judul relevan dengan produk,
 * 3) harga masih sebanding dengan harga jual (±15×),
 * 4) utamakan marketplace Indonesia; bila tak ada, pakai toko lokal lain.
 * Terurut naik dari yang termurah.
 */
export function aggregateOffers(
  offers: ShoppingOffer[],
  productName: string,
  ownPrice: number | null
): AggregatedItem[] {
  const usable = offers.filter((it) => {
    if (FOREIGN_SOURCE.test(it.marketplace)) return false;
    if (!isRelevantShopping(it.title, productName)) return false;
    if (WRONG_ITEM.test(it.title) && !PRODUCT_IS_KIND.test(productName)) return false;
    // jangan campur aksesori HP ("Hard Case") dengan wadah penyimpanan (HDD/SSD enclosure)
    if (STORAGE_CASE.test(it.title) && /hard\s*case|casing|cover/i.test(productName) && !/hdd|ssd|hardisk|hard disk/i.test(productName)) {
      return false;
    }
    if (ownPrice && ownPrice > 0 && (it.price < ownPrice / PRICE_BAND || it.price > ownPrice * PRICE_BAND)) {
      return false;
    }
    return true;
  });
  const local = usable.filter((it) => KNOWN_MARKETPLACES.has(it.marketplace));
  const pool = local.length ? local : usable;

  const byMp = new Map<string, { min: ShoppingOffer; max: ShoppingOffer }>();
  for (const it of pool) {
    const cur = byMp.get(it.marketplace);
    if (!cur) {
      byMp.set(it.marketplace, { min: it, max: it });
      continue;
    }
    if (it.price < cur.min.price) cur.min = it;
    if (it.price > cur.max.price) cur.max = it;
  }
  return [...byMp.values()]
    .map((v) => ({
      marketplace: v.min.marketplace,
      price: v.min.price,
      maxPrice: Math.max(v.min.price, v.max.price),
      title: v.min.title,
      link: v.min.link,
      maxTitle: v.max.title,
      maxLink: v.max.link,
    }))
    .sort((a, b) => a.price - b.price)
    .slice(0, MAX_MARKETPLACES);
}

/** Potongan kuota harian SerpAPI (dipakai sebelum tiap pencarian). */
async function takeBudget(): Promise<boolean> {
  const key = "insight:serpapi_day";
  const today = wibDate();
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const [day, raw] = String(row?.value ?? "").split(":");
  const count = day === today ? Number(raw) || 0 : 0;
  if (count >= dailyLimit()) return false;
  const value = `${today}:${count + 1}`;
  await prisma.appSetting
    .upsert({ where: { key }, create: { key, value }, update: { value } })
    .catch(() => null);
  return true;
}

/** Ambil harga satu produk dari Google Shopping (lintas marketplace). */
async function fetchShopping(productName: string): Promise<ShoppingOffer[]> {
  const key = process.env.SERPAPI_KEY ?? "";
  if (!key) return [];
  const params = new URLSearchParams({
    engine: "google_shopping",
    q: productName,
    gl: "id",
    hl: "id",
    api_key: key,
  });
  const res = await fetch(`${SERPAPI_URL}?${params.toString()}`, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`serpapi ${res.status}`);
  return parseShoppingResults(await res.json());
}

/** Simpan rentang harga min–max tiap marketplace untuk produk teratas tenant. */
export async function refreshMarketplacePrices(
  tenantId: string,
  limit = 5
): Promise<{ stored: number; calls: number }> {
  if (!marketplaceReady()) return { stored: 0, calls: 0 };
  const products = await topTenantProducts(tenantId, limit);
  if (!products.length) return { stored: 0, calls: 0 };
  let stored = 0;
  let calls = 0;
  for (const p of products) {
    if (!(await takeBudget())) {
      console.warn("[insight] kuota price API harian habis — pembaruan harga marketplace ditunda");
      break;
    }
    calls += 1;
    let offers: ShoppingOffer[] = [];
    try {
      offers = await fetchShopping(p.name);
    } catch (e) {
      console.warn("[insight] marketplace gagal:", e instanceof Error ? e.message.slice(0, 120) : e);
      continue;
    }
    const items = aggregateOffers(offers, p.name, p.price && p.price > 0 ? p.price : null);
    // satu baris untuk harga min, satu untuk harga max (bila penawarannya berbeda)
    const rows = items.flatMap((it) => {
      const min = { marketplace: it.marketplace, price: it.price, title: it.title, link: it.link };
      if (it.maxPrice <= it.price || it.maxLink === it.link) return [min];
      return [
        min,
        { marketplace: it.marketplace, price: it.maxPrice, title: it.maxTitle, link: it.maxLink },
      ];
    });
    for (const it of rows) {
      await prisma.marketplacePrice
        .upsert({
          where: {
            tenantId_productName_marketplace_link: {
              tenantId,
              productName: p.name,
              marketplace: it.marketplace,
              link: it.link.slice(0, 500),
            },
          },
          create: {
            tenantId,
            productName: p.name,
            marketplace: it.marketplace,
            price: it.price,
            title: it.title,
            link: it.link.slice(0, 500),
          },
          update: { price: it.price, title: it.title, fetchedAt: new Date() },
        })
        .then(() => {
          stored += 1;
        })
        .catch(() => null);
    }
  }
  await prisma.marketplacePrice
    .deleteMany({ where: { tenantId, fetchedAt: { lt: new Date(Date.now() - MAX_AGE_MS) } } })
    .catch(() => null);
  return { stored, calls };
}

/** Sekali per hari (WIB) — hemat kuota price API. */
export async function ensureMarketplacePrices(tenantId: string): Promise<void> {
  if (!marketplaceReady()) return;
  const key = `insight:marketplace_last:${tenantId}`;
  const today = wibDate();
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (row?.value === today) return;
  const r = await refreshMarketplacePrices(tenantId).catch(() => ({ stored: 0, calls: 0 }));
  // kuota habis sebelum sempat mencari → jangan ditandai, biar bisa dicoba lagi hari ini
  if (r.calls === 0) return;
  await prisma.appSetting
    .upsert({ where: { key }, create: { key, value: today }, update: { value: today } })
    .catch(() => null);
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Perbandingan harga (rentang min–max) per produk teratas. */
export async function marketplaceComparison(tenantId: string): Promise<MarketplaceComparison[]> {
  const [products, rows] = await Promise.all([
    topTenantProducts(tenantId, 6),
    prisma.marketplacePrice.findMany({
      where: { tenantId, fetchedAt: { gte: new Date(Date.now() - MAX_AGE_MS) } },
      orderBy: { fetchedAt: "desc" },
      take: 300,
    }),
  ]);
  const byProduct = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.productName.toLowerCase();
    const list = byProduct.get(key) ?? [];
    list.push(r);
    byProduct.set(key, list);
  }
  const out: MarketplaceComparison[] = [];
  for (const p of products) {
    const sig = byProduct.get(p.name.toLowerCase()) ?? [];
    // hanya baris dari refresh terakhir (satu refresh = satu hari)
    const latest = sig.length ? sig[0]!.fetchedAt : null;
    const batch = latest ? sig.filter((r) => dayKey(r.fetchedAt) === dayKey(latest)) : [];
    const byMp = new Map<string, { min: number; max: number; row: (typeof rows)[number] }>();
    for (const r of batch) {
      const cur = byMp.get(r.marketplace);
      if (!cur) byMp.set(r.marketplace, { min: r.price, max: r.price, row: r });
      else if (r.price < cur.min) {
        cur.min = r.price;
        cur.row = r;
      } else if (r.price > cur.max) cur.max = r.price;
    }
    const items = [...byMp.values()]
      .map((v) => ({
        marketplace: v.row.marketplace,
        price: v.min,
        maxPrice: v.max,
        title: v.row.title,
        link: v.row.link,
      }))
      .sort((a, b) => a.price - b.price)
      .slice(0, MAX_MARKETPLACES);
    const own = p.price && p.price > 0 ? p.price : null;
    const cheapest = items[0] ?? null;
    out.push({
      productName: p.name,
      ownPrice: own,
      items,
      cheapestMarketplace: cheapest?.marketplace ?? null,
      cheapestPrice: cheapest?.price ?? null,
      deltaPct:
        own && cheapest ? Math.round(((own - cheapest.price) / cheapest.price) * 100) : null,
      fetchedAt: latest ? latest.toISOString() : null,
    });
  }
  return out;
}
