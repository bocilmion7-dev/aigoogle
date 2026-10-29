import type { AiTopupPackage, Me } from "@aigoogle/shared";

/**
 * Modul kecil untuk identitas & saldo. Dipisah dari api.ts agar landing
 * tidak ikut mengunduh seluruh fungsi API (analytics, admin, WA, dll.).
 */
export const AI_WALLET_EVENT = "ai-wallet-updated";
export function notifyAiWalletChanged(): void {
  window.dispatchEvent(new Event(AI_WALLET_EVENT));
}

export type AiGateReason = "subscription" | "token";
export const AI_GATE_EVENT = "aigoogle:ai-gate";
export function notifyAiGate(reason: AiGateReason): void {
  window.dispatchEvent(new CustomEvent(AI_GATE_EVENT, { detail: { reason } }));
}

export interface AiWalletSummary {
  balanceTokens: number;
  rupiahPer1kTokens: number;
  minReserveTokens: number;
  markup: number;
  usdIdr: number;
  tokens30d: number;
  spentTokens30d: number;
  calls30d: number;
  topupPackages: AiTopupPackage[];
  access?: {
    reason: AiGateReason | "ok";
    subscriptionActive: boolean;
    trialActive: boolean;
    trialEndsAt: string | null;
    balance: number;
    minReserve: number;
  };
  balance: number;
  spent30d: number;
  cost30d: number;
  minReserve: number;
}

const inflight = new Map<string, Promise<unknown>>();
const recent = new Map<string, { at: number; value: unknown }>();
const COALESCE_MS = 1_500;
const CACHE_MS: Record<string, number> = { me: 30_000, "ai-wallet": 10_000 };

function coalescedGet<T>(key: string, run: () => Promise<T>, force = false): Promise<T> {
  if (!force) {
    const hit = recent.get(key);
    const ttl = CACHE_MS[key] ?? COALESCE_MS;
    if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.value as T);
    const flight = inflight.get(key);
    if (flight) return flight as Promise<T>;
  }
  const p = run()
    .then((v) => {
      // Jangan cache null (mis. error jaringan) — biar percobaan berikutnya
      // benar-benar memanggil server lagi.
      if (v !== null) recent.set(key, { at: Date.now(), value: v });
      return v;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export type SessionError = "auth" | "network" | null;
let lastSessionError: SessionError = null;

/** Penyebab kegagalan getMe terakhir: 401/403 (auth) atau jaringan/timeout. */
export function getLastSessionError(): SessionError {
  return lastSessionError;
}

const SESSION_TIMEOUT_MS = 6_000;
const IDLE_RECONNECT_MS = 15_000;
let lastSessionNetworkAt = Date.now();

/**
 * Setelah tab lama idle, HP/proxy bisa menyimpan koneksi keep-alive setengah
 * mati. GET /api/me lalu menggantung sampai timeout tanpa pernah sampai ke
 * server (tidak ada log akses). Hangatkan dengan GET idempoten dulu.
 */
async function warmSessionConnection(force = false): Promise<void> {
  if (!force && Date.now() - lastSessionNetworkAt < IDLE_RECONNECT_MS) return;
  try {
    await fetch(`/api/health?warm=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
    });
  } catch {
    /* tetap coba /api/me */
  }
  lastSessionNetworkAt = Date.now();
}

async function fetchMeOnce(): Promise<Me | null> {
  const res = await fetch(`/api/me?t=${Date.now()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
  });
  lastSessionNetworkAt = Date.now();
  // Hanya 401/403 yang berarti sesi benar-benar tidak valid.
  if (res.status === 401 || res.status === 403) {
    lastSessionError = "auth";
    return null;
  }
  if (!res.ok) throw new Error("session_fetch_failed");
  const me = (await res.json()) as Me;
  lastSessionError = null;
  return me;
}

export async function getMe(force = false): Promise<Me | null> {
  return coalescedGet(
    "me",
    async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt === 0) await warmSessionConnection(force);
        else {
          await new Promise((r) => setTimeout(r, 500));
          await warmSessionConnection(true);
        }
        try {
          return await fetchMeOnce();
        } catch {
          /* coba sekali lagi lewat koneksi baru */
        }
      }
      // Timeout/putus koneksi/5xx BUKAN logout. Pakai sesi terakhir yang
      // pernah sukses bila ada, supaya halaman tidak terlempar ke login.
      lastSessionError = "network";
      const stale = recent.get("me")?.value as Me | undefined;
      return stale ?? null;
    },
    force
  );
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(j.message || j.error || "gagal");
  }
  return res.json() as Promise<T>;
}

export const getAiWallet = (force = false) =>
  coalescedGet("ai-wallet", () => getJson<AiWalletSummary>("/api/ai/wallet"), force);

/** Batalkan cache sesi (dipanggil setelah login/logout). */
export function resetSessionCache(): void {
  recent.delete("me");
  recent.delete("ai-wallet");
  inflight.clear();
  lastSessionError = null;
}
