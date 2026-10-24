import type {
  AiModuleKey,
  AiModuleModelsResponse,
  AiProviderRow,
  AppSettings,
  ConnectionInfo,
  Me,
} from "@aigoogle/shared";

/**
 * Muat identitas user. Timeout 15 dtk + selalu resolve (null bila gagal) —
 * setelah idle panjang, koneksi half-open bisa menggantung; tanpa ini
 * PageLoader muter selamanya.
 */
export async function getMe(): Promise<Me | null> {
  try {
    const res = await fetch("/api/me", { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return (await res.json()) as Me;
  } catch {
    return null;
  }
}

/** login khusus operator platform (tabel akun terpisah) */
export async function platformLogin(email: string, password: string): Promise<void> {
  const res = await fetch("/api/platform/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error === "email_atau_password_salah" ? "Email atau password salah." : "Gagal masuk.");
  }
}

export async function getSettings(): Promise<AppSettings> {
  const res = await fetch("/api/settings");
  if (!res.ok) throw new Error("gagal memuat pengaturan");
  return res.json();
}

export async function putSettings(body: AppSettings): Promise<AppSettings> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("gagal menyimpan pengaturan");
  return res.json();
}

export async function getConnections(): Promise<ConnectionInfo[]> {
  const res = await fetch("/api/connections");
  if (!res.ok) return [];
  return res.json();
}

export interface AdminRole {
  id: string;
  key: string;
  name: string;
  permissions: string[];
}
export interface PrivilegesPayload {
  modules: Array<{ key: string; label: string; mirrorChecked: boolean }>;
  appFeatures: Array<{ key: string; label: string }>;
}
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  roleKey: string;
}
export interface AuditRow {
  id: string;
  action: string;
  userEmail: string;
  detail: string;
  createdAt: string;
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? "gagal");
  }
  return res.json() as Promise<T>;
}

export interface TenantLite {
  id: string;
  name: string;
  alias: string;
}
/** khusus Admin Platform: daftar semua perusahaan */
export const getAdminTenants = () => adminFetch<TenantLite[]>("/api/admin/tenants");
export const getRoles = (tenantId?: string) =>
  adminFetch<AdminRole[]>(`/api/admin/roles${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`);
export const getPrivileges = () => adminFetch<PrivilegesPayload>("/api/admin/privileges");
export const putRolePermissions = (id: string, permissions: string[]) =>
  adminFetch<{ ok: boolean }>(`/api/admin/roles/${id}/permissions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permissions }),
  });
export const getAdminUsers = (tenantId?: string) =>
  adminFetch<AdminUser[]>(`/api/admin/users${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`);
export const putUserRole = (id: string, roleKey: string) =>
  adminFetch<{ ok: boolean }>(`/api/admin/users/${id}/role`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roleKey }),
  });
export const getAuditLogs = (limit = 50, tenantId?: string) =>
  adminFetch<AuditRow[]>(`/api/admin/audit?limit=${limit}${tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : ""}`);

export interface CustomerRow {
  id: string;
  name: string;
  invoiceCount: number;
  invoiceTotal: number;
}
export interface ScanFields {
  docType: "faktur" | "nota" | "kwitansi" | "lainnya";
  customerName: string;
  date: string;
  no: string;
  total: number | null;
  description: string;
  items: Array<{ name: string; qty?: number | null; price?: number | null }>;
}
export type EntryTarget = "salesInvoice" | "salesReceipt" | "purchaseInvoice" | "expense" | "bankTransfer";
export interface ScanResponse {
  fileName: string;
  kind: string;
  rawText: string;
  fields: ScanFields;
  suggestedTarget: EntryTarget | null;
  /** modul yang disebut AI (bisa modul yang belum didukung atau "none") */
  aiModule?: string | null;
  aiReason?: string | null;
  aiConfidence?: number | null;
  ocrText?: string;
  warning?: string;
}

const MSG: Record<string, string> = {
    belum_connect: "Accurate belum terhubung — hubungkan dulu di Pengaturan.",
    tidak_punya_hak: "Anda tidak punya hak mengakses data ini — hubungi Admin.",
    vision_ocr_nonaktif:
      "Vision & OCR nonaktif. Minta Admin mengaktifkannya di menu Admin → tab Pengaturan.",
    unsupported_type: "Tipe file tidak didukung (gambar, PDF, DOCX, PPTX, DOC, PPT, MD, TXT).",
    file_too_large: "File terlalu besar (maks 15 MB).",
    empty_file: "File kosong.",
    empty_text: "Tidak ada teks yang bisa dibaca dari file ini.",
    ocr_gagal:
      "Vision & OCR gagal membaca gambar/PDF — layanan AI tidak tersedia atau kuota habis. Coba lagi nanti atau isi/manual salin teksnya.",
    vision_ocr_gagal:
      "AI gagal membaca isi dokumen — pastikan gambar/PDF jelas dan tidak buram, atau isi datanya secara manual, lalu simpan.",
  field_ocr_gagal:
    "Ekstraksi otomatis gagal — isi datanya secara manual, lalu simpan.",
};

async function apiError(res: Response): Promise<Error> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(MSG[j.error ?? ""] ?? j.error ?? "Terjadi kesalahan");
}

export function friendlyWarning(code?: string): string | null {
  return code ? (MSG[code] ?? code) : null;
}

export interface WaStatusLite {
  balance: number;
  rupiahPerCredit: number;
  waProvider: "meta" | "d360" | "waserver";
  waserverReady?: boolean;
  accountProvider: string | null;
  waD360PartnerId: string;
  settings: { autoDueDate: boolean; dailyReport: boolean; ownerPhone: string };
  recent: Array<{ id: string; to: string; body: string; status: string; error: string; createdAt: string }>;
}
/** callback Connect Button 360dialog → generate & simpan API key channel perusahaan */
export const waD360Onboard = (client: string, channels: string[]) =>
  adminFetch<{ ok: boolean; channel: string }>("/api/wa/d360/onboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client, channels }),
  });
/** platform: daftarkan redirect URL onboarding ke halaman WhatsApp */
export const setD360Redirect = () =>
  adminFetch<{ ok: boolean; redirect: string }>("/api/settings/d360-redirect", { method: "POST" });
export const getWaStatus = () => adminFetch<WaStatusLite>("/api/wa/status");
export const putWaSettings = (body: { autoDueDate?: boolean; dailyReport?: boolean; ownerPhone?: string }) =>
  adminFetch<unknown>("/api/wa/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// ── Waserver: aktivasi sesi WhatsApp (gateway Baileys) ──────────────────────
export interface WaWaserverSession {
  ready: boolean;
  state: "pending" | "connecting" | "connected" | "logged_out" | "banned";
  phone: string | null;
  /** data URL PNG QR — null bila sudah terhubung atau QR belum siap */
  qr: string | null;
  connected: boolean;
}
/** Ambil/buat sesi waserver utk perusahaan ini + QR untuk di-scan */
export const getWaWaserverSession = () => adminFetch<WaWaserverSession>("/api/wa/waserver/session");
/** Putuskan lalu sambungkan ulang sesi (memunculkan QR baru) */
export const reconnectWaWaserver = () =>
  adminFetch<{ ok: boolean }>("/api/wa/waserver/reconnect", { method: "POST" });
/** Hapus sesi — credential WhatsApp di gateway ikut terbuang, perlu scan ulang */
export const disconnectWaWaserver = () =>
  adminFetch<{ ok: boolean }>("/api/wa/waserver/session", { method: "DELETE" });

// ── Langganan gateway WhatsApp waserver (Midtrans) ─────────────────────────
export interface WaSubscribePlan {
  orderId: string;
  amount: number;
  plan: "1bulan" | "2bulan" | "3bulan";
  months: number;
  qris: { qrUrl: string; qrContent: string; contractId?: string; referenceNo?: string; expiredAt: string };
}
export const waSubscribe = (plan: "1bulan" | "2bulan" | "3bulan") =>
  adminFetch<WaSubscribePlan>("/api/wa/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });
export const getWaSubscribeStatus = (orderId: string) =>
  adminFetch<{ orderId: string; amount: number; status: string; settled: boolean }>(
    `/api/wa/subscribe/${orderId}/status`
  );

// ── Webhook Accurate: activity feed + config notifikasi WhatsApp ─────────────
export interface AccurateEventRow {
  id: string;
  event: string;
  dbId: string;
  payload: unknown;
  createdAt: string;
}
export async function getAccurateWebhookEvents(take = 50): Promise<AccurateEventRow[]> {
  const res = await fetch(`/api/accurate/webhook-events?take=${take}`);
  if (!res.ok) throw new Error("gagal memuat aktivitas");
  const j = (await res.json()) as { s: boolean; d: AccurateEventRow[] };
  return j.d ?? [];
}

export interface WaWebhookSettings {
  events: string[];
  rateMin: number;
  ownerPhone: string;
  options: Array<{ key: string; label: string }>;
}
export const getWaWebhookEvents = () => adminFetch<WaWebhookSettings>("/api/wa/webhook-events");
export const putWaWebhookEvents = (body: { events?: string[]; rateMin?: number; ownerPhone?: string }) =>
  adminFetch<WaWebhookSettings>("/api/wa/webhook-events", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export async function getCustomers(keywords = ""): Promise<CustomerRow[]> {
  const qs = keywords ? `?keywords=${encodeURIComponent(keywords)}` : "";
  const res = await fetch(`/api/customers${qs}`);
  if (!res.ok) throw await apiError(res);
  return res.json();
}

export async function uploadScan(
  file: File,
  hint?: { docType?: string; direction?: string; label?: string }
): Promise<ScanResponse> {
  const res = await fetch("/api/customers/scan", {
    method: "POST",
    headers: {
      "x-file-name": file.name,
      "Content-Type": file.type || "application/octet-stream",
      ...(hint ? { "x-doc-hint": JSON.stringify(hint) } : {}),
    },
    body: file,
  });
  if (!res.ok) throw await apiError(res);
  return res.json();
}

// ── Jenis dokumen kustom (per perusahaan) ────────────────────────────────────
export interface DocTypeRow {
  key: string;
  label: string;
  target?: string;
}
export const getDocTypes = () => adminFetch<{ types: DocTypeRow[] }>("/api/doc/types");
export const putDocTypes = (types: DocTypeRow[]) =>
  adminFetch<{ ok: boolean; types: DocTypeRow[] }>("/api/doc/types", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ types }),
  });

// ── Unggah file asli (foto dokumen) ke Drive — folder per jenis ───────────────
export interface DriveUploadResult {
  ok: boolean;
  id: string;
  name: string;
  folder: string;
  link: string;
}
export async function uploadDocToDrive(
  blob: Blob,
  opts: { fileName: string; docType: string; label?: string; party?: string; date?: string }
): Promise<DriveUploadResult> {
  const qs = new URLSearchParams({ docType: opts.docType });
  if (opts.label) qs.set("label", opts.label);
  if (opts.party) qs.set("party", opts.party);
  if (opts.date) qs.set("date", opts.date);
  const res = await fetch(`/api/drive/upload?${qs.toString()}`, {
    method: "POST",
    headers: {
      "x-file-name": opts.fileName,
      "Content-Type": opts.fileName.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg",
    },
    body: blob,
  });
  if (!res.ok) throw await apiError(res);
  return res.json();
}

export interface EntryBody {
  target: EntryTarget;
  customerName: string;
  date?: string;
  no?: string;
  total?: number;
  description?: string;
  items?: Array<{ name: string; qty?: number | null; price?: number | null }>;
}
export async function postEntry(body: EntryBody): Promise<{ ok: boolean; id: string; target: string }> {
  const res = await fetch("/api/customers/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await apiError(res);
  return res.json();
}

// ── Provider AI (halaman /ai, khusus Admin Platform) ─────────────────────────
export const getAiProviders = () => adminFetch<AiProviderRow[]>("/api/ai/providers");
export const createAiProvider = (body: { name: string; baseUrl: string; apiKey: string; models: string[] }) =>
  adminFetch<{ id: string }>("/api/ai/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export const updateAiProvider = (
  id: string,
  body: { name?: string; baseUrl?: string; apiKey?: string; models?: string[] }
) =>
  adminFetch<{ ok: boolean }>(`/api/ai/providers/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export const deleteAiProvider = (id: string) =>
  adminFetch<{ ok: boolean }>(`/api/ai/providers/${id}`, { method: "DELETE" });
export const activateAiProvider = (id: string) =>
  adminFetch<{ ok: boolean }>(`/api/ai/providers/${id}/activate`, { method: "POST" });
export const previewAiModels = (baseUrl: string, apiKey: string) =>
  adminFetch<{ models: string[] }>("/api/ai/providers/preview-models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl, apiKey }),
  });
export const refreshAiModels = (id: string) =>
  adminFetch<{ models: string[] }>(`/api/ai/providers/${id}/refresh-models`, { method: "POST" });

// ── Model per modul AI (halaman /ai-models, khusus Admin Platform) ──────────
export const getAiModuleModels = () => adminFetch<AiModuleModelsResponse>("/api/ai/module-models");
export const putAiModuleModels = (body: Partial<Record<AiModuleKey, string>>) =>
  adminFetch<{ ok: boolean }>("/api/ai/module-models", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export interface UsagePayload {
  today: { calls: number; tokens: number };
  limit: number;
  days: Array<{ day: string; calls: number; tokens: number }>;
}
export const getUsage = () => adminFetch<UsagePayload>("/api/usage");

export interface PlatformAnalytics {
  since: string;
  totals: { tenants: number; calls: number; tokens: number };
  tenants: Array<{
    tenantId: string;
    name: string;
    alias: string;
    calls: number;
    tokens: number;
    promptTokens: number;
    completionTokens: number;
    sessions: number;
    users: number;
    lastDay: string;
  }>;
}
export const getPlatformAnalytics = () => adminFetch<PlatformAnalytics>("/api/platform/analytics");

// ── Billing AI (saldo per member) ────────────────────────────────────────────
export interface AiWalletSummary {
  balance: number;
  minReserve: number;
  markup: number;
  usdIdr: number;
  spent30d: number;
  cost30d: number;
  tokens30d: number;
  calls30d: number;
}
export interface AiLedgerRow {
  id: string;
  kind: string;
  amount: number;
  cost: number;
  model: string;
  promptTokens: number;
  completionTokens: number;
  refId: string;
  meta: string;
  createdAt: string;
}
export interface AiTopupResponse {
  orderId: string;
  amount: number;
  feeAmount: number;
  credits: number;
  provider?: string;
  qris?: { qrUrl: string; qrContent: string; contractId?: string; expiredAt: string };
}
export interface AiMemberWallet {
  userId: string;
  name: string;
  email: string;
  role: string;
  balance: number | null;
}

export const getAiWallet = () => adminFetch<AiWalletSummary>("/api/ai/wallet");
export const getAiLedger = (take = 50) => adminFetch<AiLedgerRow[]>(`/api/ai/ledger?take=${take}`);
export const postAiTopup = (amount: number) =>
  adminFetch<AiTopupResponse>("/api/ai/topup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount }),
  });
export const getAiTopup = (orderId: string) =>
  adminFetch<{ orderId: string; status: string; credits: number; amount: number }>(`/api/ai/topup/${orderId}`);
export const mockSettleAiTopup = (orderId: string) =>
  adminFetch<{ ok: boolean }>(`/api/ai/topup/${orderId}/mock-settle`, { method: "POST" });
export const getAiWallets = () => adminFetch<AiMemberWallet[]>("/api/admin/ai/wallets");
export const adjustAiWallet = (userId: string, amount: number, note: string) =>
  adminFetch<{ ok: boolean; balance: number }>(`/api/admin/ai/wallets/${userId}/adjust`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, note }),
  });
