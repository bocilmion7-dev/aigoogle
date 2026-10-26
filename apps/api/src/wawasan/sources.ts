import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { OFFICIAL_DOMAINS, WHITELIST_DOMAINS } from "./industries.js";

/** URL pencarian Google News RSS (bahasa & wilayah Indonesia). */
export function googleNewsUrl(query: string, days = 7): string {
  // when:Nd → batasi umur berita (RSS tanpa filter mengembalikan artikel lama)
  const raw = /when:\d+d/i.test(query) ? query.trim() : `${query.trim()} when:${days}d`;
  const q = encodeURIComponent(raw);
  return `https://news.google.com/rss/search?q=${q}&hl=id&gl=ID&ceid=ID:id`;
}

/** Ambil XML RSS dengan batas waktu (dipakai ingest & pemantau harga). */
export async function fetchRssXml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AIAsisten/1.0; +https://ai-asisten.my.id)",
        Accept: "application/rss+xml, application/xml, text/xml",
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export interface RawNews {
  title: string;
  url: string;
  snippet: string;
  sourceName: string;
  sourceDomain: string;
  publishedAt: Date | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
});

const asText = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "#text" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>)["#text"] ?? "");
  }
  return "";
};

const decodeEntities = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

/** buang akhiran "- NamaMedia" dari judul Google News */
export function stripSourceSuffix(title: string, sourceName: string): string {
  const t = title.trim();
  if (!sourceName) return t;
  const suffix = ` - ${sourceName}`.toLowerCase();
  if (t.toLowerCase().endsWith(suffix)) return t.slice(0, t.length - suffix.length).trim();
  return t;
}

/** ringkasan bersih; buang bila hanya mengulang judul persis */
export function cleanSnippet(html: string, title = ""): string {
  const text = decodeEntities(html).slice(0, 260);
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  if (title && norm(text) === norm(title)) return "";
  return text;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Domain harus termasuk whitelist (sumber resmi / media bisnis kredibel). */
export function isAllowedDomain(domain: string): boolean {
  if (!domain) return false;
  return WHITELIST_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function isOfficialDomain(domain: string): boolean {
  return OFFICIAL_DOMAINS.has(domain) || [...OFFICIAL_DOMAINS].some((d) => domain.endsWith(`.${d}`));
}

/** hash judul ternormalisasi — dedupe berita kembar antar media */
export function titleHash(title: string): string {
  const norm = title
    .toLowerCase()
    .replace(/\s+-\s+[^-]{2,40}$/i, "") // buang akhiran "- NamaMedia"
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha1").update(norm).digest("hex");
}

/** Parse RSS Google News → daftar berita yang lolos whitelist domain. */
export function parseGoogleNews(xml: string): RawNews[] {
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }
  const root = doc as { rss?: { channel?: { item?: unknown } } };
  const raw = root?.rss?.channel?.item;
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: RawNews[] = [];
  for (const it of arr) {
    const row = (it ?? {}) as Record<string, unknown>;
    const title = decodeEntities(asText(row.title));
    const url = asText(row.link);
    if (!title || !url) continue;
    const src = row.source as Record<string, unknown> | string | undefined;
    const sourceName = typeof src === "string" ? decodeEntities(src) : decodeEntities(asText(src));
    const sourceUrl = typeof src === "object" && src ? String((src as Record<string, unknown>)["@_url"] ?? "") : "";
    const sourceDomain = hostOf(sourceUrl) || hostOf(url);
    if (!isAllowedDomain(sourceDomain)) continue;
    const pub = asText(row.pubDate);
    const dt = pub ? new Date(pub) : null;
    const finalSource = sourceName || sourceDomain;
    const finalTitle = stripSourceSuffix(title, finalSource);
    out.push({
      title: finalTitle,
      url,
      snippet: cleanSnippet(asText(row.description), finalTitle),
      sourceName: finalSource,
      sourceDomain,
      publishedAt: dt && !Number.isNaN(dt.getTime()) ? dt : null,
    });
  }
  return out;
}
