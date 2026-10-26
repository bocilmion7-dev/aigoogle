import { prisma } from "../db.js";
import { GENERIC_QUERIES, INDUSTRIES } from "./industries.js";
import { fetchRssXml, googleNewsUrl, parseGoogleNews, titleHash } from "./sources.js";

/**
 * Ingest berita eksternal (Google News RSS per kata kunci industri).
 * - Sumber disimpan di tabel NewsSource (bisa dinonaktifkan admin).
 * - Hanya domain whitelist yang disimpan (berita aman/terjamin).
 * - Dedupe berdasarkan hash judul + URL.
 */

const MAX_SOURCES = 60;

async function seedSources(): Promise<void> {
  const rows: Array<{ industry: string; topic: string; query: string; weight: number }> = [];
  for (const ind of INDUSTRIES) {
    for (const q of ind.queries) rows.push({ industry: ind.key, topic: q.topic, query: q.q, weight: 1 });
  }
  for (const q of GENERIC_QUERIES) rows.push({ industry: "umum", topic: q.topic, query: q.q, weight: 0.9 });
  for (const r of rows) {
    await prisma.newsSource.upsert({
      where: { query: r.query },
      create: r,
      update: { industry: r.industry, topic: r.topic },
    });
  }
}

export interface IngestResult {
  sources: number;
  fetched: number;
  inserted: number;
  skipped: number;
  errors: number;
}

export async function runNewsIngest(opts?: { maxSources?: number }): Promise<IngestResult> {
  await seedSources();
  const sources = await prisma.newsSource.findMany({
    where: { isActive: true },
    orderBy: { updatedAt: "asc" },
    take: Math.min(MAX_SOURCES, opts?.maxSources ?? MAX_SOURCES),
  });
  const out: IngestResult = { sources: sources.length, fetched: 0, inserted: 0, skipped: 0, errors: 0 };
  for (const src of sources) {
    const xml = await fetchRssXml(googleNewsUrl(src.query));
    if (!xml) {
      out.errors += 1;
      continue;
    }
    const items = parseGoogleNews(xml);
    out.fetched += items.length;
    const candidates = [];
    for (const it of items.slice(0, 15)) {
      candidates.push({
        url: it.url,
        title: it.title.slice(0, 300),
        snippet: it.snippet,
        sourceName: it.sourceName.slice(0, 120),
        sourceDomain: it.sourceDomain,
        publishedAt: it.publishedAt,
        topic: src.topic,
        industries: src.industry,
        hash: titleHash(it.title),
      });
    }
    if (!candidates.length) continue;
    const res = await prisma.newsItem.createMany({ data: candidates, skipDuplicates: true }).catch(() => ({ count: 0 }));
    out.inserted += res.count;
    out.skipped += candidates.length - res.count;
    // sentuh sumber agar rotasi berikutnya adil (tidak selalu sumber yang sama)
    await prisma.newsSource.update({ where: { id: src.id }, data: { updatedAt: new Date() } }).catch(() => null);
  }
  // buang berita basi (di luar jendela relevansi) agar basis data ringkas & segar
  const cutoff = new Date(Date.now() - 45 * 86400_000);
  await prisma.newsItem
    .deleteMany({
      where: {
        OR: [{ publishedAt: { lt: cutoff } }, { publishedAt: null, fetchedAt: { lt: cutoff } }],
      },
    })
    .catch(() => null);
  console.info(
    `[insight] ingest: sumber ${out.sources} | berita ${out.fetched} | baru ${out.inserted} | duplikat ${out.skipped} | gagal ${out.errors}`
  );
  return out;
}
