import { prisma } from "../db.js";
import { getModuleModel } from "../ai/module-model.js";
import { llmClient } from "../ai/llm-client.js";
import { recordLlmUsage } from "../ai/usage.js";
import { detectTenantIndustries } from "./industry.js";

/**
 * Search bar = TANYA AI (bukan mesin pencari).
 * Jawaban HANYA dari berita tersimpan (30 hari) yang relevan dengan bidang usaha.
 * Wajib menyebut sumber; bila konteks tidak memuat jawaban → menolak dengan jujur.
 */

export const ASK_DAILY_LIMIT = 20;

export interface AskSource {
  title: string;
  url: string;
  sourceName: string;
  publishedAt: string | null;
}

export interface AskResult {
  answer: string;
  sources: AskSource[];
  remaining: number;
}

const STOPWORDS = new Set([
  "yang", "untuk", "dengan", "bagaimana", "apa", "apakah", "kapan", "dimana", "dari", "dan", "atau",
  "ini", "itu", "saya", "kami", "kita", "bisa", "boleh", "berapa", "adalah", "akan", "sedang", "soal",
  "tentang", "terbaru", "sekarang", "hari", "besok", "kemarin", "bisnis", "usaha",
]);

function wibDayStart(now = new Date()): Date {
  const wib = new Date(now.getTime() + 7 * 3_600_000);
  return new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()) - 7 * 3_600_000);
}

function questionTokens(q: string): string[] {
  return [
    ...new Set(
      q
        .toLowerCase()
        .replace(/[^\p{L}\p{N} ]+/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    ),
  ];
}

const REFUSAL = "Belum ada informasi terkini soal itu.";

/** jawaban tampil sebagai teks biasa — buang penanda markdown & daftar sumber duplikat */
export function cleanAnswer(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[\*•]\s+/gm, "- ")
    // daftar sumber sudah dirender terpisah di bawah jawaban
    .replace(/^[ \t]*sumber\s*:.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function askInsight(tenantId: string, userId: string, question: string): Promise<AskResult> {
  const q = question.trim().slice(0, 300);
  const sinceDay = wibDayStart();
  const used = await prisma.newsAskLog.count({ where: { tenantId, createdAt: { gte: sinceDay } } });
  if (used >= ASK_DAILY_LIMIT) {
    throw Object.assign(new Error("batas_pertanyaan_harian"), { code: "ask_limit" });
  }
  const remainingAfter = Math.max(0, ASK_DAILY_LIMIT - used - 1);

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
    take: 200,
  });

  const toks = questionTokens(q);
  const scored = rows
    .map((r) => {
      const title = r.title.toLowerCase();
      const body = `${r.title} ${r.snippet}`.toLowerCase();
      let kw = 0;
      for (const t of toks) {
        if (title.includes(t)) kw += 3;
        else if (body.includes(t)) kw += 1;
      }
      const at = r.publishedAt ?? r.fetchedAt;
      const recency = Math.max(0, 2 - (Date.now() - at.getTime()) / (7 * 86400_000));
      return { r, kw, score: kw + recency };
    })
    // wajib ada kecocokan kata kunci — kebaruan saja tidak cukup (anti jawaban ngawur)
    .filter((x) => x.kw > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  if (!scored.length || !toks.length) {
    return { answer: REFUSAL, sources: [], remaining: ASK_DAILY_LIMIT - used };
  }

  const context = scored
    .map(({ r }, i) => {
      const date = (r.publishedAt ?? r.fetchedAt).toISOString().slice(0, 10);
      return `[${i + 1}] ${r.title}\nSumber: ${r.sourceName} (${date})\nRingkasan: ${r.snippet}\nURL: ${r.url}`;
    })
    .join("\n\n");

  const system =
    "Anda asisten informasi pasar untuk pemilik usaha di Indonesia.\n" +
    "Jawab HANYA berdasarkan KONTEKS berita di bawah. JANGAN menambah fakta, angka, atau tautan dari luar konteks.\n" +
    `Jika konteks tidak memuat jawabannya, jawab persis: "${REFUSAL}"\n` +
    "Gaya: Bahasa Indonesia, ringkas (maksimal 120 kata), 2-4 poin bila perlu.\n" +
    "JANGAN memakai markdown (** atau ##). Untuk poin gunakan tanda '-'.\n" +
    "Sebutkan sumber dengan penanda [1], [2] sesuai nomor konteks. Jangan mengarang tautan.\n" +
    "JANGAN menulis daftar sumber di akhir jawaban (sudah ditampilkan terpisah oleh aplikasi).";

  const prompt = `KONTEKS:\n${context}\n\nPERTANYAAN: ${q}`;
  const model = (await getModuleModel("chat")) || undefined;

  let answer = "";
  try {
    const { parts } = await llmClient().generate({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      system,
      model,
    });
    answer = parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text!.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  } catch (e) {
    throw Object.assign(e instanceof Error ? e : new Error("llm_gagal"), { code: "ask_llm" });
  }
  answer = cleanAnswer(answer || REFUSAL);

  void recordLlmUsage({
    tenantId,
    userId,
    kind: "chat",
    model: model ?? "default",
    promptChars: system.length + prompt.length,
    completionChars: answer.length,
  });
  await prisma.newsAskLog.create({ data: { tenantId, userId, question: q } }).catch(() => null);

  // sumber yang benar-benar dirujuk (fallback: 3 teratas)
  const cited = [...answer.matchAll(/\[(\d+)\]/g)]
    .map((m) => Number(m[1]) - 1)
    .filter((i) => i >= 0 && i < scored.length);
  const picked = cited.length ? [...new Set(cited)] : scored.slice(0, 3).map((_, i) => i);
  const sources: AskSource[] = picked.map((i) => {
    const r = scored[i]!.r;
    return {
      title: r.title,
      url: r.url,
      sourceName: r.sourceName,
      publishedAt: (r.publishedAt ?? r.fetchedAt).toISOString(),
    };
  });

  return { answer, sources, remaining: remainingAfter };
}
