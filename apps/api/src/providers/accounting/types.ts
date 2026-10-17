export interface ProviderTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}
export interface ProviderUser {
  providerUserId: string;
  email: string;
  name: string;
  phone?: string;
}
export interface ProviderDb {
  providerDbId: string;
  alias: string;
  name: string;
  admin: boolean;
}
export interface OpenDbResult {
  session: string;
  host: string;
}
export interface AccountingProvider {
  id: "accurate";
  authorizeUrl(opts: { redirectUri: string; state: string }): string;
  exchangeCode(code: string, redirectUri: string): Promise<ProviderTokenSet>;
  fetchUser(accessToken: string): Promise<ProviderUser>;
  listDbs(accessToken: string): Promise<ProviderDb[]>;
  openDb(accessToken: string, providerDbId: string): Promise<OpenDbResult>;
  capabilityCatalog(): ToolSpec[];
  execute(tool: string, args: Record<string, unknown>, ctx: ProviderCtx): Promise<unknown>;
  createSalesInvoice(ctx: ProviderCtx, data: SalesInvoiceInput): Promise<{ id: string }>;
  createSalesReceipt(ctx: ProviderCtx, data: SalesReceiptInput): Promise<{ id: string }>;
  createPurchaseInvoice(ctx: ProviderCtx, data: PurchaseInvoiceInput): Promise<{ id: string }>;
  createExpense(ctx: ProviderCtx, data: ExpenseInput): Promise<{ id: string }>;
  createBankTransfer(ctx: ProviderCtx, data: BankTransferInput): Promise<{ id: string }>;
  refreshToken(refreshToken: string): Promise<ProviderTokenSet>;
  privilegeCatalog(ctx: ProviderCtx): Promise<PrivilegeGroup[]>;
}
export interface SalesInvoiceInput {
  customerName: string;
  date?: string;
  no?: string;
  total?: number;
  description?: string;
}
export interface SalesReceiptInput {
  customerName: string;
  date?: string;
  no?: string;
  amount?: number;
  description?: string;
}
export interface ScannedLineItem {
  name: string;
  qty?: number;
  price?: number;
}
export interface PurchaseInvoiceInput {
  vendorName: string;
  date?: string;
  no?: string;
  total?: number;
  description?: string;
  items?: ScannedLineItem[];
}
export interface ExpenseInput {
  date?: string;
  total?: number;
  description?: string;
}
export interface BankTransferInput {
  date?: string;
  total?: number;
  description?: string;
}
export interface ToolSpec {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  requiredPermission: string;
  label: string;
  /**
   * Path aksi tidak ada di API Accurate asli (hanya ada di dokumentasi → respons HTML SPA).
   * Tetap dicatat di katalog (cakupan penuh utk UI/permission), TAPI tidak boleh
   * dikirim ke AI karena dijamin selalu gagal dan membuang satu putaran LLM.
   */
  unavailable?: boolean;
  /**
   * Minimal SATU dari field ini wajib terisi (skema `required` tidak bisa menyatakan
   * "salah satu" — Accurate menerima id ATAU kunci alternatif, mis. customer/detail:
   * `id` (integer) ATAU `customerNo`). Divalidasi di tool-loop sebelum eksekusi supaya
   * panggilan kosong tidak menghabiskan satu putaran LLM (~15-20 dtk).
   */
  oneOfRequired?: string[];
}
export interface ProviderCtx {
  tenantId: string;
  host: string;
  session: string;
  accessToken: string;
}
export interface PrivilegeGroup {
  id: string;
  name: string;
  allowViewModules: string[];
}
