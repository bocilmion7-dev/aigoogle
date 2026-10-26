import type { Topic } from "./industries.js";

/**
 * Skor relevansi berita untuk satu perusahaan (deterministik).
 * Faktor: kata kunci produk/kategori, topik khas industri, kebaruan, kredibilitas sumber.
 */

export interface NewsLike {
  id: string;
  url: string;
  title: string;
  snippet: string;
  sourceName: string;
  sourceDomain: string;
  publishedAt: Date | null;
  topic: string;
  industries: string;
}

export interface RankContext {
  industryKeys: string[];
  newsKeywords: string[];
  productKeywords: string[];
  now?: number;
}

export interface RankedNews extends NewsLike {
  score: number;
  matched: string[];
  why: string;
}

const TOPIC_HINT: Record<string, string> = {
  regulasi: "Cek dampaknya ke kewajiban administrasi, pajak, dan harga jual.",
  harga: "Pantau dampaknya ke harga pokok dan margin usaha Anda.",
  tren: "Pertimbangkan penyesuaian stok, layanan, atau promo.",
  event: "Siapkan stok dan promosi lebih awal untuk periode ini.",
  makro: "Perhatikan efeknya ke biaya operasional dan daya beli pelanggan.",
  industri: "Pantau langkah pesaing dan peluang pasar yang muncul.",
  umum: "Informasi ini bisa memengaruhi keputusan usaha Anda.",
};

const TOPIC_WEIGHT: Record<string, number> = {
  regulasi: 1.2,
  harga: 1.25,
  tren: 1.0,
  event: 0.95,
  makro: 0.8,
  industri: 0.9,
  umum: 0.5,
};

const normalTitle = (t: string) =>
  t
    .toLowerCase()
    .replace(/\s+-\s+[^-]{2,40}$/i, "")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s: string): Set<string> => new Set(normalTitle(s).split(" ").filter((w) => w.length > 2));

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function hits(text: string, keyword: string): boolean {
  const k = keyword.toLowerCase().trim();
  if (!k) return false;
  if (k.length <= 3) return new RegExp(`(^|[^a-z0-9])${k}([^a-z0-9]|$)`).test(text);
  return text.includes(k);
}

export function scoreNews(item: NewsLike, ctx: RankContext): { score: number; matched: string[] } {
  const now = ctx.now ?? Date.now();
  const title = item.title.toLowerCase();
  const body = `${item.title} ${item.snippet}`.toLowerCase();
  const matched = new Set<string>();

  let score = 0;
  for (const kw of ctx.productKeywords) {
    if (hits(title, kw)) {
      score += 4;
      matched.add(kw);
    } else if (hits(body, kw)) {
      score += 1.5;
      matched.add(kw);
    }
  }
  for (const kw of ctx.newsKeywords) {
    if (hits(title, kw)) {
      score += 2;
      matched.add(kw);
    } else if (hits(body, kw)) {
      score += 0.75;
      matched.add(kw);
    }
  }

  const inds = item.industries.split(",").map((s) => s.trim()).filter(Boolean);
  // berita khusus bidang usaha lebih penting daripada berita umum
  if (inds.some((k) => ctx.industryKeys.includes(k))) score += 3;
  else if (inds.includes("umum")) score += 1;

  score += TOPIC_WEIGHT[item.topic] ?? 0.5;

  if (item.publishedAt) {
    const hours = Math.max(0, (now - item.publishedAt.getTime()) / 3_600_000);
    score += Math.max(0, 3 - hours / 24);
  }
  if (/\.go\.id$/.test(item.sourceDomain)) score += 1.5;

  return { score: Math.round(score * 100) / 100, matched: [...matched].slice(0, 5) };
}

export function whyFor(topic: string): string {
  return TOPIC_HINT[topic] ?? TOPIC_HINT.umum!;
}

/** Urutkan + buang berita kembar (judul sangat mirip), ambil N teratas. */
export function rankNews(items: NewsLike[], ctx: RankContext, limit = 12, maxPerTopic = 3): RankedNews[] {
  const scored = items
    .map((it) => {
      const { score, matched } = scoreNews(it, ctx);
      return { ...it, score, matched, why: whyFor(it.topic) };
    })
    .sort((a, b) => b.score - a.score);

  const out: RankedNews[] = [];
  const seen: Array<Set<string>> = [];
  const perTopic = new Map<string, number>();
  for (const it of scored) {
    const t = tokens(it.title);
    if (seen.some((s) => jaccard(s, t) >= 0.7)) continue;
    const n = perTopic.get(it.topic) ?? 0;
    if (n >= maxPerTopic) continue; // variasikan topik, jangan didominasi satu isu
    seen.push(t);
    perTopic.set(it.topic, n + 1);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}
