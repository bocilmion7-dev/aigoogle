import type { LLMClient } from "./llm-client.js";
import type { LLMContent } from "./llm-types.js";
import { AGGREGATION_TOOLS } from "../providers/accounting/aggregation.js";


/**
 * Transformer: router ringan → agregasi adapter.
 *
 * Alih-alih kirim 38 tool (~6rb token) ke LLM penuh (2+ putaran), cukup:
 *   1. Router call kecil (~1rb token, non-streaming, JSON output) → pilih 1 tool + args
 *   2. Eksekusi tool via adapter Accurate (sudah ada)
 *   3. Format hasil ke teks natural (template, 0 token LLM)
 *
 * Bila router gagal / ragu / tool tak dikenal → kembalikan null
 * (caller jatuh ke runToolLoop penuh — aman, inkremental).
 */

export interface Route {
  tool: string;
  args: Record<string, unknown>;
}

/** katalog ringkas utk prompt router: nama + tujuan 1 kalimat + argumen */
const ROUTER_CATALOG = AGGREGATION_TOOLS.map((t) => {
  const schema = t.jsonSchema as { properties?: Record<string, unknown>; required?: string[] };
  const props = Object.keys(schema.properties ?? {});
  const required = schema.required ?? [];
  const argStr = props.map((p) => (required.includes(p) ? p : `${p}?`)).join(", ");
  const purpose = t.description.split(".")[0];
  return `- ${t.name}(${argStr}): ${purpose}`;
}).join("\n");

const ROUTER_SYSTEM =
  "Anda adalah router akuntansi. Tugas: pilih SATU tool dari daftar berdasarkan pesan user (dan riwayat bila ada), lalu ekstrak argumennya.\n\n" +
  "Aturan:\n" +
  '- Balas HANYA JSON: {"tool":"<nama>","args":{...}} atau {"tool":null} bila tak ada tool yang cocok.\n' +
  "- SOAL MAJEMUK/PERBANDINGAN = lebih dari satu fakta berbeda yang butuh tool berbeda/berulang → " +
  '{"tool":null}. Contoh wajib null: "Ringkas semua: siapa pelanggan terbesar dan berapa laba bersih" (2 tool beda), ' +
  '"Berapa laba bersih dan siapa pemasok terbesar".\n' +
  "- PENGECUALIAN — soal majemuk/dua periode berikut TETAP punya tool tunggal (JANGAN null): " +
  '"total penjualan DAN total pembelian [periode]" → salePurchase.summaryBoth; ' +
  '"piutang DAN utang [tahun/periode]" → arap.summary (isi fromDate & toDate dd/mm/yyyy); ' +
  '"piutang dari transaksi tahun X dan tahun Y" → receivables.summary (years:[X,Y]); ' +
  '"siapa pelanggan penjualan terbesar tahun X dan tahun Y" / pemasok → party.topByYears (side, years:[X,Y]); ' +
  '"barang terlaris tahun X dan tahun Y" → item.topSelling (years:[X,Y]); ' +
  '"barang terlaris/terjual tahun X / bulan X" (satu periode) → item.topSelling (fromDate 01/01/X & toDate 31/12/X) — default TANPA tanggal = bulan berjalan, JANGAN kosongkan tanggal utk periode tertentu; ' +
  '"barang paling banyak terjual sepanjang masa / selama ini / terlaris (tanpa periode)" → item.topSelling DGN fromDate 01/01/1950 & toDate 31/12/2100 — WAJIB kirim keduanya (tanpa tanggal = hanya bulan berjalan → hasil kosong); ' +
  '"berapa A dan B" utk modul daftar (surat pesanan penjualan DAN pembelian, akun+gudang+satuan, pelanggan vs pemasok) ' +
  '→ module.recordCount (modules:[A,B]).\n' +
  '- Pertanyaan RANKING (terbesar/terbanyak/kedua/urutkan): penjualan/pemesanan → salesInvoice.perCustomer (tanpa tanggal bila "sepanjang masa"); piutang → receivables.summary; utang → payables.summary; pembelian/pemasok → purchaseInvoice.perVendor. "Faktur penjualan terbesar pada tahun X" → salesInvoice.summary dgn tanggal; "faktur pembelian terbesar pada tahun X" → purchaseInvoice.summary dgn tanggal (ringkasan memuat faktur terbesar). ' +
  '"faktur mana yang jatuh temponya paling dekat / jatuh tempo terdekat (di antara yang belum lunas)" → receivables.summary (hasil memuat field earliestDue) — BUKAN salesInvoice.list. ' +
  '"total piutang usaha dari transaksi tahun/bulan X" → receivables.summary DENGAN fromDate&toDate periode itu; "total utang usaha dari transaksi tahun/bulan X" → payables.summary DENGAN tanggal — TANPA tanggal hasilnya seluruh periode (angka meleset).\n' +
  '- "berapa total penjualan bulan X, ada berapa faktur, dan siapa pelanggan terbesarnya" (ringkasan majemuk penjualan) → ' +
  'salesInvoice.summary(fromDate, toDate) — SUDAH memuat total, jumlah faktur, dan pelanggan terbesar dalam SATU hasil; ' +
  'pembelian sebaliknya → purchaseInvoice.summary. JANGAN {"tool":null} utk pertanyaan ringkasan 1-periode ini.\n' +
  '- "kapan faktur pertama/paling awal pelanggan X" → customer.salesByName(name) (daftar semua faktur — ambil tanggal terkecil) — BUKAN customer.summaryByName (itu hanya memuat pesanan TERAKHIR).\n' +
  '- "siapa pembeli / pernah membeli barang X / pelanggan pembeli X" → item.buyers(name, fromDate?, toDate?).\n' +
  '- "berapa nilai penjualan total barang X" / "berapa total penjualan barang X" / "berapa unit X yang terjual" / "berapa uang dari penjualan barang X" → item.buyers(name) — ambil summary.totalAmount (atau totalQuantity utk unit). BUKAN item.byName (itu info stok/harga).\n' +
  '- "pemasok/supplier/suplier mana yang memasok/mensupply barang X / siapa pemasok X / total pembelian barang X dari semua pemasok" → item.suppliers(name, fromDate?, toDate?).\n' +
  '- "faktur penjualan apa saja yang memuat/mengandung barang X" → item.invoices(name, type:"sale"). "faktur pembelian mana dari pemasok Y yang isinya barang X" → item.invoices(name, type:"purchase", entity:"Y").\n' +
  '- Pertanyaan yg menyebut DUA periode berbeda ("pada tahun 2016 DAN 2017", "bulan Januari vs Februari") = komparatif → ' +
  '{"tool":null} — KECUALI memakai tool dari PENGECUALIAN di atas (salePurchase.summaryBoth / arap.summary / ' +
  "receivables.summary dgn years / party.topByYears / item.topSelling dgn years / module.recordCount dgn years / " +
  'salesInvoice.summaryMulti / purchaseInvoice.summaryMulti dgn fromDate1&toDate1 + fromDate2&toDate2); JANGAN mencampur dua periode jadi SATU rentang tanggal.\n' +
  '- SINONIM (arti sama, jangan bingung): suplier/supplier = pemasok = vendor; pelanggan = customer = konsumen/umum; hutang = utang = kewajiban = payables; piutang = tagihan = receivables; beli = pembelian = purchase; jual = penjualan = sales; laba/untung = profit; barang = item = produk = unit; faktur = invoice = nota; total/jumlah = besaran; rata2 = average/mean; turun = menurun; naik = meningkat; terbesar = terbanyak = paling banyak.\n' +
  '- "barang apa saja yang dibeli/diterima/dipesan pelanggan X / barang yang dijual ke X / barang apa saja yang dibeli DARI pelanggan X" → customer.itemsByName(name, fromDate?, toDate?) — "dari pelanggan" artinya pembelian OLEH pelanggan, TETAP customer. ' +
  'vendor.itemsByName HANYA utk "barang yang dibeli/di-suplai DARI pemasok/vendor X".\n' +
  '- "barang apa saja yang dibeli/di-suplai dari pemasok/vendor X" → vendor.itemsByName(name, fromDate?, toDate?).\n' +
  '- "ada berapa/banyak ... yang tercatat/terdaftar/ada di sistem" utk modul daftar NON-faktur (pelanggan, pemasok, ' +
  "akun, gudang, satuan, kategori, cabang, departemen, karyawan, pajak, mata uang, proyek, termin, hak akses, " +
  "surat pesanan, surat jalan, penawaran, penerimaan, transfer, pembayaran lain, jurnal, retur, aset tetap, job order, " +
  'stock opname, biaya/expense, dll) → module.recordCount (modules:["<modul>"] [, year]) — JANGAN null, JANGAN cashflow/receivables. ' +
  'Faktur penjualan/pembelian & barang pakai toolnya sendiri (invoice.statusCounts / salesInvoice.summary / item.stockOverview).\n' +
  '- "apa saja X yang terdaftar/ada di sistem" (daftar nama: gudang, satuan, kategori, cabang, mata uang, dll) → ' +
  'module.recordCount (modules:["<modul>"], withNames:true).\n' +
  '- "berapa transaksi biaya paling baru / kapan biaya terbaru + nomor & jumlahnya" → ' +
  'module.recordCount (modules:["expense"], withLatest:true) — tanggal terbaru sudah diurut tahun-bulan-hari.\n' +
  '- "berapa total nilai seluruh job order / job order mana nilainya terbesar" → jobOrder.summary (tanpa argumen).\n' +
  '- "saldo di kartu pelanggan/pemasok paling besar (di kartu)" → party.cardBalance (side, limit) — BUKAN receivables.summary.\n' +
  '- Untuk pertanyaan lanjutan ("yang kedua siapa?", "bandingkan keduanya", "dari pelanggan itu"), gunakan riwayat untuk resolve referensi.\n' +
  "- Nama orang/barang boleh sebagian (\"Abadi\" → name:\"Abadi\").\n" +
  "- Tanggal format dd/mm/yyyy. Tanpa tanggal = semua periode.\n" +
  "- Bila ragu atau pertanyaan di luar cakupan tool, balas {\"tool\":null}.\n\n" +
  "Daftar tool:\n" +
  ROUTER_CATALOG;

/** panggil router — kembalikan Route atau null (fallback ke tool loop penuh) */
export async function transformToRoute(opts: {
  userMessage: string;
  history: Array<{ role: "user" | "model"; text: string }>;
  client: LLMClient;
  model: string;
}): Promise<Route | null> {
  const recent = opts.history.slice(-4);
  const contents: LLMContent[] = [
    ...recent.map((h) => ({ role: h.role, parts: [{ text: h.text.slice(0, 500) }] })),
    { role: "user", parts: [{ text: opts.userMessage }] },
  ];

  const signal = AbortSignal.timeout(15_000);
  try {
    const { parts } = await opts.client.generate({
      contents,
      system: ROUTER_SYSTEM,
      model: opts.model,
      signal,
    });
    const raw = parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join("");
    const jsonStr = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    // model kadang membungkus JSON dgn teks/angka aneh → ekstrak objek {...} terpanjang dulu
    const candidates = [jsonStr];
    const m = jsonStr.match(/\{[\s\S]*\}/);
    if (m) candidates.push(m[0]);
    // angka bertitik ribuan di luar string ("total": 1.234.567) mematikan parser → quote
    candidates.push(jsonStr.replace(/(\d)\.(\d{3})(\.\d{3})+/g, '"$1.$2$3"'));
    let parsed: { tool?: string | null; args?: Record<string, unknown> } | null = null;
    for (const cand of candidates) {
      try {
        parsed = JSON.parse(cand) as { tool?: string | null; args?: Record<string, unknown> };
        break;
      } catch {
        /* coba kandidat berikutnya */
      }
    }
    if (!parsed) {
      console.warn(`[transformer] JSON gagal. raw: ${jsonStr.slice(0, 300)}`);
      return null;
    }
    if (!parsed.tool) return null;
    const known = AGGREGATION_TOOLS.find((t) => t.name === parsed.tool);
    if (!known) return null;
    // validasi argumen wajib — bila kosong, jatuh ke tool loop (lebih baik error jelas)
    const schema = known.jsonSchema as { required?: string[] };
    for (const k of schema.required ?? []) {
      const v = parsed.args?.[k];
      if (v === undefined || v === null || v === "") return null;
    }
    return { tool: parsed.tool, args: parsed.args ?? {} };
  } catch (e) {
    console.warn(`[transformer] gagal (${e instanceof Error ? e.message : e}) — jatuh ke tool loop`);
    return null;
  }
}

// ─── Formatter: hasil agregasi → teks natural Indonesia ───

function fmtMoney(n: unknown): string {
  const v = Number(n) || 0;
  // pertahankan 2 desimal bila nilai tidak bulat (utang/piutang punya sen)
  if (!Number.isInteger(v))
    return "Rp" + v.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return "Rp" + v.toLocaleString("id-ID");
}

function fmtDate(d: unknown): string {
  const s = String(d ?? "");
  if (!s) return "-";
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const m2 = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m2) return s;
  return s.slice(0, 10);
}

function nameOf(o: Record<string, unknown> | undefined, ...keys: string[]): string {
  if (!o) return "-";
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return "-";
}

/** Blok tabel markdown terstruktur — HANYA utk baris data murni.
 *  Web mengubahnya jadi <table> (lihat rich-text.tsx); WhatsApp tampil sbg teks mentah. */
function mdTable(headers: string[], rows: string[][], rightCols: number[] = []): string {
  const esc = (s: string) => String(s).replace(/\|/g, "\\|");
  const head = `| ${headers.map(esc).join(" | ")} |`;
  const sep = `| ${headers.map((_, i) => (rightCols.includes(i) ? "---:" : "---")).join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map((c) => esc(String(c))).join(" | ")} |`);
  return [head, sep, ...body].join("\n");
}

type Fmt = (r: Record<string, unknown>) => string | null;

const FORMATTERS: Record<string, Fmt> = {
  "customer.lastOrderByName": (r) => {
    const c = r.customer as Record<string, unknown> | undefined;
    if (!c) return null;
    const name = nameOf(c, "name", "customerName");
    const last = r.lastOrder as Record<string, unknown> | null;
    if (!last) return `Pelanggan ${name} belum memiliki faktur penjualan.`;
    const no = nameOf(last, "number", "invoiceNo");
    const total = fmtMoney(last.totalAmount);
    const date = fmtDate(last.transDate);
    return `Pesanan terakhir dari pelanggan ${name}: faktur ${no} tanggal ${date} senilai ${total}.`;
  },

  "customer.unpaidByName": (r) => {
    const c = r.customer as Record<string, unknown> | undefined;
    if (!c) return null;
    const name = nameOf(c, "name", "customerName");
    const total = Number(r.totalUnpaid) || 0;
    const count = Number(r.countUnpaid) || 0;
    if (count === 0) return `Pelanggan ${name} tidak memiliki piutang belum dibayar. Semua faktur sudah lunas.`;
    const unpaid = Array.isArray(r.unpaid) ? (r.unpaid as Record<string, unknown>[]) : [];
    const tbl = mdTable(
      ["No", "Faktur", "Nilai"],
      unpaid.slice(0, 5).map((f, i) => [String(i + 1), nameOf(f, "number"), fmtMoney(f.totalAmount)]),
      [2]
    );
    return `Piutang belum dibayar dari pelanggan ${name}: ${fmtMoney(total)} dari ${count} faktur.\n\n${tbl}${unpaid.length > 5 ? `\n\n… dan ${unpaid.length - 5} faktur lainnya.` : ""}`;
  },

  "customer.summaryByName": (r) => {
    const c = r.customer as Record<string, unknown> | undefined;
    if (!c) return null;
    const name = nameOf(c, "name", "customerName");
    const s = r.summary as Record<string, unknown> | undefined;
    if (!s) return null;
    const invCount = Number(s.invoiceCount) || 0;
    const totalSales = Number(s.totalSales) || 0;
    const unpaidCount = Number(s.unpaidCount) || 0;
    const totalUnpaid = Number(s.totalUnpaid) || 0;
    const last = r.lastOrder as Record<string, unknown> | null;
    const period = r.period as Record<string, unknown> | undefined;
    const periodStr = period
      ? ` (periode ${nameOf(period, "fromDate")}–${nameOf(period, "toDate")})`
      : "";
    const lastStr = last
      ? ` Pesanan terakhir: faktur ${nameOf(last, "number")} tanggal ${fmtDate(last.transDate)} senilai ${fmtMoney(last.totalAmount)}.`
      : "";
    const custNo = nameOf(c, "customerNo");
    const noLine = custNo && custNo !== "-" ? `\n• Nomor pelanggan: ${custNo}` : "";
    return (
      `Ringkasan pelanggan ${name}${periodStr}:\n` +
      `• Total penjualan: ${fmtMoney(totalSales)} dari ${invCount} faktur\n` +
      `• Piutang belum dibayar: ${fmtMoney(totalUnpaid)} dari ${unpaidCount} faktur` +
      noLine +
      lastStr
    );
  },

  "customer.salesByName": (r) => {
    const c = r.customer as Record<string, unknown> | undefined;
    if (!c) return null;
    const name = nameOf(c, "name", "customerName");
    const period = r.period;
    const periodStr = typeof period === "object" && period
      ? `periode ${nameOf(period as Record<string, unknown>, "fromDate")}–${nameOf(period as Record<string, unknown>, "toDate")}`
      : "seluruh periode";
    const s = r.summary as Record<string, unknown> | undefined;
    const invCount = Number(s?.invoiceCount) || 0;
    const total = Number(s?.totalSales) || 0;
    const invoices = Array.isArray(r.invoices) ? (r.invoices as Record<string, unknown>[]) : [];
    const tbl = mdTable(
      ["No", "Faktur", "Tanggal", "Nilai"],
      invoices.slice(0, 15).map((f, i) => [String(i + 1), nameOf(f, "number"), fmtDate(f.transDate), fmtMoney(f.totalAmount)]),
      [3]
    );
    return (
      `Semua faktur penjualan dari pelanggan ${name} (${periodStr}):\n\n` +
      `${tbl}\n\n` +
      `Total: ${fmtMoney(total)} dari ${invCount} faktur.`
    );
  },

  "customer.itemsByName": (r) => {
    const c = r.customer as Record<string, unknown> | undefined;
    if (!c) return null;
    const name = nameOf(c, "name", "customerName");
    const period = r.period;
    const periodStr = typeof period === "object" && period
      ? `periode ${nameOf(period as Record<string, unknown>, "fromDate")}–${nameOf(period as Record<string, unknown>, "toDate")}`
      : "selama ini";
    const s = r.summary as Record<string, unknown> | undefined;
    const items = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [];
    const totalQty = Number(s?.totalQuantity) || 0;
    const totalAmt = Number(s?.totalAmount) || 0;
    if (items.length === 0)
      return `Tidak ada barang yang tercatat untuk pelanggan ${name} pada ${periodStr}.`;
    const tbl = mdTable(
      ["No", "Barang", "Unit", "Total", "Rata-rata/unit", "Faktur"],
      items.slice(0, 15).map((it, i) => {
        const qty = Number(it.quantity) || 0;
        const amt = Number(it.amount) || 0;
        const fc = Number(it.invoiceCount) || 0;
        return [String(i + 1), nameOf(it, "itemName", "name"), String(qty), fmtMoney(amt), qty > 0 ? fmtMoney(amt / qty) : "-", String(fc)];
      }),
      [2, 3, 4, 5]
    );
    return (
      `Barang yang dibeli pelanggan ${name} (${periodStr}) — total ${totalQty} unit, ${fmtMoney(totalAmt)}:\n\n` +
      `${tbl}` +
      (items.length > 15 ? `\n\n… dan ${items.length - 15} jenis barang lainnya.` : "")
    );
  },

  "salesInvoice.summary": (r) => {
    const period = r.period as Record<string, unknown> | undefined;
    const s = r.summary as Record<string, unknown> | undefined;
    if (!s) return null;
    const from = nameOf(period, "fromDate");
    const to = nameOf(period, "toDate");
    const invCount = Number(s.invoiceCount) || 0;
    const total = Number(s.totalSales) || 0;
    const avg = Number(s.average) || 0;
    const topRows = Array.isArray(r.topByAmount)
      ? (r.topByAmount as Record<string, unknown>[])
      : [...(Array.isArray(r.invoices) ? (r.invoices as Record<string, unknown>[]) : [])].sort(
          (a, b) => (Number(b.totalAmount) || 0) - (Number(a.totalAmount) || 0)
        );
    const top5 = topRows.slice(0, 5);
    const top = top5.length
      ? mdTable(
          ["No", "Faktur", "Tanggal", "Nilai", "Pelanggan"],
          top5.map((f, i) => [String(i + 1), nameOf(f, "number"), fmtDate(f.transDate), fmtMoney(f.totalAmount), nameOf(f, "customerName")]),
          [3]
        )
      : "";
    const topCust = Array.isArray(r.topByCustomer)
      ? (r.topByCustomer as Record<string, unknown>[])[0]
      : undefined;
    const topCustLine = topCust
      ? `\n• Pelanggan terbesar: ${nameOf(topCust, "customerName", "name")} — ${fmtMoney(topCust.total)} dari ${topCust.invoiceCount ?? 0} faktur`
      : "";
    return (
      `Ringkasan penjualan ${from}–${to}:\n` +
      `• Total: ${fmtMoney(total)}\n` +
      `• Jumlah faktur: ${invCount}\n` +
      `• Rata-rata per faktur: ${fmtMoney(avg)}` +
      topCustLine +
      (top ? `\n\nFaktur terbesar:\n${top}` : "")
    );
  },

  "salesInvoice.summaryMulti": (r) => {
    const periods = Array.isArray(r.periods) ? (r.periods as Record<string, unknown>[]) : [];
    if (periods.length < 2) return null;
    const [p1, p2p] = periods;
    const diff = (r.diff ?? {}) as Record<string, unknown>;
    const combined = (r.combined ?? {}) as Record<string, unknown>;
    const line = (p: Record<string, unknown>) =>
      `${nameOf(p, "label")}: total ${fmtMoney(p.totalSales)}, ${p.invoiceCount ?? 0} faktur, rata-rata ${fmtMoney(p.average)}/faktur, ${p.customerCount ?? 0} pelanggan aktif, ${p.paidCount ?? 0} lunas`;
    return (
      `Perbandingan penjualan:\n` +
      `• ${line(p1)}\n` +
      `• ${line(p2p)}\n` +
      `• Gabungan kedua periode: ${fmtMoney(combined.totalSales)} dari ${combined.invoiceCount ?? 0} faktur\n` +
      `• Selisih total: ${fmtMoney(diff.totalSales)}\n` +
      `• Selisih rata-rata: ${fmtMoney(diff.average)}\n` +
      `• Selisih jumlah faktur: ${Number(diff.invoiceCount) || 0}`
    );
  },

  "purchaseInvoice.summaryMulti": (r) => {
    const periods = Array.isArray(r.periods) ? (r.periods as Record<string, unknown>[]) : [];
    if (periods.length < 2) return null;
    const [p1, p2p] = periods;
    const diff = (r.diff ?? {}) as Record<string, unknown>;
    const combined = (r.combined ?? {}) as Record<string, unknown>;
    const line = (p: Record<string, unknown>) =>
      `${nameOf(p, "label")}: total ${fmtMoney(p.totalPurchase)}, ${p.invoiceCount ?? 0} faktur, rata-rata ${fmtMoney(p.average)}/faktur`;
    return (
      `Perbandingan pembelian:\n` +
      `• ${line(p1)}\n` +
      `• ${line(p2p)}\n` +
      `• Gabungan kedua periode: ${fmtMoney(combined.totalPurchase)} dari ${combined.invoiceCount ?? 0} faktur\n` +
      `• Selisih total: ${fmtMoney(diff.totalPurchase)}\n` +
      `• Selisih rata-rata: ${fmtMoney(diff.average)}\n` +
      `• Selisih jumlah faktur: ${Number(diff.invoiceCount) || 0}`
    );
  },

  "arap.summary": (r) => {
    const ar = (r.receivables ?? {}) as Record<string, unknown>;
    const ap = (r.payables ?? {}) as Record<string, unknown>;
    const larger = String(r.larger ?? "");
    const diff = Number(r.diff) || 0;
    const period = r.period;
    const periodStr =
      typeof period === "object" && period
        ? ` (dari transaksi ${nameOf(period as Record<string, unknown>, "fromDate")}–${nameOf(period as Record<string, unknown>, "toDate")})`
        : "";
    const largerLine =
      larger === "sama"
        ? "Keduanya sama besar."
        : `Yang lebih besar: ${larger === "utang" ? "utang usaha" : "piutang usaha"} (selisih ${fmtMoney(diff)}).`;
    const cust = Array.isArray(ar.customers) ? (ar.customers as Record<string, unknown>[]) : [];
    const vend = Array.isArray(ap.vendors) ? (ap.vendors as Record<string, unknown>[]) : [];
    const custTbl = cust.length
      ? `\n\nPiutang terbesar:\n\n` +
        mdTable(
          ["No", "Pelanggan", "Faktur", "Tagihan"],
          cust.slice(0, 10).map((c, i) => [
            String(i + 1),
            nameOf(c, "name", "customerName"),
            String(c.invoiceCount ?? 0),
            fmtMoney(c.total),
          ]),
          [2, 3]
        )
      : "";
    const vendTbl = vend.length
      ? `\n\nUtang terbesar:\n\n` +
        mdTable(
          ["No", "Pemasok", "Faktur", "Tagihan"],
          vend.slice(0, 10).map((v, i) => [
            String(i + 1),
            nameOf(v, "name", "vendorName"),
            String(v.invoiceCount ?? 0),
            fmtMoney(v.total),
          ]),
          [2, 3]
        )
      : "";
    return (
      `Total piutang usaha${periodStr}: ${fmtMoney(ar.total)} dari ${ar.invoiceCount ?? 0} faktur.\n` +
      `Total utang usaha${periodStr}: ${fmtMoney(ap.total)} dari ${ap.invoiceCount ?? 0} faktur.\n` +
      largerLine +
      custTbl +
      vendTbl
    );
  },

  "invoice.statusCounts": (r) => {
    const side = String(r.side ?? "sales") === "purchase" ? "pembelian" : "penjualan";
    const total = Number(r.invoiceCount) || 0;
    const paid = Number(r.paid) || 0;
    const unpaid = Number(r.unpaid) || 0;
    const scope = r.scope;
    const periodStr =
      typeof scope === "object" && scope
        ? ` pada periode ${nameOf(scope as Record<string, unknown>, "fromDate")}–${nameOf(scope as Record<string, unknown>, "toDate")}`
        : "";
    return `Dari total ${total} faktur ${side}${periodStr}: ${paid} lunas dan ${unpaid} belum lunas.`;
  },

  "party.yoySummary": (r) => {
    const years = Array.isArray(r.years) ? (r.years as Record<string, unknown>[]) : [];
    if (years.length < 2) return null;
    const unit = String(r.unit ?? "penjualan") === "pembelian" ? "pembelian" : "penjualan";
    const partyWord = String(r.party ?? "customer") === "vendor" ? "pemasok" : "pelanggan";
    const entity = nameOf(r, "entity", "name");
    const direction = String(r.direction ?? "");
    const diff = Number(r.diff) || 0;
    const tbl = mdTable(
      ["Tahun", "Total", "Faktur"],
      years.map((p) => [String(p.year), fmtMoney(p.total), String(p.invoiceCount ?? 0)]),
      [1, 2]
    );
    const conclusion =
      direction === "sama"
        ? "Kesimpulan: tidak berubah (keduanya sama)."
        : `Kesimpulan: ${direction} ${fmtMoney(diff)} dari tahun ${years[0]?.year} ke tahun ${years[1]?.year}.`;
    return (
      `Perbandingan ${unit} ${partyWord} ${entity}:\n\n` +
      `${tbl}\n` +
      conclusion
    );
  },

  "return.summaryBoth": (r) => {
    const sr = (r.salesReturn ?? {}) as Record<string, unknown>;
    const pr = (r.purchaseReturn ?? {}) as Record<string, unknown>;
    const larger = String(r.larger ?? "");
    const diff = Number(r.diff) || 0;
    const largerLine =
      larger === "sama"
        ? "Keduanya sama besar."
        : `Yang lebih besar: retur ${larger === "salesReturn" ? "penjualan" : "pembelian"} (selisih ${fmtMoney(diff)}).`;
    return (
      `Total retur penjualan: ${fmtMoney(sr.totalAmount)} dari ${sr.returnCount ?? 0} dokumen.\n` +
      `Total retur pembelian: ${fmtMoney(pr.totalAmount)} dari ${pr.returnCount ?? 0} dokumen.\n` +
      largerLine
    );
  },

  "salesReceipt.yearCount": (r) => {
    const year = Number(r.year) || 0;
    const count = Number(r.count) || 0;
    if (!count) return `Tidak ada bukti penerimaan penjualan dengan transDate tahun ${year}.`;
    const rows = Array.isArray(r.receipts) ? (r.receipts as Record<string, unknown>[]) : [];
    const tbl = mdTable(
      ["No", "Dokumen", "Tanggal", "Nilai"],
      rows.slice(0, 10).map((x, i) => [String(i + 1), nameOf(x, "number"), nameOf(x, "transDate"), fmtMoney(x.totalAmount)]),
      [3]
    );
    const more = count > rows.slice(0, 10).length ? `\n\n… dan ${count - Math.min(count, 10)} dokumen lainnya.` : "";
    return `Ada ${count} bukti penerimaan penjualan tahun ${year} (dihitung dari transDate):\n\n${tbl}${more}`;
  },

  "deliveryOrder.yearCount": (r) => {
    const year = Number(r.year) || 0;
    const count = Number(r.count) || 0;
    if (!count) return `Tidak ada surat jalan dengan transDate tahun ${year}.`;
    const rows = Array.isArray(r.deliveries) ? (r.deliveries as Record<string, unknown>[]) : [];
    const tbl = mdTable(
      ["No", "Surat Jalan", "Tanggal", "Keterangan"],
      rows.slice(0, 10).map((x, i) => [String(i + 1), nameOf(x, "number"), nameOf(x, "transDate"), nameOf(x, "description")])
    );
    const more = count > rows.slice(0, 10).length ? `\n\n… dan ${count - Math.min(count, 10)} dokumen lainnya.` : "";
    return `Ada ${count} surat jalan tahun ${year} (dihitung dari transDate):\n\n${tbl}${more}`;
  },

  "invoice.biggestBoth": (r) => {
    const one = (o: Record<string, unknown> | null | undefined, label: string) => {
      if (!o) return `${label}: tidak ada faktur.`;
      const party = nameOf(o, "partyName");
      return `${label}: ${nameOf(o, "number")} (${fmtDate(o.transDate)})${party && party !== "-" ? ` dari ${party}` : ""} — ${fmtMoney(o.totalAmount)}`;
    };
    return (
      one(r.sales as Record<string, unknown>, "Faktur penjualan terbesar") +
      "\n" +
      one(r.purchase as Record<string, unknown>, "Faktur pembelian terbesar")
    );
  },

  "fixedAsset.summary": (r) => {
    const count = Number(r.count) || 0;
    const year = Number(r.year) || 0;
    if (!count) return `Tidak ada aset tetap yang dibeli tahun ${year}.`;
    const items = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [];
    const tbl = items.length
      ? mdTable(
          ["No", "Aset", "Tanggal", "Keterangan"],
          items.slice(0, 5).map((it, i) => [String(i + 1), nameOf(it, "number"), nameOf(it, "transDate"), nameOf(it, "description")])
        )
      : "";
    return `Ada ${count} aset tetap yang dibeli tahun ${year}.` + (tbl ? `\n\nSebagian contoh:\n\n${tbl}` : "");
  },

  "journalVoucher.yearSummary": (r) => {
    const years = Array.isArray(r.years) ? (r.years as Record<string, unknown>[]) : [];
    const top = r.top as Record<string, unknown> | undefined;
    if (!top) return "Tidak ada jurnal umum tercatat.";
    const detail = years.length
      ? mdTable(
          ["Tahun", "Transaksi", "Nilai"],
          years.map((y) => [nameOf(y, "year"), String(Number(y.count) || 0), fmtMoney(y.totalAmount)]),
          [1, 2]
        )
      : "";
    return (
      `Tahun ${nameOf(top, "year")} paling banyak memiliki jurnal umum: ${Number(top.count) || 0} transaksi ` +
      `(total ${fmtMoney(top.totalAmount)}).\n\nRincian per tahun (berdasarkan tanggal transaksi):\n\n${detail}`
    );
  },

  "item.topStock": (r) => {
    const items = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [];
    const limit = Number(r.limit) || 10;
    if (!items.length) return "Tidak ada data barang.";
    const tbl = mdTable(
      ["No", "Barang", "Stok"],
      items.slice(0, limit).map((it, i) => [String(i + 1), nameOf(it, "name"), String(Number(it.quantity) || 0)]),
      [2]
    );
    return `Barang dengan stok terbanyak (urut quantity, presisi):\n\n${tbl}`;
  },

  "item.zeroStock": (r) => {
    const items = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [];
    const zeroCount = Number(r.zeroCount) || 0;
    if (zeroCount === 0) return `Tidak ada item dengan stok 0; stok minimum saat ini ${Number(r.minQuantity) || 0} unit.`;
    const names = items.map((it) => nameOf(it, "name")).filter((n) => n && n !== "-");
    const tbl = names.length ? mdTable(["No", "Barang"], names.map((n, i) => [String(i + 1), n])) : "";
    return `Ada ${zeroCount} item dengan stok 0 (barang dengan stok paling sedikit):\n\n${tbl}`;
  },

  "item.stockOverview": (r) => {
    const itemCount = Number(r.itemCount) || 0;
    const totalQuantity = Number(r.totalQuantity) || 0;
    const warehouseCount = Number(r.warehouseCount) || 0;
    const warehouses = Array.isArray(r.warehouses) ? (r.warehouses as unknown[]).map(String) : [];
    const wList = warehouses.length ? `\nGudang: ${warehouses.join(", ")}.` : "";
    return (
      `Ringkasan persediaan: ${itemCount} jenis barang, total seluruh stok ${totalQuantity.toLocaleString("id-ID")} unit, ` +
      `tersebar di ${warehouseCount} gudang.${wList}`
    );
  },

  "autoNumber.summary": (r) => {
    const count = Number(r.count) || 0;
    const items = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [];
    const names = items.map((it) => nameOf(it, "name")).filter((n) => n && n !== "-");
    const contoh = names.length ? `\nContoh: ${names.join(", ")}.` : "";
    return `Ada ${count} aturan penomoran otomatis (auto number) yang terdaftar.${contoh}`;
  },

  "journalVoucher.summary": (r) => {
    const s = r.summary as Record<string, unknown> | undefined;
    if (!s) return null;
    const count = Number(s.journalCount) || 0;
    const total = Number(s.totalAmount) || 0;
    const period = r.period;
    const periodStr =
      typeof period === "object" && period
        ? `periode ${nameOf(period as Record<string, unknown>, "fromDate")}–${nameOf(period as Record<string, unknown>, "toDate")}`
        : "seluruh masa";
    return (
      `Ringkasan jurnal umum (${periodStr}):\n` +
      `• Jumlah transaksi: ${count}\n` +
      `• Total nilai: ${fmtMoney(total)}`
    );
  },

  "salesReturn.summary": (r) => {
    const s = r.summary as Record<string, unknown> | undefined;
    if (!s) return null;
    const count = Number(s.returnCount) || 0;
    const total = Number(s.totalAmount) || 0;
    const period = r.period;
    const periodStr =
      typeof period === "object" && period
        ? `periode ${nameOf(period as Record<string, unknown>, "fromDate")}–${nameOf(period as Record<string, unknown>, "toDate")}`
        : "seluruh masa";
    return `Retur penjualan (${periodStr}): ${count} transaksi, total ${fmtMoney(total)}.`;
  },

  "purchaseReturn.summary": (r) => {
    const s = r.summary as Record<string, unknown> | undefined;
    if (!s) return null;
    const count = Number(s.returnCount) || 0;
    const total = Number(s.totalAmount) || 0;
    const period = r.period;
    const periodStr =
      typeof period === "object" && period
        ? `periode ${nameOf(period as Record<string, unknown>, "fromDate")}–${nameOf(period as Record<string, unknown>, "toDate")}`
        : "seluruh masa";
    return `Retur pembelian (${periodStr}): ${count} transaksi, total ${fmtMoney(total)}.`;
  },

  "purchaseInvoice.summary": (r) => {
    const period = r.period as Record<string, unknown> | undefined;
    const s = r.summary as Record<string, unknown> | undefined;
    if (!s) return null;
    const from = nameOf(period, "fromDate");
    const to = nameOf(period, "toDate");
    const invCount = Number(s.invoiceCount) || 0;
    const total = Number(s.totalPurchase) || 0;
    const avg = Number(s.average) || 0;
    const invoices = Array.isArray(r.invoices) ? (r.invoices as Record<string, unknown>[]) : [];
    const topByAmount = Array.isArray(r.topByAmount)
      ? (r.topByAmount as Record<string, unknown>[])
      : [...invoices].sort((a, b) => (Number(b.totalAmount) || 0) - (Number(a.totalAmount) || 0));
    let topLine = "";
    const top = topByAmount[0];
    if (top) {
      const topNo = nameOf(top, "number", "invoiceNo");
      const topAmt = fmtMoney(top.totalAmount);
      const topDate = fmtDate(top.transDate);
      const topVendor = nameOf(top, "vendorName") !== "-" ? nameOf(top, "vendorName") : nameOf((top.vendor ?? {}) as Record<string, unknown>, "name", "vendorName");
      topLine = `\n• Faktur terbesar: ${topNo} (${topDate})${topVendor && topVendor !== "-" ? ` dari ${topVendor}` : ""} — ${topAmt}`;
    }
    return (
      `Ringkasan pembelian ${from}–${to}:\n` +
      `• Total: ${fmtMoney(total)}\n` +
      `• Jumlah faktur: ${invCount}\n` +
      `• Rata-rata per faktur: ${fmtMoney(avg)}` +
      topLine
    );
  },

  "vendor.lastPurchaseByName": (r) => {
    const v = r.vendor as Record<string, unknown> | undefined;
    if (!v) return null;
    const name = nameOf(v, "name", "vendorName");
    const last = r.lastPurchase as Record<string, unknown> | null;
    if (!last) return `Pemasok ${name} belum memiliki faktur pembelian.`;
    const no = nameOf(last, "number", "invoiceNo");
    const total = fmtMoney(last.totalAmount);
    const date = fmtDate(last.transDate);
    return `Pembelian terakhir dari pemasok ${name}: faktur ${no} tanggal ${date} senilai ${total}.`;
  },

  "vendor.purchasesByName": (r) => {
    const v = r.vendor as Record<string, unknown> | undefined;
    if (!v) return null;
    const name = nameOf(v, "name", "vendorName");
    const period = r.period;
    const periodStr = typeof period === "object" && period
      ? `periode ${nameOf(period as Record<string, unknown>, "fromDate")}–${nameOf(period as Record<string, unknown>, "toDate")}`
      : "seluruh periode";
    const s = r.summary as Record<string, unknown> | undefined;
    const invCount = Number(s?.invoiceCount) || 0;
    const total = Number(s?.totalPurchase) || 0;
    const invoices = Array.isArray(r.invoices) ? (r.invoices as Record<string, unknown>[]) : [];
    const tbl = mdTable(
      ["No", "Faktur", "Tanggal", "Nilai"],
      invoices.slice(0, 15).map((f, i) => [String(i + 1), nameOf(f, "number"), fmtDate(f.transDate), fmtMoney(f.totalAmount)]),
      [3]
    );
    return (
      `Semua faktur pembelian dari pemasok ${name} (${periodStr}):\n\n` +
      `${tbl}\n\n` +
      `Total: ${fmtMoney(total)} dari ${invCount} faktur.`
    );
  },

  "vendor.itemsByName": (r) => {
    const v = r.vendor as Record<string, unknown> | undefined;
    if (!v) return null;
    const name = nameOf(v, "name", "vendorName");
    const period = r.period;
    const periodStr = typeof period === "object" && period
      ? `periode ${nameOf(period as Record<string, unknown>, "fromDate")}–${nameOf(period as Record<string, unknown>, "toDate")}`
      : "selama ini";
    const s = r.summary as Record<string, unknown> | undefined;
    const items = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [];
    const totalQty = Number(s?.totalQuantity) || 0;
    const totalAmt = Number(s?.totalAmount) || 0;
    if (items.length === 0)
      return `Tidak ada barang yang tercatat dari pemasok ${name} pada ${periodStr}.`;
    const tbl = mdTable(
      ["No", "Barang", "Unit", "Total", "Rata-rata/unit", "Faktur"],
      items.slice(0, 15).map((it, i) => {
        const qty = Number(it.quantity) || 0;
        const amt = Number(it.amount) || 0;
        const fc = Number(it.invoiceCount) || 0;
        return [String(i + 1), nameOf(it, "itemName", "name"), String(qty), fmtMoney(amt), qty > 0 ? fmtMoney(amt / qty) : "-", String(fc)];
      }),
      [2, 3, 4, 5]
    );
    return (
      `Barang yang dibeli dari pemasok ${name} (${periodStr}) — total ${totalQty} unit, ${fmtMoney(totalAmt)}:\n\n` +
      `${tbl}` +
      (items.length > 15 ? `\n\n… dan ${items.length - 15} jenis barang lainnya.` : "")
    );
  },

  "vendor.unpaidByName": (r) => {
    const v = r.vendor as Record<string, unknown> | undefined;
    if (!v) return null;
    const name = nameOf(v, "name", "vendorName");
    const total = Number(r.totalUnpaid) || 0;
    const count = Number(r.countUnpaid) || 0;
    if (count === 0) return `Pemasok ${name} tidak memiliki utang belum dibayar. Semua faktur sudah lunas.`;
    const unpaid = Array.isArray(r.unpaid) ? (r.unpaid as Record<string, unknown>[]) : [];
    const tbl = mdTable(
      ["No", "Faktur", "Nilai"],
      unpaid.slice(0, 5).map((f, i) => [String(i + 1), nameOf(f, "number"), fmtMoney(f.totalAmount)]),
      [2]
    );
    return `Utang belum dibayar ke pemasok ${name}: ${fmtMoney(total)} dari ${count} faktur.\n\n${tbl}${unpaid.length > 5 ? `\n\n… dan ${unpaid.length - 5} faktur lainnya.` : ""}`;
  },

  "vendor.summaryByName": (r) => {
    const v = r.vendor as Record<string, unknown> | undefined;
    if (!v) return null;
    const name = nameOf(v, "name", "vendorName");
    const s = r.summary as Record<string, unknown> | undefined;
    if (!s) return null;
    const invCount = Number(s.invoiceCount) || 0;
    const totalPurchase = Number(s.totalPurchase) || 0;
    const unpaidCount = Number(s.unpaidCount) || 0;
    const totalUnpaid = Number(s.totalUnpaid) || 0;
    const last = r.lastPurchase as Record<string, unknown> | null;
    const period = r.period as Record<string, unknown> | undefined;
    const periodStr = period
      ? ` (periode ${nameOf(period, "fromDate")}–${nameOf(period, "toDate")})`
      : "";
    const lastStr = last
      ? ` Pembelian terakhir: faktur ${nameOf(last, "number")} tanggal ${fmtDate(last.transDate)} senilai ${fmtMoney(last.totalAmount)}.`
      : "";
    return (
      `Ringkasan pemasok ${name}${periodStr}:\n` +
      `• Total pembelian: ${fmtMoney(totalPurchase)} dari ${invCount} faktur\n` +
      `• Utang belum dibayar: ${fmtMoney(totalUnpaid)} dari ${unpaidCount} faktur` +
      lastStr
    );
  },

  "salesInvoice.perCustomer": (r) => {
    const period = r.period;
    const periodStr = typeof period === "object" && period
      ? `periode ${nameOf(period as Record<string, unknown>, "fromDate")}–${nameOf(period as Record<string, unknown>, "toDate")}`
      : "seluruh periode";
    const customers = Array.isArray(r.customers) ? (r.customers as Record<string, unknown>[]) : [];
    if (customers.length === 0) return `Tidak ada penjualan pada ${periodStr}.`;
    const tblOf = (list: Record<string, unknown>[]) =>
      mdTable(
        ["No", "Pelanggan", "Kode", "Nilai", "Faktur"],
        list.map((c, i) => [
          String(i + 1),
          nameOf(c, "name", "customerName"),
          nameOf(c, "customerNo"),
          fmtMoney(c.total),
          String(c.invoiceCount ?? 0),
        ]),
        [3, 4]
      );
    // user minta N pelanggan ("cari 3 pelanggan") → tampilkan HANYA N baris, tanpa total semua / pelanggan terkecil
    const lim = Number(r.limit) || 0;
    if (lim > 0) {
      return `${Math.min(lim, customers.length)} pelanggan dengan penjualan terbesar (${periodStr}):\n\n${tblOf(customers.slice(0, lim))}`;
    }
    const list = tblOf(customers.slice(0, 15));
    const custCount = Number((r.summary as Record<string, unknown> | undefined)?.customerCount) || customers.length;
    const totalAll = Number((r.summary as Record<string, unknown> | undefined)?.totalSales) || 0;
    const sm = (r.summary as Record<string, unknown> | undefined)?.smallest as Record<string, unknown> | undefined;
    const smLine = sm
      ? `\nPelanggan dengan penjualan terkecil: ${nameOf(sm, "name", "customerName")} — ${fmtMoney(sm.total)} dari ${sm.invoiceCount ?? 0} faktur.`
      : "";
    return `Penjualan per pelanggan (${periodStr}) — ${custCount} pelanggan bertransaksi:\n\n${list}\n\nTotal semua pelanggan: ${fmtMoney(totalAll)}.${smLine}`;
  },

  "purchaseInvoice.perVendor": (r) => {
    const period = r.period;
    const periodStr = typeof period === "object" && period
      ? `periode ${nameOf(period as Record<string, unknown>, "fromDate")}–${nameOf(period as Record<string, unknown>, "toDate")}`
      : "seluruh periode";
    const vendors = Array.isArray(r.vendors) ? (r.vendors as Record<string, unknown>[]) : [];
    if (vendors.length === 0) return `Tidak ada pembelian pada ${periodStr}.`;
    const tblOfV = (list: Record<string, unknown>[]) =>
      mdTable(
        ["No", "Pemasok", "Kode", "Nilai", "Faktur"],
        list.map((v, i) => [
          String(i + 1),
          nameOf(v, "name", "vendorName"),
          nameOf(v, "vendorNo"),
          fmtMoney(v.total),
          String(v.invoiceCount ?? 0),
        ]),
        [3, 4]
      );
    // user minta N pemasok ("cari 3 pemasok") → tampilkan HANYA N baris, tanpa total semua / pemasok terkecil
    const lim = Number(r.limit) || 0;
    if (lim > 0) {
      return `${Math.min(lim, vendors.length)} pemasok dengan pembelian terbesar (${periodStr}):\n\n${tblOfV(vendors.slice(0, lim))}`;
    }
    const list = tblOfV(vendors.slice(0, 15));
    const totalAll = Number((r.summary as Record<string, unknown> | undefined)?.totalPurchase) || 0;
    const venCount = Number((r.summary as Record<string, unknown> | undefined)?.vendorCount) || vendors.length;
    const sm = (r.summary as Record<string, unknown> | undefined)?.smallest as Record<string, unknown> | undefined;
    const smLine = sm
      ? `\nPemasok dengan pembelian terkecil: ${nameOf(sm, "name", "vendorName")} — ${fmtMoney(sm.total)} dari ${sm.invoiceCount ?? 0} faktur.`
      : "";
    return `Pembelian per pemasok (${periodStr}) — ${venCount} pemasok bertransaksi:\n\n${list}\n\nTotal semua pemasok: ${fmtMoney(totalAll)}.${smLine}`;
  },

  "item.topSelling": (r) => {
    // mode beberapa tahun → barang terlaris per tahun (utk "terlaris tahun X dan tahun Y")
    if (Array.isArray(r.periods)) {
      const periods = r.periods as Array<Record<string, unknown>>;
      const rows: string[][] = [];
      for (const p of periods) {
        const items = Array.isArray(p.items) ? (p.items as Array<Record<string, unknown>>) : [];
        items.slice(0, 3).forEach((it, i) => {
          rows.push([
            nameOf(p, "year"),
            String(i + 1),
            nameOf(it, "itemName", "name", "no"),
            String(Number(it.quantity) || 0),
            fmtMoney(it.amount),
          ]);
        });
      }
      const heads = periods.map((p) => {
        const items = Array.isArray(p.items) ? (p.items as Array<Record<string, unknown>>) : [];
        return items.length ? nameOf(items[0], "itemName", "name") : "";
      });
      let concl = "";
      if (heads.length >= 2 && heads.every((h) => h && h === heads[0])) {
        concl = `\nKesimpulan: barang terlaris SAMA pada kedua tahun — ${heads[0]}.`;
      } else if (heads.length >= 2) {
        concl = `\nKesimpulan: berbeda — ${heads.map((h, i) => `${periods[i] ? nameOf(periods[i], "year") : ""}: ${h}`).join("; ")}.`;
      }
      if (rows.length === 0) {
        return `Barang paling laris per tahun (menurut unit terjual):\nTidak ada penjualan barang.`;
      }
      const tbl = mdTable(["Tahun", "No", "Barang", "Unit", "Nilai"], rows, [3, 4]);
      return `Barang paling laris per tahun (menurut unit terjual):\n\n${tbl}${concl}`;
    }
    const period = r.period as Record<string, unknown> | undefined;
    const from = nameOf(period, "fromDate");
    const to = nameOf(period, "toDate");
    const items = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [];
    if (items.length === 0) return `Tidak ada penjualan barang pada periode ${from}–${to}.`;
    const tbl = mdTable(
      ["No", "Barang", "Unit", "Nilai", "Rata-rata/unit"],
      items.slice(0, 10).map((it, i) => [
        String(i + 1),
        nameOf(it, "itemName", "name", "no"),
        String(Number(it.quantity) || 0),
        fmtMoney(it.amount),
        fmtMoney(it.avgUnitPrice),
      ]),
      [2, 3, 4]
    );
    return `Barang paling laris periode ${from}–${to}:\n\n${tbl}`;
  },

  "item.byName": (r) => {
    const it = (r.item ?? r) as Record<string, unknown> | undefined;
    if (!it || !it.name) return null;
    const name = nameOf(it, "name");
    const no = nameOf(it, "no");
    const price = r.sellingPrice ?? it.price ?? it.sellingPrice;
    const stock = r.stock ?? it.stock ?? it.quantity;
    const lines = [`Barang: ${name} (kode: ${no})`];
    if (price !== undefined && price !== null) lines.push(`Harga jual: ${fmtMoney(price)}`);
    if (stock !== undefined && stock !== null) lines.push(`Stok: ${Number(stock)}`);
    return lines.join("\n");
  },

  "item.buyers": (r) => {
    const itemName = nameOf(r, "item", "name");
    const s = r.summary as Record<string, unknown> | undefined;
    const period = r.period as Record<string, unknown> | undefined;
    const periodStr = period
      ? `${nameOf(period, "fromDate")}–${nameOf(period, "toDate")}`
      : "selama ini";
    const buyers = Array.isArray(r.buyers) ? (r.buyers as Record<string, unknown>[]) : [];
    const matched = Number(s?.matchedInvoices) || 0;
    const totalQty = Number(s?.totalQuantity) || 0;
    const totalAmt = Number(s?.totalAmount) || 0;
    if (buyers.length === 0 || matched === 0)
      return `Tidak ada pelanggan yang membeli barang "${itemName}" pada periode ${periodStr}.`;
    const tbl = mdTable(
      ["No", "Pelanggan", "Unit", "Total", "Faktur"],
      buyers.slice(0, 10).map((b, i) => [
        String(i + 1),
        nameOf(b, "name", "customerName"),
        String(Number(b.quantity) || 0),
        fmtMoney(b.amount),
        String(Number(b.invoiceCount) || 0),
      ]),
      [2, 3, 4]
    );
    return (
      `Pembeli barang "${itemName}" (${periodStr}) — total ${totalQty} unit, ${fmtMoney(totalAmt)}:\n\n` +
      `${tbl}` +
      (buyers.length > 10 ? `\n\n… dan ${buyers.length - 10} pembeli lainnya.` : "")
    );
  },

  "item.suppliers": (r) => {
    const itemName = nameOf(r, "item", "name");
    const s = r.summary as Record<string, unknown> | undefined;
    const period = r.period as Record<string, unknown> | undefined;
    const periodStr = period
      ? `${nameOf(period, "fromDate")}–${nameOf(period, "toDate")}`
      : "selama ini";
    const suppliers = Array.isArray(r.suppliers) ? (r.suppliers as Record<string, unknown>[]) : [];
    const matched = Number(s?.matchedInvoices) || 0;
    const totalQty = Number(s?.totalQuantity) || 0;
    const totalAmt = Number(s?.totalAmount) || 0;
    if (suppliers.length === 0 || matched === 0)
      return `Tidak ada pemasok/supplier yang mensupply barang "${itemName}" pada periode ${periodStr}.`;
    const tbl = mdTable(
      ["No", "Pemasok", "Unit", "Total", "Faktur"],
      suppliers.slice(0, 10).map((b, i) => [
        String(i + 1),
        nameOf(b, "name", "vendorName"),
        String(Number(b.quantity) || 0),
        fmtMoney(b.amount),
        String(Number(b.invoiceCount) || 0),
      ]),
      [2, 3, 4]
    );
    const avg = totalQty > 0 ? `, rata-rata ${fmtMoney(totalAmt / totalQty)}/unit` : "";
    return (
      `Pemasok/supplier barang "${itemName}" (${periodStr}) — total ${totalQty} unit, ${fmtMoney(totalAmt)}${avg}:\n\n` +
      `${tbl}` +
      (suppliers.length > 10 ? `\n\n… dan ${suppliers.length - 10} pemasok lainnya.` : "")
    );
  },

  "item.invoices": (r) => {
    const itemName = nameOf(r, "item", "name");
    const type = String(r.type ?? "sale") === "purchase" ? "purchase" : "sale";
    const entity = nameOf(r, "entity");
    const period = r.period as Record<string, unknown> | undefined;
    const periodStr = period
      ? `${nameOf(period, "fromDate")}–${nameOf(period, "toDate")}`
      : "selama ini";
    const s = r.summary as Record<string, unknown> | undefined;
    const partyLabel = String(r.partyLabel ?? (type === "purchase" ? "pemasok" : "pelanggan"));
    const invoices = Array.isArray(r.invoices) ? (r.invoices as Record<string, unknown>[]) : [];
    const matched = Number(s?.matchedInvoices) || 0;
    if (matched === 0)
      return `Tidak ada faktur ${type === "purchase" ? "pembelian" : "penjualan"} yang memuat barang "${itemName}"${entity ? ` (${entity})` : ""} pada ${periodStr}.`;
    const tbl = mdTable(
      ["No", "Faktur", "Tanggal", partyLabel.charAt(0).toUpperCase() + partyLabel.slice(1), "Total Faktur", "Unit", "Nilai Barang"],
      invoices.slice(0, 30).map((f, i) => [
        String(i + 1),
        nameOf(f, "number"),
        fmtDate(f.transDate),
        nameOf(f, "party") || "-",
        fmtMoney(f.totalAmount),
        String(Number(f.itemQuantity) || 0),
        fmtMoney(f.itemAmount),
      ]),
      [4, 5, 6]
    );
    const q = Number(s?.totalItemQuantity) || 0;
    const amt = Number(s?.totalItemAmount) || 0;
    const avg = q > 0 ? `, rata-rata ${fmtMoney(amt / q)}/unit` : "";
    return (
      `Faktur ${type === "purchase" ? "pembelian" : "penjualan"} yang memuat barang "${itemName}" (${periodStr}${entity ? `, ${partyLabel} ${entity}` : ""}) — ` +
      `${matched} faktur, total ${q} unit senilai ${fmtMoney(amt)}${avg}:\n\n${tbl}` +
      (invoices.length > 30 ? `\n\n… dan ${invoices.length - 30} faktur lainnya.` : "")
    );
  },

  "receivables.summary": (r) => {
    // mode beberapa tahun → total piutang per tahun (utk "piutang tahun X dan tahun Y")
    if (Array.isArray(r.byYears)) {
      const by = r.byYears as Array<Record<string, unknown>>;
      const tbl = mdTable(
        ["Tahun", "Total", "Faktur", "Pelanggan"],
        by.map((b) => [
          nameOf(b, "year"),
          fmtMoney(b.total),
          String(b.invoiceCount ?? 0),
          String(b.customerCount ?? 0),
        ]),
        [1, 2, 3]
      );
      return `Piutang usaha per tahun (transaksi tahun terkait yang masih belum dibayar):\n\n${tbl}`;
    }
    const s = r.summary as Record<string, unknown> | undefined;
    const total = Number(s?.totalReceivables) || 0;
    const count = Number(s?.invoiceCount) || 0;
    if (count === 0) return "Tidak ada piutang usaha yang belum dibayar.";
    const customers = Array.isArray(r.customers) ? (r.customers as Record<string, unknown>[]) : [];
    const tbl = mdTable(
      ["No", "Pelanggan", "Faktur", "Tagihan"],
      customers.slice(0, 10).map((c, i) => [
        String(i + 1),
        nameOf(c, "name", "customerName"),
        String(c.invoiceCount ?? 0),
        fmtMoney(c.total),
      ]),
      [2, 3]
    );
    const top3 = customers.slice(0, 3);
    const top3Total = top3.reduce((s, c) => s + (Number(c.total) || 0), 0);
    const top3Count = top3.reduce((s, c) => s + (Number(c.invoiceCount) || 0), 0);
    const top3Line =
      top3.length >= 3 ? `\nGabungan 3 pelanggan terbesar: ${fmtMoney(top3Total)} dari ${top3Count} faktur.` : "";
    const due = r.earliestDue as Record<string, unknown> | undefined;
    const dueLine = due
      ? `\nJatuh tempo terdekat: ${fmtDate(due.dueDate)} — faktur ${nameOf(due, "number")} (${nameOf(due, "customerName")}) senilai ${fmtMoney(due.totalAmount)}.`
      : "";
    return `Total piutang usaha: ${fmtMoney(total)} dari ${count} faktur.\n\nPelanggan dengan tagihan terbesar:\n\n${tbl}${top3Line}${dueLine}`;
  },

  "payables.summary": (r) => {
    const s = r.summary as Record<string, unknown> | undefined;
    const total = Number(s?.totalPayables) || 0;
    const count = Number(s?.invoiceCount) || 0;
    if (count === 0) return "Tidak ada utang usaha yang belum dibayar.";
    const vendors = Array.isArray(r.vendors) ? (r.vendors as Record<string, unknown>[]) : [];
    const tbl = mdTable(
      ["No", "Pemasok", "Faktur", "Tagihan"],
      vendors.slice(0, 10).map((v, i) => [
        String(i + 1),
        nameOf(v, "name", "vendorName"),
        String(v.invoiceCount ?? 0),
        fmtMoney(v.total),
      ]),
      [2, 3]
    );
    const top3 = vendors.slice(0, 3);
    const top3Total = top3.reduce((s, v) => s + (Number(v.total) || 0), 0);
    const top3Count = top3.reduce((s, v) => s + (Number(v.invoiceCount) || 0), 0);
    const top3Line =
      top3.length >= 3 ? `\nGabungan 3 pemasok terbesar: ${fmtMoney(top3Total)} dari ${top3Count} faktur.` : "";
    return `Total utang usaha: ${fmtMoney(total)} dari ${count} faktur.\n\nPemasok dengan tagihan terbesar:\n\n${tbl}${top3Line}`;
  },

  "gl.plSummary": (r) => {
    const period = r.period as Record<string, unknown> | undefined;
    const from = nameOf(period, "fromDate");
    const to = nameOf(period, "toDate");
    const s = r.summary as Record<string, unknown> | undefined;
    const revenue = Number(s?.revenue) || 0;
    const cogs = Number(s?.costOfGoodsSold) || 0;
    const gross = Number(s?.grossProfit) || 0;
    const opex = Number(s?.operatingExpense) || 0;
    const net = Number(s?.netProfit) || 0;
    return (
      `Laba rugi ${from}–${to}:\n` +
      `• Pendapatan: ${fmtMoney(revenue)}\n` +
      `• Harga pokok penjualan: ${fmtMoney(cogs)}\n` +
      `• Laba kotor: ${fmtMoney(gross)}\n` +
      `• Beban operasional: ${fmtMoney(opex)}\n` +
      `• Laba bersih: ${fmtMoney(net)}`
    );
  },

  "gl.bsSummary": (r) => {
    const period = r.period as Record<string, unknown> | undefined;
    const asOf = nameOf(period, "asOfDate");
    const s = r.summary as Record<string, unknown> | undefined;
    const assets = Number(s?.totalAssets) || 0;
    const liabilities = Number(s?.totalLiabilities) || 0;
    const equity = Number(s?.totalEquity) || 0;
    return (
      `Posisi keuangan per ${asOf}:\n` +
      `• Total aset: ${fmtMoney(assets)}\n` +
      `• Total kewajiban (utang): ${fmtMoney(liabilities)}\n` +
      `• Modal: ${fmtMoney(equity)}`
    );
  },

  "finance.overview": (r) => {
    const period = r.period as Record<string, unknown> | undefined;
    const from = nameOf(period, "fromDate");
    const to = nameOf(period, "toDate");
    const pl = r.labaRugi as Record<string, unknown> | undefined;
    const bs = r.posisiKeuangan as Record<string, unknown> | undefined;
    const sales = r.penjualan as Record<string, unknown> | undefined;
    const purchase = r.pembelian as Record<string, unknown> | undefined;
    const lines = [`Laporan keuangan ${from}–${to}:`];
    if (pl) {
      lines.push(`\nLaba rugi:`);
      lines.push(`• Pendapatan: ${fmtMoney(pl.revenue)}`);
      lines.push(`• Laba kotor: ${fmtMoney(pl.grossProfit)}`);
      lines.push(`• Laba bersih: ${fmtMoney(pl.netProfit)}`);
    }
    if (bs) {
      lines.push(`\nPosisi keuangan:`);
      lines.push(`• Total aset: ${fmtMoney(bs.totalAssets)}`);
      lines.push(`• Total utang: ${fmtMoney(bs.totalLiabilities)}`);
      lines.push(`• Modal: ${fmtMoney(bs.totalEquity)}`);
    }
    if (sales) lines.push(`\nPenjualan: ${fmtMoney(sales.totalSales)} dari ${sales.invoiceCount ?? 0} faktur`);
    if (purchase) lines.push(`Pembelian: ${fmtMoney(purchase.totalPurchase)} dari ${purchase.invoiceCount ?? 0} faktur`);
    return lines.length > 1 ? lines.join("\n") : null;
  },

  "cashflow.summary": (r) => {
    const period = r.period as Record<string, unknown> | undefined;
    const from = nameOf(period, "fromDate");
    const to = nameOf(period, "toDate");
    const s = r.summary as Record<string, unknown> | undefined;
    const cashIn = Number(s?.totalCashIn) || 0;
    const cashOut = Number(s?.totalCashOut) || 0;
    const net = cashIn - cashOut;
    return (
      `Arus kas ${from}–${to}:\n` +
      `• Kas masuk: ${fmtMoney(cashIn)}\n` +
      `• Kas keluar: ${fmtMoney(cashOut)}\n` +
      `• Selisih: ${fmtMoney(net)}`
    );
  },

  "module.recordCount": (r) => {
    const results = Array.isArray(r.results) ? (r.results as Array<Record<string, unknown>>) : [];
    if (results.length === 0) return null;
    const out: string[] = [];
    for (const e of results) {
      const label = String(e.label ?? e.module ?? "record");
      const counts = e.counts as Record<string, number> | undefined;
      const matches = Array.isArray(e.matches) ? (e.matches as Array<Record<string, unknown>>) : undefined;
      if (counts && Object.keys(counts).length > 0) {
        const entries = Object.entries(counts);
        if (entries.length === 1) out.push(`Ada ${entries[0][1]} ${label} tahun ${entries[0][0]}.`);
        else out.push(`${label} per tahun: ${entries.map(([y, n]) => `${y} = ${n}`).join(", ")}.`);
      } else if (!matches) {
        out.push(`Ada ${Number(e.count) || 0} ${label} tercatat.`);
      }
      if (Array.isArray(e.names) && (e.names as unknown[]).length > 0) {
        const names = (e.names as unknown[]).map((n) => String(n));
        out.push(`Daftar ${label} (${names.length}): ${names.join(", ")}.`);
      }
      const latest = e.latest as Record<string, unknown> | undefined;
      if (latest && typeof latest === "object") {
        const amt = latest.totalAmount !== null && latest.totalAmount !== undefined && Number(latest.totalAmount) !== 0
          ? ` senilai ${fmtMoney(latest.totalAmount)}`
          : "";
        out.push(`Transaksi ${label} terbaru: ${nameOf(latest, "number")} tanggal ${nameOf(latest, "transDate")}${amt}.`);
      }
      if (Array.isArray(e.byYear) && (e.byYear as unknown[]).length > 0) {
        const by = e.byYear as Array<Record<string, unknown>>;
        const top = by[0];
        out.push(
          `Tahun dengan record terbanyak: ${nameOf(top, "year")} (${Number(top.count) || 0}). ` +
            `Rincian: ${by.map((b) => `${nameOf(b, "year")}: ${Number(b.count) || 0}`).join(", ")}.`
        );
      }
      const sum = e.sum as Record<string, unknown> | undefined;
      if (sum && typeof sum === "object") {
        out.push(
          sum.total === null || sum.total === undefined
            ? `Total ${String(sum.column)}: tidak tersedia di daftar.`
            : `Total ${String(sum.column)}: ${Number(sum.total) || 0}.`
        );
      }
      if (matches && matches.length > 0) {
        const tbl = mdTable(
          ["No", "Nama", "Kode", "Nomor", "Tanggal", "Jumlah"],
          matches.slice(0, 15).map((m, i) => {
            const nm = nameOf(m, "name", "description");
            const no = nameOf(m, "no");
            const num = nameOf(m, "number");
            const dt = nameOf(m, "transDate");
            const qty = m.quantity !== null && m.quantity !== undefined ? String(Number(m.quantity)) : "-";
            return [String(i + 1), nm, no, num && num !== no ? num : "-", dt, qty];
          }),
          [5]
        );
        out.push(`Hasil pencarian:\n\n${tbl}`);
      }
      if (e.truncated) out.push(`(daftar terpotong — total di server ${Number(e.totalOnServer) || 0})`);
    }
    // pembanding utk persamaan 2 modul ("mana yang lebih banyak: A atau B")
    const plain = results.every(
      (e) => e.count !== undefined && !e.counts && !(Array.isArray(e.matches) && e.matches.length)
    );
    if (results.length === 2 && plain) {
      const [a, b] = results;
      const ca = Number(a.count) || 0;
      const cb = Number(b.count) || 0;
      const la = String(a.label ?? a.module);
      const lb = String(b.label ?? b.module);
      out.push(
        ca === cb
          ? `Keduanya sama banyak: ${ca} ${la} dan ${cb} ${lb}.`
          : `${ca > cb ? la : lb} lebih banyak: ${Math.max(ca, cb)} vs ${Math.min(ca, cb)} (${ca > cb ? lb : la}).`
      );
    }
    return out.length ? out.join("\n") : null;
  },

  "party.cardBalance": (r) => {
    const rows = Array.isArray(r.rows) ? (r.rows as Array<Record<string, unknown>>) : [];
    if (rows.length === 0) return null;
    const side = String(r.side) === "vendor" ? "pemasok" : "pelanggan";
    const tbl = mdTable(
      ["No", "Nama", "No. Kartu", "Saldo"],
      rows.map((x, i) => [String(i + 1), nameOf(x, "name"), nameOf(x, "no"), fmtMoney(x.balance)]),
      [3]
    );
    return `Kartu ${side} dengan saldo terbesar (dari kolom balance master):\n\n${tbl}`;
  },

  "salePurchase.summaryBoth": (r) => {
    const s = r.sales as Record<string, unknown> | undefined;
    const p = r.purchase as Record<string, unknown> | undefined;
    if (!s || !p) return null;
    const period = r.period;
    const periodStr =
      typeof period === "object" && period
        ? `${nameOf(period as Record<string, unknown>, "fromDate")}–${nameOf(period as Record<string, unknown>, "toDate")}`
        : "seluruh periode";
    const combined = (r.combined as Record<string, unknown> | undefined)?.total;
    return (
      `Penjualan & pembelian ${periodStr}:\n` +
      `• Penjualan: ${fmtMoney(s.total)} dari ${s.invoiceCount ?? 0} faktur\n` +
      `• Pembelian: ${fmtMoney(p.total)} dari ${p.invoiceCount ?? 0} faktur` +
      (combined !== undefined ? `\n• Gabungan: ${fmtMoney(combined)}` : "")
    );
  },

  "party.topByYears": (r) => {
    const party = String(r.party) === "vendor" ? "pemasok" : "pelanggan";
    const unit = String(r.unit) === "pembelian" ? "pembelian" : "penjualan";
    const periods = Array.isArray(r.periods) ? (r.periods as Array<Record<string, unknown>>) : [];
    if (periods.length === 0) return null;
    const rows: string[][] = [];
    const empty: string[] = [];
    for (const p of periods) {
      const top = Array.isArray(p.top) ? (p.top as Array<Record<string, unknown>>) : [];
      if (top.length === 0) {
        empty.push(`${nameOf(p, "year")}: tidak ada ${unit} ${party}.`);
        continue;
      }
      top.forEach((t, i) => {
        rows.push([
          nameOf(p, "year"),
          String(i + 1),
          nameOf(t, "name"),
          nameOf(t, "code"),
          fmtMoney(t.total),
          String(t.invoiceCount ?? 0),
        ]);
      });
    }
    const heads = periods.map((p) => {
      const top = Array.isArray(p.top) ? (p.top as Array<Record<string, unknown>>) : [];
      return top.length ? nameOf(top[0], "name") : "";
    });
    let concl = "";
    if (heads.length >= 2 && heads.every((h) => h && h === heads[0])) {
      concl = `\nKesimpulan: ${party} terbesar SAMA pada kedua tahun — ${heads[0]}.`;
    }
    const body = rows.length
      ? mdTable(["Tahun", "No", "Nama", "Kode", "Nilai", "Faktur"], rows, [4, 5]) + empty.map((e) => `\n${e}`).join("")
      : empty.join("\n");
    return `${party === "pelanggan" ? "Pelanggan" : "Pemasok"} dengan ${unit} terbesar per tahun:\n\n${body}${concl}`;
  },

  "jobOrder.summary": (r) => {
    const count = Number(r.count) || 0;
    if (!count) return "Tidak ada job order tercatat.";
    const total = Number(r.totalValue) || 0;
    const big = r.biggest as Record<string, unknown> | null | undefined;
    const lines = [`Ada ${count} job order tercatat dengan total nilai ${fmtMoney(total)}.`];
    if (big) {
      const nm = nameOf(big, "name");
      lines.push(
        `Job order dengan nilai terbesar: ${nameOf(big, "number")}${nm && nm !== "-" ? ` (${nm})` : ""} — ${fmtMoney(big.totalAmount)}.`
      );
    }
    return lines.join("\n");
  },
};

/**
 * Format hasil agregasi ke teks natural. Kembalikan null bila:
 * - result mengandung `error` (caller tampilkan pesan error-nya saja)
 * - bentuk result tidak cocok dgn ekspektasi (caller jatuh ke tool loop)
 */
export function formatAggregationResult(tool: string, result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  // error dari adapter → kembalikan sebagai teks (sudah user-friendly)
  if (typeof r.error === "string") {
    const hint = typeof r.hint === "string" ? `\n${r.hint}` : "";
    return `Maaf, ${r.error}.${hint}`;
  }
  const fmt = FORMATTERS[tool];
  if (!fmt) return null;
  return fmt(r);
}
