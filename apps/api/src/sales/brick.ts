import { env } from "../env.js";

/** Brick (onebrick) — Bank Account Validation: cek akun rekening Indonesia sebelum
 *  menyimpan sebagai tujuan penarikan. Token akses singkat (5 mnt, sekali pakai)
 *  dibuat per-request, lalu dipakai endpoint validation. */
export type BrickEnv = "sandbox" | "production";

export function brickBaseUrl(): string {
  return env.BRICK_ENV === "production" ? "https://api.onebrick.io" : "https://sandbox.onebrick.io";
}

export function brickReady(): boolean {
  return (env.BRICK_CLIENT_ID ?? "") !== "" && (env.BRICK_CLIENT_SECRET ?? "") !== "";
}

/** GET /v2/payments/auth/token — public access token (Basic clientId:clientSecret) */
export async function brickAccessToken(): Promise<string> {
  if (!brickReady()) throw new Error("brick_belum_dikonfigurasi");
  const r = await fetch(brickBaseUrl() + "/v2/payments/auth/token", {
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.BRICK_CLIENT_ID}:${env.BRICK_CLIENT_SECRET}`).toString("base64")}`,
      Accept: "application/json",
    },
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const data = (j.data ?? {}) as Record<string, unknown>;
  if (!r.ok || typeof data.accessToken !== "string" || !data.accessToken) {
    const err = (j.errors ?? {}) as Record<string, unknown>;
    throw new Error(`brick_token_${r.status}:${String(err.message ?? j.message ?? "").slice(0, 160)}`);
  }
  return data.accessToken as string;
}

export interface BrickValidation {
  ok: boolean;
  accountName?: string;
  activityId?: string;
  error?: string;
}

/** GET /v2/payments/gs/bank-account-validation — cek apakah nomor rekening valid. */
export async function brickValidateAccount(opts: {
  bankShortCode: string;
  accountNumber: string;
  clientReference?: string;
}): Promise<BrickValidation> {
  const token = await brickAccessToken();
  const qs = new URLSearchParams({
    accountNumber: opts.accountNumber,
    bankShortCode: opts.bankShortCode,
  });
  if (opts.clientReference) qs.set("clientReference", opts.clientReference);
  const r = await fetch(`${brickBaseUrl()}/v2/payments/gs/bank-account-validation?${qs.toString()}`, {
    method: "GET",
    headers: {
      publicAccessToken: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const err = (j.error ?? j.errors ?? {}) as Record<string, unknown>;
    const msg = String(err.message ?? j.message ?? "validasi_gagal");
    return { ok: false, error: `${String(err.code ?? r.status)}:${msg.slice(0, 200)}` };
  }
  const data = (j.data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    accountName: String(data.accountName ?? ""),
    activityId: String(data.activityId ?? ""),
  };
}
