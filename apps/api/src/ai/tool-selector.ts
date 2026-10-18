import type { ToolSpec } from "../providers/accounting/types.js";
import { ACCURATE_CATALOG } from "../providers/accounting/catalog.js";
import { AGGREGATION_TOOLS } from "../providers/accounting/aggregation.js";

/**
 * Dynamic tool selection — kirim hanya tool yang relevan dgn pertanyaan user.
 * Tanpa filter: 366 tools ≈ 28.500 tokens per request (99% input).
 * Dengan filter: ~20-60 tools ≈ 1.500-4.500 tokens.
 */

/** keyword → prefix modul Accurate (match awalan tool name) */
const KEYWORD_MAP: Array<{ keywords: RegExp; modules: string[] }> = [
  // pelanggan
  { keywords: /pelanggan|customer|piutang|kredit\s*customer/i, modules: ["customer"] },
  // pemasok / vendor
  { keywords: /pemasok|vendor|supplier|utang\s*(pemasok|vendor)/i, modules: ["vendor"] },
  // barang / item / stok
  { keywords: /barang|item|produk|stok|stock|persediaan|gudang|warehouse|harga\s*jual|harga\s*beli|satuan|kategori\s*barang/i, modules: ["item", "itemCategory", "stock", "warehouse", "sellingprice", "unit", "itemCategory"] },
  // penjualan
  { keywords: /penjualan|sales|jual|faktur\s*penjualan|invoice\s*penjualan|surat\s*jalan|pesanan\s*penjualan|quotation|penawaran|retur\s*penjualan/i, modules: ["salesInvoice", "salesOrder", "salesQuotation", "salesReturn", "salesReceipt", "deliveryOrder", "shipment"] },
  // pembelian
  { keywords: /pembelian|purchase|beli|faktur\s*pembelian|pesanan\s*pembelian|retur\s*pembelian|pemasok/i, modules: ["purchaseInvoice", "purchaseOrder", "purchaseReturn", "receive"] },
  // pembayaran / kas / bank
  { keywords: /pembayaran|payment|bayar|kas|bank|transfer|tunai|cek|giro/i, modules: ["payment", "bankTransfer", "salesReceipt"] },
  // laporan / laba rugi / neraca
  { keywords: /laporan|report|laba|rugi|neraca|balance|keuangan|omzet|revenue|pendapatan|beban|biaya/i, modules: ["report", "glaccount"] },
  // akun gl / saldo
  { keywords: /saldo|akun|account|gl|buku\s*besar|journal|jurnal/i, modules: ["glaccount", "journalVoucher"] },
  // pajak
  { keywords: /pajak|tax|ppn|ppt|vat/i, modules: ["tax"] },
  // employee / salesman
  { keywords: /karyawan|employee|salesman|sales\s*man|komisi/i, modules: ["employee", "salesman"] },
  // proyek
  { keywords: /proyek|project|job|kerja/i, modules: ["project", "jobOrder"] },
  // manufacture / produksi
  { keywords: /produksi|manufacture|bom|rakitan|work\s*order|pekerjaan/i, modules: ["manufacture", "bom", "workOrder"] },
  // currency / mata uang
  { keywords: /mata\s*uang|currency|kurs|exchange|valas/i, modules: ["currency", "exchangeInvoice"] },
  // expense
  { keywords: /biaya|expense|pengeluaran|operasional/i, modules: ["expense"] },
  // fixed asset
  { keywords: /aset|asset|tetap|depreciation|penyusutan/i, modules: ["fixedAsset"] },
  // department / cabang
  { keywords: /departemen|department|cabang|branch|divisi/i, modules: ["department", "branch"] },
];

/** tool yang selalu disertakan (inti akuntansi, jarang salah) */
const CORE_TOOLS = [
  "glaccount.list",
  "glaccount.detail",
  "glaccount.get-balance",
  "glaccount.get-pl-account-amount",
  "glaccount.get-bs-account-amount",
  "customer.list",
  "customer.detail",
  "vendor.list",
  "item.list",
  "item.detail",
  "salesInvoice.list",
  "salesInvoice.detail",
  "purchaseInvoice.list",
  "purchaseOrder.list",
  "salesOrder.list",
  "salesOrder.detail",
  "salesReceipt.list",
  "payment.list",
  "bankTransfer.list",
  // tool agregasi — selalu tersedia supaya model memilih SATU tool alih-alih pecah jadi 3
  "customer.lastOrderByName",
  "customer.unpaidByName",
  "customer.summaryByName",
  "salesInvoice.summary",
  "purchaseInvoice.summary",
  "vendor.lastPurchaseByName",
  "vendor.unpaidByName",
  "vendor.summaryByName",
  "salesInvoice.perCustomer",
  "item.topSelling",
  "receivables.summary",
  "payables.summary",
  "gl.plSummary",
  "gl.bsSummary",
];

/** action yang boleh dikirim (read-only + aman) — create/save/delete disembunyikan dari AI */
const READ_ACTIONS = /\.(list|detail|get-|exchange-rate|get-pl|get-bs|get-balance|get-history)/;

/**
 * Pilih tool relevan berdasarkan pesan user.
 * - Deteksi keyword → load tool modul terkait
 * - Selalu sertakan core tools
 * - Fallback: jika tak ada match, kirim core + top list tools
 */
export function selectTools(userMessage: string, allTools: ToolSpec[] = ACCURATE_CATALOG): ToolSpec[] {
  const msg = userMessage.toLowerCase();
  const matchedModules = new Set<string>();

  // tool dgn path tak ada di API Accurate asli (docsOnly) dijamin selalu gagal →
  // buang di sini agar tak memakan slot & satu putaran LLM percuma
  const usable = allTools.filter((t) => !t.unavailable);

  for (const { keywords, modules } of KEYWORD_MAP) {
    if (keywords.test(msg)) {
      for (const m of modules) matchedModules.add(m);
    }
  }

  // filter tools: (modul terdeteksi ATAU core) DAN action read-only
  const selected = usable.filter((t) => {
    // tool agregasi selalu dikirim (satu tool pemangkas putaran, bukan pecahan)
    if (AGGREGATION_TOOLS.some((a) => a.name === t.name)) return true;
    if (!READ_ACTIONS.test(t.name)) return false;
    if (CORE_TOOLS.includes(t.name)) return true;
    if (matchedModules.size === 0) return false;
    // cocokkan awalan tool name dengan modul (case-insensitive)
    const toolPrefix = t.name.split(".")[0];
    for (const mod of matchedModules) {
      if (toolPrefix.toLowerCase() === mod.toLowerCase()) return true;
      // prefix ganda: stockOpnameOrder → stock, itemCategory → item
      if (toolPrefix.toLowerCase().startsWith(mod.toLowerCase())) return true;
    }
    return false;
  });

  // fallback: tak ada match → core tools saja (+ beberapa list umum)
  if (selected.length === 0 || matchedModules.size === 0) {
    // tool agregasi IKUT dibawa di fallback — komentar "selalu dikirim" (baris atas)
    // harus berlaku juga tanpa keyword modul (dulu regex READ_ACTIONS membuang
    // "*.summary"/"*.perCustomer" → putaran LLM terbuang percuma)
    return usable.filter(
      (t) =>
        (CORE_TOOLS.includes(t.name) && READ_ACTIONS.test(t.name)) ||
        AGGREGATION_TOOLS.some((a) => a.name === t.name)
    );
  }

  return selected;
}

/** Statistik untuk logging/debug */
export function toolStats(selected: ToolSpec[]): { count: number; approxTokens: number } {
  const json = JSON.stringify(selected.map((t) => ({ name: t.name, description: t.description, parameters: t.jsonSchema })));
  return { count: selected.length, approxTokens: Math.ceil(json.length / 4) };
}
