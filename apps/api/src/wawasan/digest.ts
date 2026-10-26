import { prisma } from "../db.js";
import { detectTenantIndustries, tenantProductKeywords } from "./industry.js";
import { INDUSTRIES } from "./industries.js";
import { rankNews, type NewsLike } from "./rank.js";
import { ensurePriceSignals, priceComparison, type PriceComparison } from "./market-price.js";
import {
  ensureMarketplacePrices,
  marketplaceComparison,
  marketplaceReady,
  type MarketplaceComparison,
} from "./marketplace.js";

import { wibDate } from "./time.js";
export { wibDate } from "./time.js";

export const DAILY_REFRESH_MINUTES = 4 * 60 + 30; // 04:30 WIB

export interface DigestIndustry {
  key: string;
  label: string;
  weight: number;
}

export interface DigestItem {
  id: string;
  title: string;
  url: string;
  snippet: string;
  sourceName: string;
  sourceDomain: string;
  publishedAt: string | null;
  topic: string;
  why: string;
  matched: string[];
}

export interface DigestPayload {
  date: string;
  generatedAt: string;
  industries: DigestIndustry[];
  /** harga pasar/pesaing produk tenant vs harga jual sendiri */
  prices: PriceComparison[];
  /** perbandingan harga antar marketplace (bila price API aktif) */
  marketplaceReady: boolean;
  marketplaces: MarketplaceComparison[];
  items: DigestItem[];
}

const GENERIC_KEYWORDS = [
  "pajak",
  "ppn",
  "inflasi",
  "suku bunga",
  "rupiah",
  "kurs",
  "upah minimum",
  "harga bahan bakar",
  "bbm",
  "listrik",
];

function newsKeywordsFor(keys: string[]): string[] {
  const out = new Set<string>(GENERIC_KEYWORDS);
  for (const key of keys) {
    const def = INDUSTRIES.find((i) => i.key === key);
    for (const kw of def?.newsKeywords ?? []) out.add(kw);
  }
  return [...out];
}

/** Bangun digest harian untuk satu perusahaan (deterministik, tanpa AI). */
export async function buildDigest(tenantId: string, date = wibDate()): Promise<DigestPayload> {
  const industries = await detectTenantIndustries(tenantId).catch(() => []);
  const keys = industries.map((i) => i.key);
  const since = new Date(Date.now() - 30 * 86400_000);
  const industryFilters = keys.length
    ? [...keys.map((k) => ({ industries: { contains: k } })), { industries: { contains: "umum" } }]
    : [{ industries: { contains: "umum" } }];

  const rows = await prisma.newsItem.findMany({
    where: {
      OR: [{ publishedAt: { gte: since } }, { publishedAt: null, fetchedAt: { gte: since } }],
      AND: [{ OR: industryFilters }],
    },
    orderBy: [{ publishedAt: "desc" }, { fetchedAt: "desc" }],
    take: 300,
  });

  const productKeywords = await tenantProductKeywords(tenantId).catch(() => []);
  const ctx = { industryKeys: keys, newsKeywords: newsKeywordsFor(keys), productKeywords };
  const likes: NewsLike[] = rows.map((r) => ({
    id: r.id,
    url: r.url,
    title: r.title,
    snippet: r.snippet,
    sourceName: r.sourceName,
    sourceDomain: r.sourceDomain,
    publishedAt: r.publishedAt ?? r.fetchedAt,
    topic: r.topic,
    industries: r.industries,
  }));
  const isSpecific = (r: NewsLike) => r.industries.split(",").some((k) => keys.includes(k.trim()));
  // ranking terpisah: berita khusus bidang didahulukan, umum/makro porsi kecil
  const specific = rankNews(likes.filter(isSpecific), ctx, 12, 6).slice(0, 9);
  const generic = rankNews(likes.filter((r) => !isSpecific(r)), ctx, 6, 3).slice(0, 3);
  const ranked = [...specific, ...generic];

  await ensurePriceSignals(tenantId).catch(() => null);
  const prices = await priceComparison(tenantId).catch(() => []);
  const mpReady = marketplaceReady();
  if (mpReady) await ensureMarketplacePrices(tenantId).catch(() => null);
  const marketplaces = mpReady ? await marketplaceComparison(tenantId).catch(() => []) : [];

  const payload: DigestPayload = {
    date,
    generatedAt: new Date().toISOString(),
    industries: industries.map((i) => ({ key: i.key, label: i.label, weight: i.weight })),
    prices,
    marketplaceReady: mpReady,
    marketplaces,
    items: ranked.map((r) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      // snippet yang hanya mengulang judul tidak ditampilkan (biar kartu rapi)
      snippet: r.snippet && r.snippet.toLowerCase().startsWith(r.title.toLowerCase()) ? "" : r.snippet,
      sourceName: r.sourceName,
      sourceDomain: r.sourceDomain,
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
      topic: r.topic,
      why: r.why,
      matched: r.matched,
    })),
  };

  await prisma.newsDigest.upsert({
    where: { tenantId_date: { tenantId, date } },
    create: { tenantId, date, payload: payload as unknown as object },
    update: { payload: payload as unknown as object, generatedAt: new Date() },
  });
  return payload;
}

/** Digest hari ini (dibangun sekali per hari; halaman hanya membaca). */
export async function getInsightForTenant(tenantId: string): Promise<DigestPayload> {
  const date = wibDate();
  const row = await prisma.newsDigest.findUnique({ where: { tenantId_date: { tenantId, date } } });
  if (row) return row.payload as unknown as DigestPayload;
  return buildDigest(tenantId, date);
}

/** Job harian 04:30 WIB: siapkan digest untuk perusahaan yang terhubung Accurate. */
export async function runDailyDigests(limit = 100): Promise<{ built: number; failed: number }> {
  const conns = await prisma.connection.findMany({
    where: { provider: "accurate", status: "connected" },
    select: { tenantId: true },
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
  let built = 0;
  let failed = 0;
  for (const c of conns) {
    try {
      await buildDigest(c.tenantId);
      built += 1;
    } catch {
      failed += 1;
    }
  }
  console.info(`[insight] digest harian: ${built} dibangun, ${failed} gagal`);
  return { built, failed };
}
