import type { AiProviderRow, AppSettings, ConnectionInfo, Me } from "@aigoogle/shared";

export async function getMe(): Promise<Me | null> {
  const res = await fetch("/api/me");
  if (!res.ok) return null;
  return res.json();
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
  waProvider: "meta" | "d360";
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

export async function uploadScan(file: File): Promise<ScanResponse> {
  const res = await fetch("/api/customers/scan", {
    method: "POST",
    headers: { "x-file-name": file.name, "Content-Type": file.type || "application/octet-stream" },
    body: file,
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
