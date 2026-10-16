export interface Me {
  userId: string;
  id?: string;
  email: string;
  name: string;
  tenant: { id: string; name: string; alias: string; provider: string };
  roleKey: string;
  permissions?: string[];
  needsPassword?: boolean;
}
export interface ConnectionInfo {
  provider: string;
  status: "connected" | "expired" | "none";
  accountLabel?: string;
  expiresAt?: string;
}
export interface AppSettings {
  voiceEngine: "web-speech" | "edge";
  ocrMode?: "vision" | "text";
  waPricePerCredit?: number;
  /** penyedia WhatsApp perusahaan: d360 (default) | meta | waserver */
  waProvider?: "meta" | "d360" | "waserver";
  /** gateway waserver siap dipakai (diisi lewat env WASERVER_URL + WASERVER_API_KEY) */
  waserverReady?: boolean;
  waD360ApiKey?: string;
  waD360BaseUrl?: string;
  waD360PartnerId?: string;
  waD360PartnerKey?: string;
  /** penyedia pembayaran QRIS: winpay (default) | midtrans */
  paymentProvider?: "winpay" | "midtrans";
  /** lingkungan API Winpay */
  winpayEnv?: "production" | "sandbox";
  /** Client ID / Partner ID merchant Winpay */
  winpayClientId?: string;
  /** private key RSA merchant (PEM) — utk menandatangani request */
  winpayPrivateKey?: string;
  /** public key Winpay (PEM/base64) — utk memverifikasi notifikasi */
  winpayPublicKey?: string;
}

/** Client ID Winpay default (diisi Winpay saat onboarding merchant) */
export const WINPAY_DEFAULT_CLIENT_ID = "3ae34b38-24c6-4fe4-8b26-9deb548020e7";

export interface AiProviderModelRow {
  name: string;
  rank: number;
  failureCount: number;
  lastError: string;
  lastOkAt: string | null;
}
export interface AiProviderRow {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyMasked: string; // "••••" + 4 char terakhir
  isActive: boolean;
  models: AiProviderModelRow[];
}

export type AiModuleKey = "chat" | "voice" | "drive" | "uploadImage" | "uploadDocument";

export interface AiModuleModelRow {
  key: AiModuleKey;
  label: string;
  hint: string;
  value: string; // "" = otomatis (rank-1 provider aktif + failover)
}

export interface AiModuleModelsResponse {
  providerName: string;
  available: Array<{ name: string; rank: number }>;
  modules: AiModuleModelRow[];
}
