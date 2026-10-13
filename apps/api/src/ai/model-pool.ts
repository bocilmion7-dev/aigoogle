import { prisma } from "../db.js";
import { env } from "../env.js";
import { GeminiHttpError } from "./gemini-error.js";
import { RealNvidiaClient } from "./nvidia.js";

/**
 * Pool model Gemini dengan failover.
 *
 * - Saat dipakai pertama kali (atau setelah "gagal semua"), daftar model dimuat
 *   LIVE dari API Gemini dan disimpan di tabel GeminiModel per ember (generate|tts|stt).
 * - Setiap pemanggilan mencoba model berurutan sesuai rank; gagal → rotasi ke
 *   model berikutnya. Kegagalan sementara (429/5xx/404/network) menaikkan
 *   failureCount model di tabel (demoted setelah MAX_FAILURES).
 * - Bila SEMUA model pada ember gagal → refresh daftar live (ganti isi tabel,
 *   reset hitungan) → coba satu siklus lagi; tetap gagal → lempar error terakhir.
 */
export type ModelAction = "generate" | "tts" | "stt";
export type ModelProvider = "gemini" | "nvidia";

/** Kandidat model: provider + nama model (NVIDIA hanya utk ember generate). */
export interface ModelCandidate {
  provider: ModelProvider;
  model: string;
}

const API = "https://generativelanguage.googleapis.com/v1beta";
/** NVIDIA NIM di-seed SETELAH Gemini (rank lebih besar) → Gemini tetap utama. */

/** Gagal beruntun sebelum model dianggap "mati" sampai refresh. */
export const MAX_FAILURES = 3;
/** Batas model yang dicoba per siklus agar latensi tetap terkendali. */
const MAX_TRY = 3;

function envModel(action: ModelAction): string {
  if (action === "tts") return env.GEMINI_TTS_MODEL;
  if (action === "stt") return env.GEMINI_TRANSCRIBE_MODEL;
  return env.GEMINI_MODEL;
}

function errStatus(e: unknown): number {
  if (e && typeof e === "object" && "status" in e && typeof (e as { status?: unknown }).status === "number") {
    return (e as { status: number }).status;
  }
  return 0;
}
const ABORT_STATUS = new Set([401, 403]);
const isTransient = (s: number) => s === 0 || s === 404 || s === 429 || s >= 500;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

let refreshP: Promise<number> | null = null;
let lastRefreshAt = 0;
/** Saat semua model gagal (mis. kuota habis), jangan muat ulang daftar live lebih
 * sering dari ini — reset hitungan tetap terjadi tiap cooldown, latensi terjaga. */
const REFRESH_COOLDOWN_MS = 10_000;

/** Muat SEMUA model live dari API Gemini → tulis ke tabel (mengganti isi lama). */
export async function refreshModelsLive(): Promise<number> {
  if (refreshP) return refreshP;
  if (Date.now() - lastRefreshAt < REFRESH_COOLDOWN_MS) return 0;
  refreshP = (async () => {
    const key = process.env.GEMINI_API_KEY || "";
    if (key.length < 10) return 0;
    const buckets: Record<ModelAction, string[]> = { generate: [], tts: [], stt: [] };
    let pageToken = "";
    for (;;) {
      const url = `${API}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
      const res = await fetch(url, { headers: { "x-goog-api-key": key } });
      if (!res.ok) throw new GeminiHttpError(res.status, await res.text().catch(() => ""));
      const j = (await res.json()) as {
        models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>;
        nextPageToken?: string;
      };
      for (const m of j.models ?? []) {
        const methods = m.supportedGenerationMethods ?? [];
        if (!methods.includes("generateContent")) continue;
        const label = `${m.name} ${m.displayName ?? ""}`.toLowerCase();
        const action: ModelAction = label.includes("tts") ? "tts" : label.includes("transcribe") ? "stt" : "generate";
        const name = m.name.replace(/^models\//, "");
        if (!buckets[action].includes(name)) buckets[action].push(name);
      }
      pageToken = j.nextPageToken ?? "";
      if (!pageToken) break;
    }
    // model pilihan env selalu di urutan pertama tiap ember
    const rows: Array<{ id: string; action: string; provider: string; name: string; rank: number; failureCount?: number; lastError?: string }> = [];
    for (const action of ["generate", "tts", "stt"] as ModelAction[]) {
      const list = buckets[action];
      const pref = envModel(action);
      if (pref) {
        const i = list.indexOf(pref);
        if (i > 0) {
          list.splice(i, 1);
          list.unshift(pref);
        } else if (i < 0) {
          list.unshift(pref);
        }
      }
      list.forEach((name, rank) => rows.push({ id: `${action}:${name}`, action, provider: "gemini", name, rank }));
    }
    // provider kedua (NVIDIA NIM) — hanya utk ember generate, diurutkan setelah Gemini
    if (env.NVIDIA_API_KEY.length > 10) {
      try {
        const nv = new RealNvidiaClient(env.NVIDIA_API_KEY);
        const nvModels = await nv.listModels();
        // utamakan model NIM yg dikenal mampu function-calling
        const preferredNv = [
          "nvidia/nemotron-3.5-lightning-30b-a3b",
          "nvidia/nemotron-3-super-120b-a12b",
          "nvidia/nemotron-3-ultra-550b-a55b",
          "openai/gpt-oss-20b",
          "meta/llama-3.2-11b-vision-instruct",
        ];
        const ordered = [
          ...preferredNv.filter((m) => nvModels.includes(m)),
          ...nvModels.filter((m) => !preferredNv.includes(m)),
        ];
        const base = buckets.generate.length;
        ordered.forEach((name, i) =>
          rows.push({ id: `generate:nvidia:${name}`, action: "generate", provider: "nvidia", name, rank: base + i })
        );
      } catch {
        /* daftar NVIDIA tak terjangkau → lanjut tanpa provider ini */
      }
    }
    if (rows.length === 0) return 0;
    // model yang pernah 404 (tak tersedia utk key ini) tetap ditandai mati agar
    // tidak memakan slot kandidat lagi setelah refresh
    const gone = await prisma.geminiModel.findMany({
      where: { lastError: { startsWith: "404" } },
      select: { id: true, lastError: true },
    });
    const goneMap = new Map(gone.map((g) => [g.id, g.lastError]));
    for (const row of rows) {
      const lastError = goneMap.get(row.id);
      if (lastError !== undefined) {
        row.failureCount = MAX_FAILURES;
        row.lastError = lastError;
      }
    }
    await prisma.$transaction([prisma.geminiModel.deleteMany({}), prisma.geminiModel.createMany({ data: rows })]);
    return rows.length;
  })().finally(() => {
    refreshP = null;
    lastRefreshAt = Date.now();
  });
  return refreshP;
}

/** Hanya untuk test: longgarkan cooldown refresh agar skenario refresh bisa diuji. */
export function resetRefreshCooldown(): void {
  lastRefreshAt = 0;
}

async function ensureSeeded(): Promise<void> {
  const n = await prisma.geminiModel.count();
  if (n > 0) return;
  try {
    await refreshModelsLive();
  } catch {
    /* daftar live tak terjangkau → jalur fallback model env */
  }
}

async function candidates(action: ModelAction, preferred?: string): Promise<ModelCandidate[]> {
  const rows = await prisma.geminiModel.findMany({
    where: { action, failureCount: { lt: MAX_FAILURES } },
    orderBy: { rank: "asc" },
  });
  const all: ModelCandidate[] = rows.map((r) => ({
    provider: (r.provider as ModelProvider) || "gemini",
    model: r.name,
  }));
  if (preferred && !all.some((c) => c.model === preferred)) {
    const pref = await prisma.geminiModel.findUnique({ where: { id: `${action}:${preferred}` } });
    if (pref && pref.failureCount < MAX_FAILURES) all.unshift({ provider: "gemini", model: preferred });
  }
  // jamin tiap provider dapat slot dlm MAX_TRY: Gemini (rank terdepan) dulu,
  // lalu selipkan minimal satu kandidan NVIDIA bila ada — agar kredit Gemini habis → NVIDIA kejatuhan.
  const gemini = all.filter((c) => c.provider === "gemini");
  const nvidia = all.filter((c) => c.provider === "nvidia");
  const out: ModelCandidate[] = [];
  const gLimit = nvidia.length ? Math.max(1, MAX_TRY - 1) : MAX_TRY;
  out.push(...gemini.slice(0, gLimit));
  if (nvidia.length) out.push(nvidia[0]); // slot NVIDIA dijamin utk failover
  return out.slice(0, MAX_TRY);
}

function rowId(action: ModelAction, c: ModelCandidate): string {
  return c.provider === "nvidia" ? `${action}:nvidia:${c.model}` : `${action}:${c.model}`;
}

async function markOk(action: ModelAction, c: ModelCandidate): Promise<void> {
  await prisma.geminiModel.updateMany({
    where: { id: rowId(action, c) },
    data: { failureCount: 0, lastError: "", lastOkAt: new Date() },
  });
}

async function markFail(action: ModelAction, c: ModelCandidate, status: number, message: string): Promise<void> {
  // 404 = model tidak tersedia untuk key ini → langsung dianggap mati (bukan
  // kegagalan sementara), penanda "404:" dipakai lagi saat refresh
  const isGone = status === 404;
  await prisma.geminiModel.updateMany({
    where: { id: rowId(action, c) },
    data: isGone
      ? { failureCount: MAX_FAILURES, lastError: `404: ${message}`.slice(0, 500), lastFailAt: new Date() }
      : { failureCount: { increment: 1 }, lastError: message.slice(0, 500), lastFailAt: new Date() },
  });
}

type Cycle<T> = { ok: true; value: T } | { ok: false };

/** Coba model berurutan utk aksi; semua gagal → refresh live → satu siklus lagi. */
export async function withModelFailover<T>(
  action: ModelAction,
  run: (c: ModelCandidate) => Promise<T>,
  preferred?: string
): Promise<T> {
  await ensureSeeded();
  let lastErr: unknown = null;
  let sawTransient = false;

  const cycle = async (cands: ModelCandidate[]): Promise<Cycle<T>> => {
    for (const c of cands) {
      try {
        const value = await run(c);
        await markOk(action, c);
        return { ok: true, value };
      } catch (e) {
        const st = errStatus(e);
        if (ABORT_STATUS.has(st)) throw e;
        lastErr = e;
        if (isTransient(st)) {
          sawTransient = true;
          await markFail(action, c, st, errMsg(e));
        }
      }
    }
    return { ok: false };
  };

  let models = await candidates(action, preferred);
  if (models.length === 0) {
    try {
      await refreshModelsLive();
    } catch {
      /* biarkan → fallback di bawah */
    }
    models = await candidates(action, preferred);
  }
  let out = await cycle(models);
  if (out.ok) return out.value;

  // SEMUA model gagal → muat ulang daftar model live, reset hitungan, coba lagi
  if (sawTransient) {
    try {
      await refreshModelsLive();
    } catch {
      /* biarkan */
    }
    models = await candidates(action, preferred);
    out = await cycle(models);
    if (out.ok) return out.value;
  }

  if (!lastErr) {
    const fb = envModel(action);
    if (fb) {
      out = await cycle([{ provider: "gemini", model: fb }]);
      if (out.ok) return out.value;
    }
  }
  throw lastErr ?? new GeminiHttpError(503, "tidak ada model Gemini tersedia");
}
