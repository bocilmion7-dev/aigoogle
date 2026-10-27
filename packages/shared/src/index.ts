export interface Me {
  userId: string;
  id?: string;
  email: string;
  name: string;
  phone?: string;
  tenant: { id: string; name: string; alias: string; provider: string };
  roleKey: string;
  permissions?: string[];
  needsPassword?: boolean;
  emailVerified?: boolean;
  twoFactorEnabled?: boolean;
  emailOtpEnabled?: boolean;
  backupCodesRemaining?: number;
  impersonated?: boolean;
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
  /** penyedia WhatsApp perusahaan: waserver (default) | meta */
  waProvider?: "meta" | "waserver";
  /** gateway waserver siap dipakai (diisi lewat env WASERVER_URL + WASERVER_API_KEY) */
  waserverReady?: boolean;
  /** 3 paket langganan WhatsApp Gateway (nama, durasi bulan, harga) */
  waSubPlans?: WaSubPlan[];
  /** 3 pilihan nominal top up saldo META */
  waMetaTopups?: WaMetaTopup[];
  /** paket top up saldo token AI (harga + jumlah token) */
  aiTopupPackages?: AiTopupPackage[];
  /** 3 paket langganan AI bulanan */
  aiSubPlans?: AiSubPlan[];
  /** bonus token untuk perusahaan yang pertama kali registrasi via Accurate */
  aiSignupBonusTokens?: number;
}

export interface WaSubPlan {
  id: string;
  name: string;
  months: number;
  price: number;
}

export const DEFAULT_WA_SUB_PLANS: WaSubPlan[] = [
  { id: "p1", name: "1 Bulan", months: 1, price: 30000 },
  { id: "p2", name: "2 Bulan", months: 2, price: 50000 },
  { id: "p3", name: "3 Bulan", months: 3, price: 75000 },
];

export interface WaMetaTopup {
  id: string;
  label: string;
  amount: number;
}

export const DEFAULT_WA_META_TOPUPS: WaMetaTopup[] = [
  { id: "t1", label: "10 Ribu", amount: 10000 },
  { id: "t2", label: "25 Ribu", amount: 25000 },
  { id: "t3", label: "50 Ribu", amount: 50000 },
];

export interface AiTopupPackage {
  id: string;
  price: number;
  tokens: number;
}

export const DEFAULT_AI_TOPUP_PACKAGES: AiTopupPackage[] = [
  { id: "a1", price: 10000, tokens: 250000 },
  { id: "a2", price: 25000, tokens: 625000 },
  { id: "a3", price: 50000, tokens: 1250000 },
  { id: "a4", price: 100000, tokens: 2500000 },
];

export interface AiSubPlan {
  id: string;
  name: string;
  months: number;
  price: number;
  tokens: number;
  features: string[];
}

export const DEFAULT_AI_SUB_PLANS: AiSubPlan[] = [
  {
    id: "starter",
    name: "Starter",
    months: 1,
    price: 49000,
    tokens: 1000000,
    features: ["1 juta token / bulan", "Chat & voice AI", "Scan dokumen"],
  },
  {
    id: "pro",
    name: "Pro",
    months: 1,
    price: 149000,
    tokens: 5000000,
    features: ["5 juta token / bulan", "Semua fitur Starter", "Prioritas model cepat", "Riwayat & analitik"],
  },
  {
    id: "bisnis",
    name: "Bisnis",
    months: 1,
    price: 399000,
    tokens: 15000000,
    features: ["15 juta token / bulan", "Semua fitur Pro", "Multi-user perusahaan", "Dukungan prioritas"],
  },
];

export const DEFAULT_AI_SIGNUP_BONUS_TOKENS = 250000;

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
