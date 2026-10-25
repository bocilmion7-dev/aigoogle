import type {
  AiModuleKey,
  AiModuleModelsResponse,
  AiProviderRow,
  AiSubPlan,
  AiTopupPackage,
  AppSettings,
  ConnectionInfo,
  Me,
  WaSubPlan,
} from "@aigoogle/shared";

/**
 * Muat identitas user. Timeout 15 dtk + selalu resolve (null bila gagal) —
 * setelah idle panjang, koneksi half-open bisa menggantung; tanpa ini
 * PageLoader muter selamanya.
 */
/** Event global: saldo token berubah (chat/voice selesai) → header memuat ulang. */
export const AI_WALLET_EVENT = "ai-wallet-updated";
export function notifyAiWalletChanged(): void {
  window.dispatchEvent(new Event(AI_WALLET_EVENT));
}

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
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(j.message || j.error || "gagal");
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
  /** false bila AI menilai gambar bukan dokumen */
  isDocument?: boolean;
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
  waProvider: "meta" | "waserver";
  waserverReady?: boolean;
  accountProvider: string | null;
  settings: { autoDueDate: boolean; dailyReport: boolean; ownerPhone: string };
  recent: Array<{ id: string; to: string; body: string; status: string; error: string; createdAt: string }>;
}
export interface WaChatSummary {
  peer: string;
  lastMessage: string;
  lastAt: string | null;
  direction: string;
  status: string;
  error: string;
  count: number;
}
export interface WaChatMessage {
  id: string;
  body: string;
  direction: string;
  status: string;
  error: string;
  createdAt: string;
}
export const getWaChats = () => adminFetch<WaChatSummary[]>("/api/wa/chats");
export const getWaChatMessages = (peer: string) =>
  adminFetch<WaChatMessage[]>(`/api/wa/chats/${encodeURIComponent(peer)}/messages`);
export const sendWaMessage = (to: string, text: string) =>
  adminFetch<{ ok: boolean; balance: number }>("/api/wa/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, text }),
  });

// ── Pesanan toko (AI penjaga toko) + simulator pembayaran QRIS ──────────────
export interface WaShopOrderItem {
  name: string;
  no?: string;
  qty: number;
  price: number;
  subtotal: number;
}
export interface WaShopOrder {
  orderId: string;
  tenantId: string;
  buyerPhone: string;
  buyerName: string;
  items: WaShopOrderItem[];
  total: number;
  status: "pending" | "paid" | "failed";
  qrUrl: string;
  expiresAt: string;
  createdAt: string;
}
/** Daftar pesanan toko pada satu percakapan; `simulator` = tombol bayar-uji boleh tampil */
export const getWaShopOrders = (peer: string) =>
  adminFetch<{ simulator: boolean; orders: WaShopOrder[] }>(
    `/api/wa/shop/orders?peer=${encodeURIComponent(peer)}`
  );
/** Tandai lunas lewat simulator (jalur sama dgn notifikasi Midtrans) */
export const settleWaShopOrder = (orderId: string) =>
  adminFetch<{ ok: boolean; orderId: string; status: string }>(
    `/api/wa/shop/orders/${encodeURIComponent(orderId)}/settle-test`,
    { method: "POST" }
  );

// ── Halaman Pesanan: pesanan WA ditautkan ke dokumen Accurate ──────────────
export interface OrderDocRef {
  id: string;
  number: string;
}
export interface OrderAccurate {
  customerNo?: string;
  customerName?: string;
  salesOrder?: OrderDocRef;
  salesInvoice?: OrderDocRef;
  salesReceipt?: OrderDocRef;
  syncedAt?: string;
  lastError?: string;
}
export interface OrderShipping {
  destinationAddress?: string;
  destinationPostalCode?: string;
  destinationNote?: string;
  courierName?: string;
  courierCode?: string;
  serviceName?: string;
  serviceCode?: string;
  price?: number;
  duration?: string;
  weightGram?: number;
  biteshipOrderId?: string;
  trackingId?: string;
  trackingLink?: string;
  waybillId?: string;
  status?: string;
}
/** tahap pesanan diturunkan server: menunggu|lunas|pesanan-acc|difakturkan|selesai|gagal */
export interface OrderRow extends WaShopOrder {
  stage: string;
  fulfillment?: "pickup" | "courier";
  itemsSubtotal?: number;
  /** nomor HP yang dikumpulkan AI dari pembeli (bisa beda dgn nomor WA) */
  buyerContactPhone?: string;
  shipping?: OrderShipping;
  accurate?: OrderAccurate;
}
export const getOrders = (params?: { status?: string; q?: string }) => {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.q) qs.set("q", params.q);
  const s = qs.toString();
  return adminFetch<{ accurateConnected: boolean; orders: OrderRow[] }>(`/api/orders${s ? `?${s}` : ""}`);
};
export interface AccurateCustomerRef {
  customerNo: string;
  name: string;
  mobilePhone?: string;
}
export const searchAccurateCustomers = (q: string) =>
  adminFetch<AccurateCustomerRef[]>(`/api/orders/customers?q=${encodeURIComponent(q)}`);
export type OrderAccurateDoc = "customer" | "sales-order" | "sales-invoice" | "sales-receipt" | "close-order" | "retry";
// ── Pengiriman (Biteship): asal gudang, order, pelacakan ───────────────────
export interface ShippingOrigin {
  contactName: string;
  phone: string;
  email?: string;
  organization: string;
  address: string;
  postalCode: string;
  note?: string;
}
export interface ShippingArea {
  id: string;
  name: string;
  postalCode: string;
}
export const getShippingSettings = () =>
  adminFetch<{ origin: ShippingOrigin; biteshipReady: boolean; biteshipMode: "off" | "test" | "live"; couriers: string }>(
    "/api/shipping/settings"
  );
export const putShippingSettings = (body: Partial<ShippingOrigin>) =>
  adminFetch<{ origin: ShippingOrigin; biteshipReady: boolean; biteshipMode: "off" | "test" | "live" }>("/api/shipping/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export const searchShippingAreas = (q: string) =>
  adminFetch<ShippingArea[]>(`/api/shipping/areas?q=${encodeURIComponent(q)}`);
export const createBiteshipOrder = (orderId: string) =>
  adminFetch<{ ok: boolean; shipment: { id: string; waybillId: string; status: string }; order: OrderRow | null }>(
    `/api/orders/${encodeURIComponent(orderId)}/biteship`,
    { method: "POST" }
  );
export interface OrderTracking {
  id: string;
  waybillId: string;
  courier: { company: string; name?: string; driverName?: string; driverPhone?: string };
  status: string;
  history: Array<{ note: string; status: string; updatedAt: string }>;
}
export const getOrderTracking = (orderId: string) =>
  adminFetch<{ ok: boolean; tracking: OrderTracking }>(`/api/orders/${encodeURIComponent(orderId)}/tracking`);

export const runOrderAccurate = (
  orderId: string,
  body: { doc: OrderAccurateDoc; customerNo?: string; customerName?: string; date?: string; note?: string; bankNo?: string }
) =>
  adminFetch<{ ok: boolean; order: OrderRow | null }>(`/api/orders/${encodeURIComponent(orderId)}/accurate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const getWaStatus = () => adminFetch<WaStatusLite>("/api/wa/status");

// ── Sandbox WhatsApp (pipeline sama dengan live, tanpa kirim WA) ───────────
export interface SandboxSession {
  peer: string;
  shopAi: boolean;
  ownerPhone: string;
  accurateConnected: boolean;
  biteshipReady: boolean;
  aiAccess: boolean;
  messages: WaChatMessage[];
}
export const getSandboxSession = () => adminFetch<SandboxSession>("/api/sandbox/session");
export const getSandboxMessages = () => adminFetch<WaChatMessage[]>("/api/sandbox/messages");
export const sendSandboxMessage = (text: string) =>
  adminFetch<{ replied: boolean; reason?: string; messages: WaChatMessage[] }>("/api/sandbox/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
export const clearSandbox = () =>
  adminFetch<{ ok: boolean; deleted: number }>("/api/sandbox/messages", { method: "DELETE" });
export const putWaSettings = (body: { autoDueDate?: boolean; dailyReport?: boolean; ownerPhone?: string; shopAi?: boolean }) =>
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
export interface WaSubscribeResult {
  orderId: string;
  amount: number;
  plan: WaSubPlan;
  months: number;
  qris: { qrUrl: string; qrContent: string; contractId?: string; referenceNo?: string; expiredAt: string };
}
export const waSubscribe = (plan: string) =>
  adminFetch<WaSubscribeResult>("/api/wa/subscribe", {
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
  invoiceNo?: string;
  bankNo?: string;
  expenseAccountNo?: string;
  fromBankNo?: string;
  toBankNo?: string;
}
export interface EntryOptions {
  bankAccounts: Array<{ no: string; name: string }>;
  expenseAccounts: Array<{ no: string; name: string }>;
  invoices: Array<{ number: string; transDate: string; totalAmount: number }>;
}
export async function getEntryOptions(customerName = ""): Promise<EntryOptions> {
  const qs = customerName ? `?customerName=${encodeURIComponent(customerName)}` : "";
  return adminFetch<EntryOptions>(`/api/customers/entry-options${qs}`);
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
export type AiGateReason = "subscription" | "token";
export const AI_GATE_EVENT = "aigoogle:ai-gate";
export function notifyAiGate(reason: AiGateReason): void {
  window.dispatchEvent(new CustomEvent(AI_GATE_EVENT, { detail: { reason } }));
}

export interface AiWalletSummary {
  /** saldo dalam TOKEN (tampilan utama) */
  balanceTokens: number;
  rupiahPer1kTokens: number;
  minReserveTokens: number;
  markup: number;
  usdIdr: number;
  tokens30d: number;
  spentTokens30d: number;
  calls30d: number;
  /** paket top up token dari Admin Platform */
  topupPackages: AiTopupPackage[];
  /** status akses AI: langganan/demo/token */
  access?: {
    reason: AiGateReason | "ok";
    subscriptionActive: boolean;
    trialActive: boolean;
    trialEndsAt: string | null;
    balance: number;
    minReserve: number;
  };
  /** internal rupiah */
  balance: number;
  spent30d: number;
  cost30d: number;
  minReserve: number;
}
export interface AiLedgerRow {
  id: string;
  kind: string;
  /** jumlah token (pemakaian = token nyata, topup/bonus = konversi rupiah) */
  tokens?: number;
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
  tokens?: number;
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

export interface AiSubscriptionPayload {
  plans: AiSubPlan[];
  wallet: AiWalletSummary;
  access: {
    reason: "ok" | "subscription" | "token";
    subscriptionActive: boolean;
    trialActive: boolean;
    trialEndsAt: string | null;
    balance: number;
    minReserve: number;
  };
  subscription: { plan: string; status: string; expiresAt: string | null; active: boolean } | null;
}
export interface AiSubscriptionResult {
  orderId: string;
  amount: number;
  plan: AiSubPlan;
  months: number;
  tokens: number;
  qris: { qrUrl: string; qrContent: string; referenceNo?: string; expiredAt: string };
}
export const getAiSubscription = () => adminFetch<AiSubscriptionPayload>("/api/ai/subscription");
export const postAiSubscription = (planId: string) =>
  adminFetch<AiSubscriptionResult>("/api/ai/subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planId }),
  });
export const getBillingPayment = (orderId: string) =>
  adminFetch<{ orderId: string; amount: number; status: string; settled: boolean }>(
    `/api/billing/payment/${orderId}`
  );

export const getAiWallet = () => adminFetch<AiWalletSummary>("/api/ai/wallet");
export const getAiLedger = (take = 10, skip = 0) =>
  adminFetch<AiLedgerRow[]>(`/api/ai/ledger?take=${take}&skip=${skip}`);
export const postAiTopup = (packageId: string) =>
  adminFetch<AiTopupResponse>("/api/ai/topup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packageId }),
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
