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

const spec = (mod: string, a: ActionEntry): ToolSpec => {
  const isRead = a.method === "GET";
  const verb =
    a.action === "list" ? "Daftar" : a.action === "detail" ? "Detail" : a.action.replace(/-/g, " ");
  return {
    name: a.tool,
    description: `${verb} ${labelModul(mod)}${isRead ? "" : ` (${a.method.toLowerCase()} ${a.action})`}`,
    jsonSchema: isRead
      ? a.action === "detail"
        ? { type: "object", properties: { id: { type: "string" } }, required: ["id"] }
        : { type: "object", properties: listProps }
      : a.action === "delete"
        ? { type: "object", properties: { id: { type: "string" } }, required: ["id"] }
        : { type: "object", properties: {}, additionalProperties: true },
    requiredPermission: a.permission,
    label: `${processName(mod, a.action, a.tool)}…`,
  };
};

export const ACCURATE_CATALOG: ToolSpec[] = Object.entries(ACCURATE_MODULES)
  .flatMap(([mod, acts]) => acts.map((a) => spec(mod, a)))
  .sort((x, y) => x.name.localeCompare(y.name));
