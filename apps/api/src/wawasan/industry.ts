import { prisma } from "../db.js";
import { accurateCtxFor } from "../providers/accounting/connection.js";
import { accurateProvider } from "../providers/accounting/index.js";
import { matchIndustries, type IndustryInput, type IndustryMatch } from "./industries.js";

/**
 * Deteksi bidang usaha dari data Accurate (deterministik, tanpa AI):
 * kategori barang + nama barang + omzet produk terlaris.
 * Hasil disimpan 7 hari agar halaman tetap cepat & hemat kuota Accurate.
 */

const CACHE_MS = 7 * 86400_000;
const TOPSELLING_TIMEOUT_MS = 8_000;

interface CatalogRow extends Record<string, unknown> {
  name?: unknown;
  quantity?: unknown;
  itemCategory?: unknown;
}

const categoryName = (v: unknown): string => {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v) return String((v as Record<string, unknown>).name ?? "");
  return "";
};

function cachedMatches(rows: Array<{ industry: string; weight: number; evidence: unknown }>): IndustryMatch[] {
  return rows.map((r) => {
    const ev = (r.evidence ?? {}) as { label?: string; matched?: string[] };
    return {
      key: r.industry,
      label: ev.label ?? r.industry,
      weight: r.weight,
      matched: Array.isArray(ev.matched) ? ev.matched : [],
    };
  });
}

export async function detectTenantIndustries(
  tenantId: string,
  opts?: { force?: boolean }
): Promise<IndustryMatch[]> {
  const rows = await prisma.tenantIndustry.findMany({ where: { tenantId } });
  const newest = rows.reduce((a, r) => Math.max(a, r.updatedAt.getTime()), 0);
  // cache lama tanpa daftar harga produk → deteksi ulang (untuk fitur harga pesaing)
  const hasProducts = rows.some((r) => {
    const ev = (r.evidence ?? {}) as { topProducts?: unknown };
    return Array.isArray(ev.topProducts) && ev.topProducts.length > 0;
  });
  if (!opts?.force && rows.length && hasProducts && Date.now() - newest < CACHE_MS) return cachedMatches(rows);

  const ctx = await accurateCtxFor(tenantId);
  if (!ctx) return rows.length ? cachedMatches(rows) : [];

  const provider = accurateProvider();
  try {
    // katalog: kategori + jumlah item (maks 300 item)
    const catalog: CatalogRow[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = (await provider.execute(
        "item.list",
        { pageSize: 100, page, fields: "id,no,name,quantity,itemCategory,unit" },
        ctx
      )) as { items?: CatalogRow[]; pageCount?: number };
      const items = Array.isArray(res?.items) ? res.items : [];
      catalog.push(...items);
      if (items.length < 100 || page >= Number(res?.pageCount ?? 1)) break;
    }

    // omzet produk terlaris (batas waktu singkat; bila lambat → pakai katalog saja)
    let top: Array<{ name: string; amount: number; qty: number; price: number }> = [];
    try {
      const ts = (await Promise.race([
        provider.execute(
          "item.topSelling",
          { fromDate: "01/01/1950", toDate: "31/12/2100", limit: 30 },
          ctx
        ) as Promise<{ items?: Array<Record<string, unknown>> }>,
        new Promise<null>((resolve) => {
          const t = setTimeout(() => resolve(null), TOPSELLING_TIMEOUT_MS);
          t.unref?.();
        }),
      ])) as { items?: Array<Record<string, unknown>> } | null;
      top = (ts?.items ?? [])
        .map((r) => ({
          name: String(r.itemName ?? r.name ?? "").trim(),
          amount: Number(r.amount ?? 0) || 0,
          qty: Number(r.quantity ?? 0) || 0,
          price: Number(r.avgUnitPrice ?? 0) || 0,
        }))
        .filter((r) => r.name);
    } catch {
      /* pakai katalog saja */
    }

    // harga jual TERKINI dari Accurate (bukan rata-rata historis) untuk perbandingan harga pasar
    const topPriced = await Promise.all(
      top.slice(0, 8).map(async (t) => {
        try {
          const r = (await provider.execute("item.byName", { name: t.name }, ctx)) as { sellingPrice?: unknown };
          const sp = Number(r?.sellingPrice);
          return Number.isFinite(sp) && sp > 0 ? { ...t, price: sp } : t;
        } catch {
          return t;
        }
      })
    );
    top = topPriced;

    const inputs: IndustryInput[] = [];
    const seen = new Set<string>();
    for (const t of top) {
      inputs.push({ name: t.name, revenue: t.amount, qty: t.qty });
      seen.add(t.name.toLowerCase());
    }
    for (const r of catalog) {
      const name = String(r.name ?? "").trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      inputs.push({ name, category: categoryName(r.itemCategory), qty: Number(r.quantity ?? 0) || 0 });
    }
    if (!inputs.length) return rows.length ? cachedMatches(rows) : [];

    const matches = matchIndustries(inputs);
    const topItems = top.slice(0, 8).map((t) => t.name);
    const topProducts = top.slice(0, 8).map((t) => ({ name: t.name, price: t.price, revenue: t.amount }));

    await prisma.$transaction(async (tx) => {
      for (const m of matches) {
        await tx.tenantIndustry.upsert({
          where: { tenantId_industry: { tenantId, industry: m.key } },
          create: {
            tenantId,
            industry: m.key,
            weight: m.weight,
            evidence: { label: m.label, matched: m.matched, topItems, topProducts },
          },
          update: { weight: m.weight, evidence: { label: m.label, matched: m.matched, topItems, topProducts } },
        });
      }
      await tx.tenantIndustry.deleteMany({
        where: { tenantId, industry: { notIn: matches.map((m) => m.key) } },
      });
    });
    console.info(`[insight] industri ${tenantId.slice(0, 8)}: ${matches.map((m) => `${m.key}=${m.weight}`).join(", ")}`);
    return matches;
  } catch (e) {
    console.warn("[insight] deteksi industri gagal:", e instanceof Error ? e.message.slice(0, 160) : e);
    return rows.length ? cachedMatches(rows) : [];
  }
}

/** kata kunci tambahan khas tenant (dari produk terlaris) untuk skor berita */
export async function tenantProductKeywords(tenantId: string): Promise<string[]> {
  const rows = await prisma.tenantIndustry.findMany({ where: { tenantId }, select: { evidence: true } });
  const out = new Set<string>();
  for (const r of rows) {
    const ev = (r.evidence ?? {}) as { topItems?: string[] };
    for (const name of ev.topItems ?? []) {
      for (const word of String(name).toLowerCase().split(/[^a-z0-9]+/)) {
        if (word.length >= 4) out.add(word);
      }
    }
  }
  return [...out].slice(0, 40);
}
