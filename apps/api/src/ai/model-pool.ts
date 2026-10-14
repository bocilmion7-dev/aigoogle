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
      try {
        const value = await run(c);
        await markOk(c);
        return { ok: true, value };
      } catch (e) {
        const st = errStatus(e);
        if (ABORT_STATUS.has(st)) throw e;
        lastErr = e;
        if (isTransient(st)) {
          sawTransient = true;
          await markFail(c, st, errMsg(e));
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

/** Model rank-1 provider aktif (untuk preferred default di chat). */
export async function getDefaultModel(): Promise<string> {
  const m = await prisma.aiProviderModel.findFirst({
    where: { provider: { isActive: true }, failureCount: { lt: MAX_FAILURES } },
    orderBy: { rank: "asc" },
  });
  return m?.name ?? "";
}
