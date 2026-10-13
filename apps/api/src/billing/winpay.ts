import { createHash, createSign, createVerify } from "node:crypto";
import { prisma } from "../db.js";
import { WINPAY_DEFAULT_CLIENT_ID } from "@aigoogle/shared";

export type PaymentProvider = "winpay" | "midtrans";
export type WinpayEnv = "production" | "sandbox";

export interface PaymentSettings {
  provider: PaymentProvider;
  winpay: { clientId: string; privateKey: string; publicKey: string; env: WinpayEnv };
}

const SETTING_KEYS = ["paymentProvider", "winpayEnv", "winpayClientId", "winpayPrivateKey", "winpayPublicKey"] as const;

export async function paymentSettings(): Promise<PaymentSettings> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [...SETTING_KEYS] } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? "";
  return {
    provider: get("paymentProvider") === "midtrans" ? "midtrans" : "winpay",
    winpay: {
      clientId: get("winpayClientId") || WINPAY_DEFAULT_CLIENT_ID,
      privateKey: get("winpayPrivateKey"),
      publicKey: get("winpayPublicKey"),
      env: get("winpayEnv") === "sandbox" ? "sandbox" : "production",
    },
  };
}

export async function paymentProvider(): Promise<PaymentProvider> {
  return (await paymentSettings()).provider;
}

export function winpayBaseUrl(env: WinpayEnv): string {
  return env === "sandbox" ? "https://sandbox-snap.winpay.id" : "https://snap.winpay.id";
}

/** Winpay siap dipakai bila provider = winpay dan kunci merchant + public key Winpay lengkap. */
export async function winpayReady(): Promise<boolean> {
  const s = await paymentSettings();
  return s.provider === "winpay" && !!s.winpay.clientId && !!s.winpay.privateKey && !!s.winpay.publicKey;
}

/** Billing aktif bila provider terpilih benar-benar dikonfigurasi. */
export async function isBillingActive(): Promise<boolean> {
  const s = await paymentSettings();
  if (s.provider === "winpay") return !!s.winpay.clientId && !!s.winpay.privateKey && !!s.winpay.publicKey;
  const { isBillingEnabled } = await import("./midtrans.js");
  return isBillingEnabled();
}

/** WIB (UTC+7), format ISO8601 ala Winpay: 2023-08-24T17:07:05+07:00 */
function tsWib(d: Date = new Date()): string {
  const at = new Date(d.getTime() + 7 * 3600_000);
  return `${at.toISOString().slice(0, 19)}+07:00`;
}

/** stringToSign = METHOD:path:lowercase(hex(sha256(body))):timestamp */
function stringToSign(method: string, path: string, body: string, timestamp: string): string {
  const hash = createHash("sha256").update(body, "utf8").digest("hex").toLowerCase();
  return `${method}:${path}:${hash}:${timestamp}`;
}

function normalizePrivateKey(pem: string): string {
  return pem.trim().replace(/\\n/g, "\n");
}

/** public key bisa PEM atau base64 DER polos (SPKI) — bungkus jadi PEM bila perlu */
export function normalizePublicKey(key: string): string {
  const t = key.trim().replace(/\\n/g, "\n");
  if (t.includes("-----BEGIN")) return t;
  const der = Buffer.from(t.replace(/\s+/g, ""), "base64");
  const b64 = der.toString("base64").replace(/(.{64})/g, "$1\n").replace(/\n$/, "");
  return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----`;
}

function signRequest(privateKey: string, method: string, path: string, body: string, timestamp: string): string {
  const s = createSign("RSA-SHA256");
  s.update(stringToSign(method, path, body, timestamp));
  return s.sign(normalizePrivateKey(privateKey), "base64");
}

/** Verifikasi signature notifikasi dari Winpay (RSA-SHA256, base64). */
export function verifyWinpayCallback(
  publicKey: string,
  method: string,
  path: string,
  body: string,
  timestamp: string,
  signatureB64: string
): boolean {
  if (!signatureB64 || !timestamp) return false;
  try {
    const v = createVerify("RSA-SHA256");
    v.update(stringToSign(method, path, body, timestamp));
    return v.verify(normalizePublicKey(publicKey), Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

function externalId(): string {
  return `${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

export interface QrisResult {
  qrUrl: string;
  qrContent: string;
  contractId: string;
  expiredAt: string;
}

/** POST /v1.0/qr/qr-mpm-generate — QRIS MPM dinamis, berlaku 15 menit. */
export async function generateQris(orderId: string, amountRupiah: number): Promise<QrisResult> {
  const cfg = await paymentSettings();
  const w = cfg.winpay;
  if (!w.clientId || !w.privateKey) throw new Error("winpay_belum_dikonfigurasi");
  const path = "/v1.0/qr/qr-mpm-generate";
  const timestamp = tsWib();
  const body = JSON.stringify({
    partnerReferenceNo: orderId,
    amount: { value: amountRupiah.toFixed(2), currency: "IDR" },
    validityPeriod: tsWib(new Date(Date.now() + 15 * 60_000)),
    additionalInfo: { isStatic: false },
  });
  const r = await fetch(winpayBaseUrl(w.env) + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-TIMESTAMP": timestamp,
      "X-SIGNATURE": signRequest(w.privateKey, "POST", path, body, timestamp),
      "X-PARTNER-ID": w.clientId,
      "X-EXTERNAL-ID": externalId(),
      "CHANNEL-ID": "WEB",
    },
    body,
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || j.responseCode !== "2004700") {
    throw new Error(`winpay_${String(j.responseCode ?? r.status)}:${String(j.responseMessage ?? "").slice(0, 160)}`);
  }
  const info = (j.additionalInfo ?? {}) as Record<string, unknown>;
  return {
    qrUrl: String(j.qrUrl ?? ""),
    qrContent: String(j.qrContent ?? ""),
    contractId: String(info.contractId ?? ""),
    expiredAt: String(info.expiredAt ?? ""),
  };
}

/** POST /v1.0/qr/qr-mpm-query — cek status pembayaran (fallback bila notifikasi belum masuk). */
export async function queryQris(orderId: string, contractId: string): Promise<"paid" | "failed" | "pending"> {
  const cfg = await paymentSettings();
  const w = cfg.winpay;
  if (!w.clientId || !w.privateKey) throw new Error("winpay_belum_dikonfigurasi");
  const path = "/v1.0/qr/qr-mpm-query";
  const timestamp = tsWib();
  const body = JSON.stringify({
    originalPartnerReferenceNo: orderId,
    serviceCode: "47",
    additionalInfo: { contractId },
  });
  const r = await fetch(winpayBaseUrl(w.env) + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-TIMESTAMP": timestamp,
      "X-SIGNATURE": signRequest(w.privateKey, "POST", path, body, timestamp),
      "X-PARTNER-ID": w.clientId,
      "X-EXTERNAL-ID": externalId(),
      "CHANNEL-ID": "WEB",
    },
    body,
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || j.responseCode !== "2005100") {
    throw new Error(`winpay_${String(j.responseCode ?? r.status)}:${String(j.responseMessage ?? "").slice(0, 160)}`);
  }
  const s = String(j.latestTransactionStatus ?? "");
  if (s === "00") return "paid";
  if (s === "04" || s === "05" || s === "06") return "failed";
  return "pending";
}
