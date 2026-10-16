import { createHash, createHmac, createSign, createVerify } from "node:crypto";

export type MidtransEnv = "sandbox" | "production";

/** BI-SNAP Core API base domain (access token + transactional API). */
export function midtransBaseUrl(env: MidtransEnv): string {
  return env === "production" ? "https://merchants.midtrans.com" : "https://merchants.sbx.midtrans.com";
}

export function midtransEnv(): MidtransEnv {
  return (process.env.MIDTRANS_ENV ?? "sandbox") === "production" ? "production" : "sandbox";
}

/** BI-SNAP siap dipakai bila kredensial lengkap (client id, secret, private key, public key). */
export function midtransSnapReady(): boolean {
  return (
    (process.env.MIDTRANS_CLIENT_ID ?? "") !== "" &&
    (process.env.MIDTRANS_CLIENT_SECRET ?? "") !== "" &&
    (process.env.MIDTRANS_MERCHANT_PRIVATE_KEY ?? "") !== "" &&
    (process.env.MIDTRANS_PUBLIC_KEY ?? "") !== ""
  );
}

/** WIB (UTC+7), format ISO8601 ala BI-SNAP: 2023-08-24T17:07:05+07:00 */
export function tsWib(d: Date = new Date()): string {
  const at = new Date(d.getTime() + 7 * 3600_000);
  return `${at.toISOString().slice(0, 19)}+07:00`;
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

/** stringToSign utk notifikasi & transaksional (RSA/HMAC): METHOD:path:lowercase(hex(sha256(body))):timestamp */
export function stringToSign(method: string, path: string, body: string, timestamp: string): string {
  const hash = createHash("sha256").update(body, "utf8").digest("hex").toLowerCase();
  return `${method}:${path}:${hash}:${timestamp}`;
}

/** Verifikasi signature notifikasi dari Midtrans (asymmetric SHA256withRSA, base64). */
export function verifyMidtransNotification(
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

/** X-SIGNATURE utk Access Token B2B: SHA256withRSA(ClientID + "|" + X-TIMESTAMP) */
function signAccessToken(clientId: string, timestamp: string): string {
  const s = createSign("RSA-SHA256");
  s.update(`${clientId}|${timestamp}`);
  return s.sign(normalizePrivateKey(process.env.MIDTRANS_MERCHANT_PRIVATE_KEY ?? ""), "base64");
}

/** X-SIGNATURE utk Transaksional: HMAC_SHA512(method:path:accessToken:sha256(body):timestamp) dgn client secret */
function signTransactional(
  method: string,
  path: string,
  accessToken: string,
  body: string,
  timestamp: string
): string {
  const hash = createHash("sha256").update(body, "utf8").digest("hex").toLowerCase();
  const sts = `${method}:${path}:${accessToken}:${hash}:${timestamp}`;
  const secret = process.env.MIDTRANS_CLIENT_SECRET ?? "";
  return createHmac("sha512", secret).update(sts).digest("base64");
}

function externalId(): string {
  return `${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/** POST /v1.0/access-token/b2b — OAuth2 client_credentials, token valid 15 menit (cache 14 mnt). */
export async function getAccessToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const clientId = process.env.MIDTRANS_CLIENT_ID ?? "";
  if (!clientId || !process.env.MIDTRANS_MERCHANT_PRIVATE_KEY) throw new Error("midtrans_belum_dikonfigurasi");
  const path = "/v1.0/access-token/b2b";
  const timestamp = tsWib();
  const r = await fetch(midtransBaseUrl(midtransEnv()) + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-TIMESTAMP": timestamp,
      "X-CLIENT-KEY": clientId,
      "X-SIGNATURE": signAccessToken(clientId, timestamp),
    },
    body: JSON.stringify({ grantType: "client_credentials" }),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || j.responseCode !== "2007300" || typeof j.accessToken !== "string") {
    throw new Error(`midtrans_token_${String(j.responseCode ?? r.status)}:${String(j.responseMessage ?? "").slice(0, 160)}`);
  }
  const expiresIn = Number(j.expiresIn ?? 900);
  cachedToken = { token: j.accessToken, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
  return j.accessToken;
}

export interface QrisResult {
  qrUrl: string;
  qrContent: string;
  referenceNo: string;
  expiredAt: string;
}

/** POST /v1.0/qr/qr-mpm-generate — QRIS MPM dinamis (default 15 menit). */
export async function generateQrMpm(orderId: string, amountRupiah: number): Promise<QrisResult> {
  const clientId = process.env.MIDTRANS_CLIENT_ID ?? "";
  const partnerId = process.env.MIDTRANS_MERCHANT_ID ?? process.env.MIDTRANS_PARTNER_ID ?? "";
  const channelId = process.env.MIDTRANS_CHANNEL_ID ?? "12345";
  if (!clientId || !process.env.MIDTRANS_CLIENT_SECRET) throw new Error("midtrans_belum_dikonfigurasi");
  const path = "/v1.0/qr/qr-mpm-generate";
  const timestamp = tsWib();
  const body = JSON.stringify({
    partnerReferenceNo: orderId,
    amount: { value: amountRupiah.toFixed(2), currency: "IDR" },
    merchantId: partnerId,
    validityPeriod: tsWib(new Date(Date.now() + 15 * 60_000)),
    additionalInfo: { isStatic: false },
  });
  const token = await getAccessToken();
  const r = await fetch(midtransBaseUrl(midtransEnv()) + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "X-TIMESTAMP": timestamp,
      "X-SIGNATURE": signTransactional("POST", path, token, body, timestamp),
      "X-PARTNER-ID": partnerId,
      "X-EXTERNAL-ID": orderId,
      "CHANNEL-ID": channelId,
    },
    body,
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || j.responseCode !== "2004700") {
    throw new Error(`midtrans_${String(j.responseCode ?? r.status)}:${String(j.responseMessage ?? "").slice(0, 160)}`);
  }
  return {
    qrUrl: String(j.qrUrl ?? ""),
    qrContent: String(j.qrContent ?? ""),
    referenceNo: String(j.referenceNo ?? ""),
    expiredAt: timestamp,
  };
}
