import { prisma } from "../db.js";
import { LlmHttpError } from "./llm-error.js";
import { RealNvidiaClient, type NvidiaClient } from "./nvidia.js";

/**
 * Pool model AI berbasis DB (tabel AiProvider + AiProviderModel).
 *
 * - Tepat satu provider aktif (AiProvider.isActive) — diatur admin via radio di /ai.
 * - Konfigurasi 100% manual dari UI; TIDAK ada auto-seed dari env.
 * - Kandidat = model tercentang provider aktif (rank asc, failureCount < MAX_FAILURES).
 * - Kandidat membawa `client` siap pakai (RealNvidiaClient dari baseUrl+apiKey provider)
 *   sehingga pemanggil TIDAK perlu lagi ternary env.
 * - Gagal semua (ada transient) → reset failureCount provider aktif → 1 siklus lagi.
 * - 401/403 → abort; 404 → demote permanen; transient (0/429/5xx) → demote sementara.
 */
export type ModelAction = "generate";

export interface ModelCandidate {
  provider: { id: string; name: string; baseUrl: string; apiKey: string };
  model: string;
  client: NvidiaClient;
}

export const MAX_FAILURES = 3;
const MAX_TRY = 3;

function errStatus(e: unknown): number {
  if (e && typeof e === "object" && "status" in e && typeof (e as { status?: unknown }).status === "number") {
    return (e as { status: number }).status;
  }
  return 0;
}
const ABORT_STATUS = new Set([401, 403]);
const isTransient = (s: number) => s === 0 || s === 404 || s === 429 || s >= 500;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

function toCandidate(p: { id: string; name: string; baseUrl: string; apiKey: string }, model: string): ModelCandidate {
  return { provider: p, model, client: new RealNvidiaClient(p.apiKey, p.baseUrl) };
}

async function candidates(preferred?: string): Promise<ModelCandidate[]> {
  const active = await prisma.aiProvider.findFirst({
    where: { isActive: true },
    include: { models: { where: { failureCount: { lt: MAX_FAILURES } }, orderBy: { rank: "asc" } } },
  });
  if (!active) throw new LlmHttpError(503, "tidak ada provider AI aktif — atur di halaman AI");
  let list = active.models.map((m) => toCandidate(active, m.name));
  if (preferred && !list.some((c) => c.model === preferred)) {
    const pref = await prisma.aiProviderModel.findUnique({
      where: { providerId_name: { providerId: active.id, name: preferred } },
    });
    if (pref && pref.failureCount < MAX_FAILURES) {
      list = [toCandidate(active, pref.name), ...list];
    }
  }
  return list.slice(0, MAX_TRY);
}

type Cycle<T> = { ok: true; value: T } | { ok: false };

async function markOk(m: ModelCandidate): Promise<void> {
  await prisma.aiProviderModel.updateMany({
    where: { providerId: m.provider.id, name: m.model },
    data: { failureCount: 0, lastError: "", lastOkAt: new Date() },
  });
}

async function markFail(m: ModelCandidate, status: number, message: string): Promise<void> {
  const isGone = status === 404;
  await prisma.aiProviderModel.updateMany({
    where: { providerId: m.provider.id, name: m.model },
    data: isGone
      ? { failureCount: MAX_FAILURES, lastError: `404: ${message}`.slice(0, 500), lastFailAt: new Date() }
      : { failureCount: { increment: 1 }, lastError: message.slice(0, 500), lastFailAt: new Date() },
  });
}

async function resetActiveFailures(): Promise<void> {
  const active = await prisma.aiProvider.findFirst({ where: { isActive: true } });
  if (!active) return;
  await prisma.aiProviderModel.updateMany({
    where: { providerId: active.id },
    data: { failureCount: 0, lastError: "" },
  });
}

export async function withModelFailover<T>(
  _action: ModelAction,
  run: (c: ModelCandidate) => Promise<T>,
  preferred?: string
): Promise<T> {
  let lastErr: unknown = null;
  let sawTransient = false;

  const cycle = async (cands: ModelCandidate[]): Promise<Cycle<T>> => {
    for (const c of cands) {
      // retry 429 (rate limit) maks 2x dgn backoff — jangan langsung pindah model
      const maxRetry429 = 2;
      for (let attempt = 0; ; attempt++) {
        try {
          const value = await run(c);
          await markOk(c);
          return { ok: true, value };
        } catch (e) {
          const st = errStatus(e);
          if (ABORT_STATUS.has(st)) throw e;
          // abort dari luar (tutup halaman / user batal) → hentikan total
          if (e instanceof Error && e.name === "AbortError") throw e;
          // timeout PER PERCOBAAN (AbortSignal per kandidat di llm-client):
          // kandidat ini dianggap menggantung → lanjut kandidat berikut, jangan
          // menumpuk sampai deadline total milik user
          if (e instanceof Error && e.name === "TimeoutError") {
            lastErr = e;
            console.warn(`[llm] model ${c.model} timeout percobaan ke-${attempt + 1} → lanjut kandidat berikutnya`);
            break;
          }
          lastErr = e;
          // model tidak support tool calling → skip permanen (guard/safeguard models)
          if (/tool calling.*not supported|does not support tools/i.test(errMsg(e))) {
            await markFail(c, 400, "tool_calling_unsupported");
            break;
          }
          // kuota harian (TPD) bersifat org-wide & reset butuh belasan menit →
          // jangan retry/backoff (sia-sia) dan jangan naikkan failureCount
          // (bukan kesehatan model); langsung gagal cepat dgn info utk admin.
          if (st === 429 && /tokens per day|\(TPD\)|per day/i.test(errMsg(e))) {
            await prisma.aiProviderModel.updateMany({
              where: { providerId: c.provider.id, name: c.model },
              data: { lastError: errMsg(e), lastFailAt: new Date() },
            });
            throw e;
          }
          // rate limit (rolling window) → backoff & retry model yg sama
          // quota habis → JANGAN retry, langsung pindah model
          const isRateLimit = st === 429 && /rate.?limit|itpm|tokens per minute|per minute/i.test(errMsg(e));
          if (isRateLimit && attempt < maxRetry429) {
            const delay = 1500 * (attempt + 1); // 1.5s, 3s
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          if (isTransient(st)) {
            sawTransient = true;
            await markFail(c, st, errMsg(e));
          }
          console.warn(`[llm] gagal model ${c.model} (status=${st} percobaan ke-${attempt + 1}): ${errMsg(e).slice(0, 140)}`);
          break; // pindah ke kandidat berikutnya
        }
      }
    }
    return { ok: false };
  };

  let models = await candidates(preferred);
  let out = await cycle(models);
  if (out.ok) return out.value;

  if (sawTransient) {
    await resetActiveFailures();
    models = await candidates(preferred);
    out = await cycle(models);
    if (out.ok) return out.value;
  }

  throw lastErr ?? new LlmHttpError(503, "tidak ada model AI tersedia");
}

/**
 * Failover untuk STREAM (async generator).
 *
 * Perbedaan dgn withModelFailover: `run` hanya MENGEMBALIKAN generator (lazy —
 * belum ada HTTP). Bila fetch+error dilakukan di luar (saat `yield*`), seluruh
 * logika retry/failover di withModelFailover dilewati → 429/ECONNRESET langsung
 * meledak ke user. Di sini iterasi dilakukan DI DALAM try/catch failover.
 *
 * Retry hanya bila BELUM ada output yg diyield utk attempt tsb (gagal saat
 * connect/header/awal stream) — jika sebagian teks sudah terkirim ke caller,
 * mengulang akan menduplikasi teks → error diteruskan apa adanya.
 */
export async function* withStreamFailover<T>(
  iterate: (c: ModelCandidate) => AsyncGenerator<T>,
  preferred?: string
): AsyncGenerator<T> {
  let lastErr: unknown = null;
  let sawTransient = false;
  let done = false; // ditandai saat 1 kandidat sukses tuntas

  // cycle = async generator agar bisa yield item sambil menjalankan retry/failover
  const cycle = async function* (cands: ModelCandidate[]): AsyncGenerator<T> {
    for (const c of cands) {
      const maxRetry429 = 2;
      for (let attempt = 0; ; attempt++) {
        let yielded = false;
        try {
          for await (const item of iterate(c)) {
            yielded = true;
            yield item;
          }
          await markOk(c);
          done = true;
          return;
        } catch (e) {
          // sudah terkirim sebagian output → tak bisa diulang tanpa duplikasi teks
          if (yielded) throw e;
          // abort luar → hentikan; timeout percobaan → kandidat berikut (menggantung)
          if (e instanceof Error && e.name === "AbortError") throw e;
          if (e instanceof Error && e.name === "TimeoutError") {
            lastErr = e;
            console.warn(`[llm] model ${c.model} timeout percobaan ke-${attempt + 1} → lanjut kandidat berikutnya`);
            break;
          }
          const st = errStatus(e);
          if (ABORT_STATUS.has(st)) throw e;
          lastErr = e;
          if (/tool calling.*not supported|does not support tools/i.test(errMsg(e))) {
            await markFail(c, 400, "tool_calling_unsupported");
            break;
          }
          if (st === 429 && /tokens per day|\(TPD\)|per day/i.test(errMsg(e))) {
            await prisma.aiProviderModel.updateMany({
              where: { providerId: c.provider.id, name: c.model },
              data: { lastError: errMsg(e), lastFailAt: new Date() },
            });
            throw e;
          }
          const isRateLimit = st === 429 && /rate.?limit|itpm|tokens per minute|per minute/i.test(errMsg(e));
          if (isRateLimit && attempt < maxRetry429) {
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
            continue;
          }
          // koneksi terputus sblm output (ECONNRESET/terminated) → retry singkat
          const isConnDrop = /terminated|ECONNRESET|socket hang up|network/i.test(errMsg(e));
          if (isConnDrop && attempt < 2) {
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
            continue;
          }
          if (isTransient(st)) {
            sawTransient = true;
            await markFail(c, st, errMsg(e));
          }
          console.warn(`[llm] gagal model ${c.model} (status=${st} percobaan ke-${attempt + 1}): ${errMsg(e).slice(0, 140)}`);
          break;
        }
      }
    }
  };

  let models = await candidates(preferred);
  for await (const item of cycle(models)) yield item;
  if (done) return;

  if (sawTransient) {
    await resetActiveFailures();
    models = await candidates(preferred);
    for await (const item of cycle(models)) yield item;
    if (done) return;
  }

  throw lastErr ?? new LlmHttpError(503, "tidak ada model AI tersedia");
}

/** Model rank-1 provider aktif (untuk preferred default di chat). */
export async function getDefaultModel(): Promise<string> {
  const m = await prisma.aiProviderModel.findFirst({
    where: { provider: { isActive: true }, failureCount: { lt: MAX_FAILURES } },
    orderBy: { rank: "asc" },
  });
  return m?.name ?? "";
}
