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
  createSalesOrder(ctx: ProviderCtx, data: SalesOrderInput): Promise<SavedDoc>;
  closeSalesOrder(ctx: ProviderCtx, data: { number: string }): Promise<void>;
  createSalesInvoice(ctx: ProviderCtx, data: SalesInvoiceInput): Promise<SavedDoc>;
  createSalesReceipt(ctx: ProviderCtx, data: SalesReceiptInput): Promise<SavedDoc>;
  createPurchaseInvoice(ctx: ProviderCtx, data: PurchaseInvoiceInput): Promise<SavedDoc>;
  createExpense(ctx: ProviderCtx, data: ExpenseInput): Promise<SavedDoc>;
  createBankTransfer(ctx: ProviderCtx, data: BankTransferInput): Promise<SavedDoc>;
  /** cari pelanggan Accurate by nama/nomor HP; buat baru bila `createName` diisi */
  findOrCreateCustomer(ctx: ProviderCtx, data: CustomerLookupInput): Promise<CustomerRef | null>;
  listCustomers(ctx: ProviderCtx, opts: { keywords?: string; limit?: number }): Promise<CustomerRef[]>;
  refreshToken(refreshToken: string): Promise<ProviderTokenSet>;
  privilegeCatalog(ctx: ProviderCtx): Promise<PrivilegeGroup[]>;
}
/** hasil save dokumen Accurate — nomor dokumen bisa berbeda dari id internal */
export interface SavedDoc {
  id: string;
  number: string;
  /** total dokumen bila terbaca (dipakai utk mencocokkan penerimaan kas) */
  total?: number;
}
export interface SalesOrderInput {
  /** customerNo hasil pencarian/pembuatan pelanggan Accurate */
  customerNo: string;
  date?: string;
  no?: string;
  description?: string;
  items: Array<{ itemNo: string; qty: number; price: number }>;
  taxable?: boolean;
}
export interface CustomerRef {
  customerNo: string;
  name: string;
  mobilePhone?: string;
}
export interface CustomerLookupInput {
  /** nama/nomor pembeli dari pesanan WhatsApp */
  name?: string;
  phone?: string;
  /** nama utk dibuat bila pelanggan belum ada (bila kosong → tidak membuat) */
  createName?: string;
  categoryName?: string;
  description?: string;
}
export interface SalesInvoiceInput {
  customerName: string;
  date?: string;
  no?: string;
  total?: number;
  description?: string;
  items?: ScannedLineItem[];
  /** biaya tambahan yang ikut ditagihkan (mis. ongkos kirim) */
  shipping?: { amount: number; name?: string; accountNo?: string };
}
export interface SalesReceiptInput {
  customerName: string;
  date?: string;
  no?: string;
  amount?: number;
  description?: string;
  /** nomor faktur penjualan yang dibayar (wajib untuk sales-receipt) */
  invoiceNo?: string;
  /** rekening kas/bank penerimaan; kosong = pilih otomatis rekening rupiah pertama */
  bankNo?: string;
}
export interface ScannedLineItem {
  name: string;
  qty?: number;
  price?: number;
  /** kode barang Accurate bila sudah diketahui (lebih akurat daripada nama) */
  itemNo?: string;
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
  /** akun beban (daun) pilihan user; kosong = pilih otomatis dari deskripsi */
  accountNo?: string;
}
export interface BankTransferInput {
  date?: string;
  total?: number;
  description?: string;
  fromBankNo?: string;
  toBankNo?: string;
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
