import type { ToolSpec } from "./types.js";
import { ACCURATE_MODULES, type ActionEntry } from "./accurate-paths.js";

const listProps = {
  fields: { type: "string", description: "Field yang ditampilkan, dipisah koma (contoh: id,name)" },
  keywords: { type: "string", description: "Kata kunci pencarian" },
  page: { type: "number", description: "Nomor halaman (default 1)" },
  pageSize: { type: "number", description: "Ukuran halaman (default 20)" },
  sort: { type: "string", description: 'Urutan data — hanya "id|asc" atau "id|desc" yang didukung (id lebih besar = lebih baru)' },
  filter: {
    type: "object",
    description: 'Filter per field: { "<field>": { "op": "EQUAL|CONTAIN|…", "value": … } }',
    additionalProperties: true,
  },
} as const;

const labelModul = (mod: string) => mod.replace(/[-/]/g, " ");

const str = (description: string): { type: string; description: string } => ({ type: "string", description });

/**
 * Skema param EXACT utk tool read yang bukan `list`/`detail` — dikumpulkan dari OpenAPI Accurate.
 *
 * Tanpa entri ini SEMUA aksi read selain `detail` jatuh ke `listProps` (fields/keywords/page/…),
 * sehingga model mengirim argumen gaya daftar ke tool yg butuh field wajib lain. Provider lalu
 * menolak "… harus diisi" dan satu putaran LLM (~15-20 dtk) terbuang percuma. Contoh nyata:
 * - salesInvoice.detail-invoice      → butuh customerNo (kita kirim fields/pageSize/sort)
 * - glaccount.get-pl-account-amount  → butuh fromDate+toDate (kita kirim pageSize/sort)
 */
const READ_PARAM_SCHEMA: Record<
  string,
  { properties: Record<string, unknown>; required?: string[]; description?: string }
> = {
  "currency.exchange-rate": {
    description: "Kurs mata uang berdasarkan kode — wajib isi code (cth: USD)",
    properties: { code: str("Kode mata uang (cth: USD)"), id: { type: "number", description: "ID record mata uang" } },
    required: ["code"],
  },
  "glaccount.get-balance": {
    description: "Saldo akun per tanggal — wajib isi no (kode perkiraan)",
    properties: {
      no: str("Kode perkiraan / nomor akun (cth: 1101)"),
      asOfDate: str("Saldo per tanggal (dd/mm/yyyy)"),
      fromDate: str("Dari tanggal (dd/mm/yyyy)"),
      toDate: str("S/d tanggal (dd/mm/yyyy)"),
      branchName: str("Nama cabang"),
      departmentName: str("Nama departemen"),
      projectNo: str("Nomor proyek"),
    },
    required: ["no"],
  },
  "glaccount.get-bs-account-amount": {
    description: "Posisi neraca per tanggal — wajib isi asOfDate",
    properties: { asOfDate: str("Data per tanggal (dd/mm/yyyy, cth: 31/03/2016)") },
    required: ["asOfDate"],
  },
  "glaccount.get-pl-account-amount": {
    description: "Laba rugi (pendapatan & beban) pada rentang tanggal — wajib isi fromDate DAN toDate",
    properties: { fromDate: str("Tanggal mulai (dd/mm/yyyy)"), toDate: str("Tanggal akhir (dd/mm/yyyy)") },
    required: ["fromDate", "toDate"],
  },
  "item.get-nearest-cost": {
    description: "Harga pokok terakhir barang — wajib isi itemNo",
    properties: { itemNo: str("Nomor/kode barang"), transDate: str("Tanggal transaksi (dd/mm/yyyy)") },
    required: ["itemNo"],
  },
  "item.get-selling-price": {
    description: "Harga jual barang — wajib isi no (kode barang)",
    properties: {
      no: str("Nomor/kode barang"),
      priceCategoryName: str("Kategori penjualan"),
      discountCategoryName: str("Kategori diskon"),
      currencyCode: str("Kode mata uang (cth: IDR)"),
      effectiveDate: str("Tanggal berlaku (dd/mm/yyyy)"),
      branchName: str("Nama cabang"),
      upcNo: str("UPC/barcode barang"),
    },
    required: ["no"],
  },
  "item.get-stock": {
    description: "Stok barang — wajib isi no (kode barang); kosongkan warehouseName utk total semua gudang",
    properties: {
      no: str("Nomor/kode barang"),
      warehouseName: str("Nama gudang — kosongkan utk total seluruh gudang"),
    },
    required: ["no"],
  },
  "item.list-stock": {
    description: "Daftar saldo stok — mendukung filter tanggal & gudang (bukan filter fields/keywords)",
    properties: {
      ...listProps,
      asOfDate: str("Tanggal saldo awal (dd/mm/yyyy)"),
      warehouseName: str("Nama gudang"),
      warehouseId: { type: "number", description: "ID gudang" },
    },
  },
  "salesInvoice.detail-invoice": {
    description: "Faktur penjualan per pelanggan — wajib isi customerNo",
    properties: {
      customerNo: str("ID/nomor pelanggan"),
      fromDate: str("Dari tanggal (dd/mm/yyyy)"),
      toDate: str("Hingga tanggal (dd/mm/yyyy)"),
      itemNo: str("Nomor/kode barang"),
      salesmanName: str("Nama penjual"),
      serialNumber: str("Nomor seri/produksi"),
    },
    required: ["customerNo"],
  },
};

/**
 * Modul (kunci manifest, kebab-case) → nama param alternatif utk `detail.do`.
 * Diambil dari OpenAPI: 49 dari 62 endpoint detail menerima kunci alternatif
 * ("… ini adalah alternatif dari parameter id data"). Tanpa ini model yang hanya
 * punya KODE (user menulis "detail faktur INV-2050") terpaksa mengarang `id`
 * numerik → provider menolak. `id` sendiri bertipe integer, BUKAN string.
 */
const DETAIL_ALT: Record<string, string> = {
  "bank-transfer": "number",
  "bill-of-material": "number",
  branch: "branchName",
  customer: "customerNo",
  "customer-claim": "number",
  "delivery-order": "number",
  department: "departmentName",
  employee: "number",
  "exchange-invoice": "number",
  expense: "number",
  "finished-good-slip": "number",
  "fixed-asset": "number",
  glaccount: "no",
  item: "no",
  "item-adjustment": "number",
  "item-transfer": "number",
  "job-order": "number",
  "journal-voucher": "number",
  "manufacture-order": "number",
  "material-adjustment": "number",
  "material-slip": "number",
  "other-deposit": "number",
  "other-payment": "number",
  "process-stages": "number",
  project: "projectNo",
  "purchase-invoice": "number",
  "purchase-order": "number",
  "purchase-payment": "number",
  "purchase-requisition": "number",
  "purchase-return": "number",
  "receive-item": "number",
  "roll-over": "number",
  "sales-invoice": "number",
  "sales-order": "number",
  "sales-quotation": "number",
  "sales-receipt": "number",
  "sales-return": "number",
  "sellingprice-adjustment": "number",
  shipment: "shipmentName",
  "standard-product-cost": "number",
  "stock-opname-order": "number",
  "stock-opname-result": "number",
  unit: "unitName",
  vendor: "vendorNo",
  "vendor-category": "name",
  "vendor-claim": "number",
  "vendor-price": "number",
  warehouse: "warehouseName",
  "work-order": "number",
};

/** endpoint `detail.do` yg TIDAK punya param `id` sama sekali → pakai param gaya daftar */
const DETAIL_NO_ID = new Set(["sales-checkin"]);

/**
 * Penjelasan isi tiap kunci alternatif — nilai yang diharapkan diambil dari kolom
 * yang SAMA pada hasil daftar (diverifikasi langsung ke API Accurate 2026-10-17).
 * Dulu model mengirim id (106) ke customerNo → "Pelanggan tidak tepat".
 */
const ALT_DESC: Record<string, string> = {
  number: "kolom `number` hasil daftar (transaksi: SI.2017.02.00010, SO.…, PI.…)",
  customerNo: "kolom `customerNo` hasil daftar (cth: CSBY-0005)",
  vendorNo: "kolom `vendorNo` hasil daftar (cth: VJKT-0003)",
  no: "kolom `no` hasil daftar (akun: 111.000-00, barang: 9900012)",
  name: "kolom `name` hasil daftar, ejaan persis",
  branchName: "kolom `name` daftar cabang",
  departmentName: "kolom `name` daftar departemen",
  projectNo: "nomor proyek daftar proyek",
  shipmentName: "kolom `name` daftar pengiriman",
  unitName: "kolom `name` daftar satuan",
  warehouseName: "kolom `name` daftar gudang",
};

/** nama modul (prefix tool, camelCase) → istilah Indonesia utk nama proses */
const MODULE_ID: Record<string, string> = {
  customer: "pelanggan",
  customerCategory: "kategori pelanggan",
  customerClaim: "klaim pelanggan",
  vendor: "pemasok",
  vendorCategory: "kategori pemasok",
  vendorClaim: "klaim pemasok",
  vendorPrice: "harga pemasok",
  item: "barang",
  itemBrand: "merek barang",
  itemCategory: "kategori barang",
  itemAdjustment: "penyesuaian barang",
  itemTransfer: "transfer barang",
  unit: "satuan",
  salesInvoice: "faktur penjualan",
  salesOrder: "pesanan penjualan",
  salesQuotation: "penawaran",
  salesReceipt: "penerimaan penjualan",
  salesReturn: "retur penjualan",
  salesCheckin: "check-in penjualan",
  salesmanCommission: "komisi salesman",
  deliveryOrder: "surat jalan",
  shipment: "pengiriman",
  purchaseInvoice: "faktur pembelian",
  purchaseOrder: "pesanan pembelian",
  purchaseReturn: "retur pembelian",
  purchasePayment: "pembayaran pemasok",
  purchaseRequisition: "permintaan pembelian",
  purchaseQuotation: "penawaran pembelian",
  receiveItem: "penerimaan barang",
  payment: "pembayaran",
  otherPayment: "pembayaran lain",
  otherDeposit: "setoran lain",
  bankTransfer: "transfer bank",
  glaccount: "akun umum",
  report: "laporan",
  journalVoucher: "buku jurnal",
  currency: "mata uang",
  exchangeInvoice: "faktur valas",
  tax: "pajak",
  employee: "karyawan",
  department: "departemen",
  branch: "cabang",
  project: "proyek",
  warehouse: "gudang",
  stock: "stok",
  stockOpnameOrder: "perintah stok opname",
  stockOpnameResult: "hasil stok opname",
  fixedAsset: "aset tetap",
  expense: "pengeluaran",
  workOrder: "perintah kerja",
  manufactureOrder: "perintah produksi",
  billOfMaterial: "daftar material",
  jobOrder: "job order",
  priceCategory: "kategori harga",
  sellingpriceAdjustment: "penyesuaian harga jual",
  paymentTerm: "termin pembayaran",
  autoNumber: "nomor otomatis",
  dataClassification: "klasifikasi data",
  accessPrivilege: "hak akses",
  accountBudgetTarget: "target anggaran akun",
  salesman: "salesman",
  pos: "transaksi POS",
  posCustomer: "pelanggan POS",
  posItem: "barang POS",
  posTransaction: "transaksi POS",
};

const humanize = (s: string) => s.replace(/[-/]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

/** nama proses (Bahasa Indonesia) dari tool — tampil di UI saat AI bekerja */
const processName = (mod: string, action: string, tool: string): string => {
  const prefix = tool.split(".")[0];
  const m = MODULE_ID[prefix] ?? humanize(prefix);
  if (action === "list") return `Mengambil data ${m}`;
  if (action.startsWith("list")) return `Mengambil daftar ${m}`;
  if (action.startsWith("detail")) return `Membuka detail ${m}`;
  if (action.startsWith("search")) return `Mencari ${m}`;
  if (action.includes("save") || action.startsWith("create")) return `Menyimpan ${m}`;
  if (action === "delete") return `Menghapus ${m}`;
  if (action === "get-balance") return "Menghitung saldo akun";
  if (action === "get-pl-account-amount") return "Menghitung laba rugi";
  if (action === "get-bs-account-amount") return "Menghitung neraca";
  if (action === "exchange-rate" || action === "fiscal-rate") return "Mengambil kurs mata uang";
  if (action === "get-stock" || action === "list-stock" || action === "stock-mutation-history") return `Mengecek stok ${m}`;
  if (action === "get-selling-price" || action === "get-nearest-cost") return `Mengecek harga ${m}`;
  if (action === "mutation") return `Mutasi ${m}`;
  if (action === "get-history") return `Riwayat ${m}`;
  if (action === "manual-close-order") return `Menutup ${m}`;
  if (action === "stock-in") return `Stok masuk ${m}`;
  if (action === "stock-out") return `Stok keluar ${m}`;
  if (action.includes("serial-number")) return `Riwayat serial ${m}`;
  return `${humanize(action)} ${m}`;
};

interface DetailSchema {
  jsonSchema: Record<string, unknown>;
  /** minimal salah satu field ini wajib terisi (di-cek di tool-loop sebelum eksekusi) */
  oneOfRequired?: string[];
}

/**
 * Skema utk `detail`:
 * - `id` bertipe INTEGER (OpenAPI: "Identitas unik dari sebuah record data") — sebelumnya
 *   `string`, model mengirim kode ("USD") → provider menolak "Invalid field value for id".
 * - 49/62 modul punya kunci alternatif (customerNo/no/number/…) → keduanya ditawarkan,
 *   lalu divalidasi `oneOfRequired` supaya panggilan kosong tidak membuang satu putaran LLM.
 */
const detailSchema = (mod: string): DetailSchema => {
  if (DETAIL_NO_ID.has(mod)) return { jsonSchema: { type: "object", properties: { ...listProps } } };
  const props: Record<string, unknown> = {
    id: { type: "number", description: 'ID numerik record — nilai kolom "id" hasil daftar (angka, bukan kode/nama)' },
  };
  const alt = DETAIL_ALT[mod];
  if (alt) {
    props[alt] = {
      type: "string",
      description: `Alternatif dari id: ${ALT_DESC[alt] ?? alt} — isi id ATAU ${alt}`,
    };
    return { jsonSchema: { type: "object", properties: props }, oneOfRequired: ["id", alt] };
  }
  return { jsonSchema: { type: "object", properties: props, required: ["id"] } };
};

/** Skema utk aksi read: skema khusus bila ada → `detail` → {id} → fallback listProps */
const readSchema = (mod: string, a: ActionEntry): Record<string, unknown> => {
  const custom = READ_PARAM_SCHEMA[a.tool];
  if (custom) {
    return {
      type: "object",
      properties: custom.properties,
      ...(custom.required ? { required: custom.required } : {}),
    };
  }
  if (a.action === "detail") return detailSchema(mod).jsonSchema;
  return { type: "object", properties: { ...listProps } };
};

const spec = (mod: string, a: ActionEntry): ToolSpec => {
  const isRead = a.method === "GET";
  const custom = READ_PARAM_SCHEMA[a.tool];
  const detail = isRead && a.action === "detail" && !custom ? detailSchema(mod) : null;
  const verb =
    a.action === "list" ? "Daftar" : a.action === "detail" ? "Detail" : a.action.replace(/-/g, " ");
  return {
    name: a.tool,
    description:
      custom?.description ??
      `${verb} ${labelModul(mod)}${isRead ? "" : ` (${a.method.toLowerCase()} ${a.action})`}`,
    jsonSchema: detail ? detail.jsonSchema : isRead
      ? readSchema(mod, a)
      : a.action === "delete"
        ? { type: "object", properties: { id: { type: "number", description: "ID numerik record" } }, required: ["id"] }
        : { type: "object", properties: {}, additionalProperties: true },
    requiredPermission: a.permission,
    label: `${processName(mod, a.action, a.tool)}…`,
    // path tak ada di API Accurate asli (hanya di dokumentasi) → jangan dikirim ke AI
    ...(a.docsOnly === true ? { unavailable: true } : {}),
    ...(detail?.oneOfRequired ? { oneOfRequired: detail.oneOfRequired } : {}),
  };
};

export const ACCURATE_CATALOG: ToolSpec[] = Object.entries(ACCURATE_MODULES)
  .flatMap(([mod, acts]) => acts.map((a) => spec(mod, a)))
  .sort((x, y) => x.name.localeCompare(y.name));
