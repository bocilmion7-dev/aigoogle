import type { ToolSpec, ProviderCtx } from "./types.js";

/**
 * Tool AGREGASI — satu tool yang di-expose ke LLM, tapi di dalamnya memanggil
 * beberapa endpoint Accurate secara berurutan (search → list → detail) dan
 * mengembalikan hasil FINAL sekali. Tujuannya memangkas jumlah putaran LLM:
 * alih-alih model memanggil customer.list → salesInvoice.list → detail (3 putaran,
 * ~45-60 dtk), cukup SATU tool (~1 putaran). Hit API Accurate sendiri cepat (<1 dtk),
 * jadi batas total pencarian harus < 20 dtk.
 *
 * Tool agregasi TIDAK masuk ACCURATE_CATALOG (yang dikunci 366 oleh test) —
 * mereka digabung di capabilityCatalog() dan ditangani khusus di execute().
 */

export interface AggToolSpec extends ToolSpec {
  /** modul yang butuh izin utk menjalankan agregasi ini (semua harus dimiliki) */
  requires: string[];
}

/** nama tool agregasi → deskripsi & skema utk LLM */
export const AGGREGATION_TOOLS: AggToolSpec[] = [
  {
    name: "customer.lastOrderByName",
    description:
      "Pesanan/faktur penjualan TERAKHIR dari pelanggan berdasarkan NAMA — tidak perlu tahu ID. " +
      "Langsung pakai tool ini bila user menyebut nama pelanggan & ingin transaksi terakhirnya (mis. \"pesanan terakhir Abadi Jaya\"). " +
      "Mengembalikan data pelanggan LENGKAP (customerNo, nama, email, telepon, saldo) + faktur terakhir — TIDAK perlu memanggil customer.list lagi. " +
      "Argumen: name = nama pelanggan (boleh sebagian, mis. \"Abadi\").",
    jsonSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Nama pelanggan (boleh sebagian, mis. 'Abadi')" } },
      required: ["name"],
    },
    requiredPermission: "accurate:customer.view",
    requires: ["accurate:customer.view", "accurate:sales-invoice.view"],
    label: "Mencari pesanan terakhir pelanggan…",
  },
  {
    name: "customer.unpaidByName",
    description:
      "Total piutang BELUM DIBAYAR (unpaid) dari pelanggan berdasarkan NAMA — tidak perlu tahu ID. " +
      "Langsung pakai tool ini bila user menyebut nama pelanggan & ingin sisa piutangnya. " +
      "Mengembalikan data pelanggan LENGKAP + daftar faktur belum lunas — TIDAK perlu customer.list lagi. " +
      "Argumen: name = nama pelanggan (boleh sebagian).",
    jsonSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Nama pelanggan (boleh sebagian, mis. 'Abadi')" } },
      required: ["name"],
    },
    requiredPermission: "accurate:customer.view",
    requires: ["accurate:customer.view", "accurate:sales-invoice.view"],
    label: "Menghitung piutang pelanggan…",
  },
  {
    name: "customer.summaryByName",
    description:
      "Ringkasan pelanggan berdasarkan NAMA: data pelanggan lengkap (customerNo, nama, email, telepon, saldo), jumlah & total faktur penjualan, piutang, serta pesanan terakhir — dalam SATU tool. " +
      "Gunakan bila user menanyakan kondisi/riwayat pelanggan secara umum. Cukup tool ini — JANGAN tambah customer.list. " +
      "Argumen: name = nama pelanggan (boleh sebagian).",
    jsonSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Nama pelanggan (boleh sebagian, mis. 'Abadi')" } },
      required: ["name"],
    },
    requiredPermission: "accurate:customer.view",
    requires: ["accurate:customer.view", "accurate:sales-invoice.view"],
    label: "Menyusun ringkasan pelanggan…",
  },
  {
    name: "salesInvoice.summary",
    description:
      "Ringkasan penjualan per periode: total nilai, jumlah faktur, rata-rata, dan daftar ringkas — dalam SATU tool. " +
      "Argumen: fromDate & toDate (format dd/mm/yyyy). Bila kosong, default = bulan berjalan.",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, cth: 01/10/2026)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, cth: 17/10/2026)" },
      },
    },
    requiredPermission: "accurate:sales-invoice.view",
    requires: ["accurate:sales-invoice.view"],
    label: "Menyusun ringkasan penjualan…",
  },
  {
    name: "purchaseInvoice.summary",
    description:
      "Ringkasan pembelian per periode: total nilai, jumlah faktur, rata-rata, dan daftar ringkas — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"total pembelian bulan ini\" — JANGAN pakai purchaseInvoice.list + jumlahkan sendiri. " +
      "Argumen: fromDate & toDate (format dd/mm/yyyy). Bila kosong, default = bulan berjalan.",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, cth: 01/10/2026)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, cth: 17/10/2026)" },
      },
    },
    requiredPermission: "accurate:purchase-invoice.view",
    requires: ["accurate:purchase-invoice.view"],
    label: "Menyusun ringkasan pembelian…",
  },
  {
    name: "vendor.lastPurchaseByName",
    description:
      "Faktur pembelian TERAKHIR dari pemasok berdasarkan NAMA — tidak perlu tahu ID. " +
      "Langsung pakai tool ini bila user menyebut nama pemasok/vendor & ingin transaksi terakhirnya. " +
      "Mengembalikan data pemasok LENGKAP (vendorNo, nama, email, telepon, saldo) + faktur terakhir — TIDAK perlu vendor.list lagi. " +
      "Argumen: name = nama pemasok (boleh sebagian, mis. \"CV Sentosa\").",
    jsonSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Nama pemasok (boleh sebagian, mis. 'CV Sentosa')" } },
      required: ["name"],
    },
    requiredPermission: "accurate:vendor.view",
    requires: ["accurate:vendor.view", "accurate:purchase-invoice.view"],
    label: "Mencari pembelian terakhir pemasok…",
  },
  {
    name: "vendor.unpaidByName",
    description:
      "Total utang BELUM DIBAYAR (unpaid) dari pemasok berdasarkan NAMA — tidak perlu tahu ID. " +
      "Langsung pakai tool ini bila user menyebut nama pemasok & ingin sisa utangnya (\"utang belum dibayar vendor X\"). " +
      "Mengembalikan data pemasok LENGKAP + daftar faktur belum lunas — TIDAK perlu vendor.list lagi. " +
      "Argumen: name = nama pemasok (boleh sebagian).",
    jsonSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Nama pemasok (boleh sebagian)" } },
      required: ["name"],
    },
    requiredPermission: "accurate:vendor.view",
    requires: ["accurate:vendor.view", "accurate:purchase-invoice.view"],
    label: "Menghitung utang pemasok…",
  },
  {
    name: "vendor.summaryByName",
    description:
      "Ringkasan pemasok berdasarkan NAMA: data pemasok lengkap (vendorNo, nama, email, telepon, saldo), jumlah & total faktur pembelian, utang belum lunas, serta pembelian terakhir — dalam SATU tool. " +
      "Gunakan bila user menanyakan kondisi/riwayat pemasok secara umum. Cukup tool ini — JANGAN tambah vendor.list. " +
      "Argumen: name = nama pemasok (boleh sebagian).",
    jsonSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Nama pemasok (boleh sebagian)" } },
      required: ["name"],
    },
    requiredPermission: "accurate:vendor.view",
    requires: ["accurate:vendor.view", "accurate:purchase-invoice.view"],
    label: "Menyusun ringkasan pemasok…",
  },
  {
    name: "salesInvoice.perCustomer",
    description:
      "Rincian penjualan dikelompokkan per pelanggan untuk satu periode: nama+kode pelanggan, jumlah faktur, total nilai — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"rincikan penjualan per pelanggan\" — JANGAN tarik semua halaman salesInvoice.list. " +
      "Argumen: fromDate & toDate (dd/mm/yyyy). Bila kosong, default = bulan berjalan.",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, cth: 01/10/2026)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, cth: 17/10/2026)" },
      },
    },
    requiredPermission: "accurate:sales-invoice.view",
    requires: ["accurate:sales-invoice.view"],
    label: "Mengelompokkan penjualan per pelanggan…",
  },
  {
    name: "item.topSelling",
    description:
      "Barang PALING LARIS pada satu periode (diurutkan dari jumlah terjual) — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"barang apa yang paling laris / terlaris bulan ini\" — JANGAN pakai item.list / salesInvoice.list + detail satu per satu. " +
      "Argumen: fromDate & toDate (dd/mm/yyyy, default bulan berjalan), limit (jumlah baris, default 10).",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, cth: 01/10/2026)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, cth: 17/10/2026)" },
        limit: { type: "number", description: "Jumlah barang teratas (default 10)" },
      },
    },
    requiredPermission: "accurate:sales-invoice.view",
    requires: ["accurate:sales-invoice.view"],
    label: "Menghitung barang terlaris…",
  },
  {
    name: "receivables.summary",
    description:
      "Piutang usaha GLOBAL (seluruh pelanggan): total piutang belum dibayar, jumlah faktur, " +
      "serta daftar pelanggan terbesar beserta tagihannya — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"berapa total piutang perusahaan\" / \"siapa yang paling banyak berutang\". " +
      "Untuk piutang SATU pelanggan pakai customer.unpaidByName; untuk daftar semua pelanggan pakai receivables.summary ini. " +
      "Argumen: limit (jumlah pelanggan teratas, default 10).",
    jsonSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Jumlah pelanggan teratas (default 10)" } },
    },
    requiredPermission: "accurate:sales-invoice.view",
    requires: ["accurate:sales-invoice.view", "accurate:customer.view"],
    label: "Menghitung total piutang usaha…",
  },
  {
    name: "payables.summary",
    description:
      "Utang usaha GLOBAL (seluruh pemasok): total utang belum dibayar, jumlah faktur pembelian, " +
      "serta daftar pemasok terbesar beserta tagihannya — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"berapa total utang perusahaan\" / \"utang ke pemasok mana terbesar\". " +
      "Untuk utang SATU pemasok pakai vendor.unpaidByName. " +
      "Argumen: limit (jumlah pemasok teratas, default 10).",
    jsonSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Jumlah pemasok teratas (default 10)" } },
    },
    requiredPermission: "accurate:purchase-invoice.view",
    requires: ["accurate:purchase-invoice.view", "accurate:vendor.view"],
    label: "Menghitung total utang usaha…",
  },
  {
    name: "gl.plSummary",
    description:
      "Ringkasan laba/rugi (P&L) satu periode dalam SATU panggilan: pendapatan, harga pokok penjualan, " +
      "laba kotor, beban operasional, pendapatan & beban lainnya, serta laba bersih — " +
      "langsung dihitung dari seluruh akun P&L di buku besar. " +
      "Langsung pakai tool ini utk \"berapa laba/rugi bulan ini\" — JANGAN panggil glaccount.get-pl-account-amount lagi. " +
      "Argumen: fromDate & toDate (dd/mm/yyyy). Bila kosong, default = bulan berjalan.",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, cth: 01/10/2026)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, cth: 31/10/2026)" },
      },
    },
    requiredPermission: "accurate:glaccount.view",
    requires: ["accurate:glaccount.view"],
    label: "Menghitung laba rugi…",
  },
];

export const AGGREGATION_NAMES = new Set(AGGREGATION_TOOLS.map((t) => t.name));

/** helper: ekstrak array dari hasil execute (d atau {items}) */
function asArray(v: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.items)) return o.items as Array<Record<string, unknown>>;
    if (Array.isArray(o.d)) return o.d as Array<Record<string, unknown>>;
  }
  return [];
}

/** helper: meta paginasi dari envelope .list ({items, page, pageSize, total, pageCount}) */
function metaOf(v: unknown): { total: number; pageCount: number } {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o.total === "number" || typeof o.pageCount === "number") {
      return { total: Number(o.total ?? 0), pageCount: Number(o.pageCount ?? 0) };
    }
  }
  const rows = asArray(v);
  return { total: rows.length, pageCount: rows.length ? 1 : 0 };
}

/**
 * Tarik SEMUA halaman satu list (pageSize 1000, maks 5 halaman = 5000 baris) —
 * agregasi dulu hanya baca page pertama (pageSize≤100) → total bisa salah hitung
 * diam-diam di data besar. Meta total dari server ikut dikembalikan utk
 * deteksi pemotongan: truncated=true bila baris yg diambil < total di server.
 */
async function listAllPages(
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  tool: string,
  args: Record<string, unknown>
): Promise<{ rows: Array<Record<string, unknown>>; total: number; pageCount: number; truncated: boolean }> {
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 5;
  const first = await execute(tool, { ...args, pageSize: PAGE_SIZE, page: 1 });
  const rows = asArray(first);
  const { total, pageCount } = metaOf(first);
  const pages = Math.min(MAX_PAGES, Math.max(pageCount, 1));
  for (let page = 2; page <= pages; page++) {
    const next = asArray(await execute(tool, { ...args, pageSize: PAGE_SIZE, page }));
    if (!next.length) break;
    rows.push(...next);
  }
  return { rows, total, pageCount, truncated: rows.length < total };
}

/** cari pelanggan by nama → kembalikan baris pelanggan pertama yg cocok (atau null) */
async function findCustomer(
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  name: string
): Promise<Record<string, unknown> | null> {
  const rows = asArray(await execute("customer.list", { keywords: name, pageSize: 10 }));
  const q = String(name ?? "").trim().toLowerCase();
  const hit =
    rows.find((r) => String(r.name ?? "").toLowerCase().includes(q) || String(r.customerNo ?? "").toLowerCase().includes(q)) ??
    rows[0];
  return hit ?? null;
}

/**
 * Baris entitas LENGKAP utk output agregasi (tanpa id internal: customerNo/vendorNo,
 * nama, email, telepon, saldo) — model yang membandingkan dengan output .list
 * tidak akan merasa kekurangan data → tak memanggil .list lagi (hemat putaran).
 */
function publicInfo(row: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, ...rest } = row;
  return rest;
}

/** ambil faktur penjualan pelanggan (customerNo) — SEMUA halaman; opts.limit = cukup N teratas */
async function customerInvoices(
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  customerNo: string,
  opts: { limit?: number } = {}
): Promise<{ rows: Array<Record<string, unknown>>; total: number; truncated: boolean }> {
  // catatan (diverifikasi ke API asli): filter pakai VALUE LANGSUNG filter.customerNo=CSBY-0005.
  // Bentuk objek {customerNo:{op,value}} DITOLAK ("Pelanggan tidak tepat"), argumen top-level
  // customerNo="…" diabaikan (tidak memfilter) → baris pelanggan lain bisa bocor.
  const base = { filter: { customerNo }, sort: "id|desc" };
  const fetched =
    opts.limit !== undefined
      ? await (async () => {
          const res = await execute("salesInvoice.list", { ...base, pageSize: opts.limit, page: 1 });
          const rows = asArray(res);
          const meta = metaOf(res);
          return { rows, total: meta.total || rows.length, truncated: false };
        })()
      : await listAllPages(execute, "salesInvoice.list", base);
  // scoping defensif by customerNo (API asli sudah memfilter; bila mock mengabaikan filter,
  // saring manual — dan 0 cocok berarti memang tak ada faktur, JANGAN kembalikan baris mentah)
  const cno = String(customerNo);
  const rows = fetched.rows.filter(
    (r) => String(r.customerNo ?? "") === cno || String((r.customer as Record<string, unknown>)?.customerNo ?? "") === cno
  );
  return { rows, total: fetched.total, truncated: fetched.truncated };
}

/** faktur BELUM LUNAS — filter.outstanding=true di server (approvalStatus ≠ lunas), semua halaman */
async function customerUnpaidInvoices(
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  customerNo: string
): Promise<{ rows: Array<Record<string, unknown>>; total: number; truncated: boolean }> {
  // diverifikasi ke API asli: filter.customerNo + filter.outstanding=true (value langsung)
  // mengembalikan hanya faktur belum lunas — padahal approvalStatus semuanya APPROVED.
  const fetched = await listAllPages(execute, "salesInvoice.list", {
    filter: { customerNo, outstanding: true },
    sort: "id|desc",
  });
  const cno = String(customerNo);
  const rows = fetched.rows.filter(
    (r) => String(r.customerNo ?? "") === cno || String((r.customer as Record<string, unknown>)?.customerNo ?? "") === cno
  );
  return { rows, total: fetched.total, truncated: fetched.truncated };
}

/**
 * Periode dd/mm/yyyy utk tool ringkasan — default BULAN BERJALAN
 * (selaras dgn deskripsi tool & system prompt; dulu defaultnya "hari ini"
 * padahal deskripsi bilang bulan berjalan). toDate kosong → akhir bulan dari fromDate.
 */
function periodOf(args: Record<string, unknown>): { from: string; to: string } {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const monthStart = `01/${p(now.getMonth() + 1)}/${now.getFullYear()}`;
  const endOfMonthOf = (from: string): string => {
    const m = from.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return from;
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    if (mm < 1 || mm > 12) return from;
    const last = new Date(yyyy, mm, 0).getDate();
    return `${p(last)}/${p(mm)}/${yyyy}`;
  };
  const from = String(args.fromDate ?? monthStart);
  const to = String(args.toDate ?? endOfMonthOf(from));
  return { from, to };
}

/** cari pemasok by nama → baris pertama yg cocok (atau null) — mirror findCustomer */
async function findVendor(
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  name: string
): Promise<Record<string, unknown> | null> {
  const rows = asArray(await execute("vendor.list", { keywords: name, pageSize: 10 }));
  const q = String(name ?? "").trim().toLowerCase();
  const hit =
    rows.find((r) => String(r.name ?? "").toLowerCase().includes(q) || String(r.vendorNo ?? "").toLowerCase().includes(q)) ??
    rows[0];
  return hit ?? null;
}

/** faktur pembelian pemasok (vendorNo), urut id desc — SEMUA halaman; opts.limit = N teratas */
async function vendorInvoices(
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  vendorNo: string,
  opts: { limit?: number } = {}
): Promise<{ rows: Array<Record<string, unknown>>; total: number; truncated: boolean }> {
  // filter vendorNo value langsung — diverifikasi live ke API asli (60ms, terekstrak benar)
  const base = { filter: { vendorNo }, sort: "id|desc" };
  const fetched =
    opts.limit !== undefined
      ? await (async () => {
          const res = await execute("purchaseInvoice.list", { ...base, pageSize: opts.limit, page: 1 });
          const rows = asArray(res);
          const meta = metaOf(res);
          return { rows, total: meta.total || rows.length, truncated: false };
        })()
      : await listAllPages(execute, "purchaseInvoice.list", base);
  const vno = String(vendorNo);
  // scoping defensif (mock boleh abaikan filter) — sama dgn customerInvoices
  const rows = fetched.rows.filter(
    (r) => String(r.vendorNo ?? "") === vno || String((r.vendor as Record<string, unknown>)?.vendorNo ?? "") === vno
  );
  return { rows, total: fetched.total, truncated: fetched.truncated };
}

/** faktur pembelian BELUM DIBAYAR — filter.outstanding=true (diverifikasi live), semua halaman */
async function vendorUnpaidInvoices(
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  vendorNo: string
): Promise<{ rows: Array<Record<string, unknown>>; total: number; truncated: boolean }> {
  const fetched = await listAllPages(execute, "purchaseInvoice.list", {
    filter: { vendorNo, outstanding: true },
    sort: "id|desc",
  });
  const vno = String(vendorNo);
  const rows = fetched.rows.filter(
    (r) => String(r.vendorNo ?? "") === vno || String((r.vendor as Record<string, unknown>)?.vendorNo ?? "") === vno
  );
  return { rows, total: fetched.total, truncated: fetched.truncated };
}

/** eksekusi fn per item dgn batas konkurensi — utk detail faktur (topSelling) */
async function mapPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

export async function runAggregation(
  tool: string,
  args: Record<string, unknown>,
  ctx: ProviderCtx,
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>
): Promise<unknown> {
  switch (tool) {
    case "customer.lastOrderByName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const customer = await findCustomer(execute, name);
      if (!customer) return { error: `pelanggan "${name}" tidak ditemukan` };
      const invoices = await customerInvoices(execute, String(customer.customerNo ?? ""), { limit: 1 });
      return {
        customer: publicInfo(customer),
        lastOrder: invoices.rows[0] ?? null,
      };
    }
    case "customer.unpaidByName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const customer = await findCustomer(execute, name);
      if (!customer) return { error: `pelanggan "${name}" tidak ditemukan` };
      const { rows: unpaid, truncated } = await customerUnpaidInvoices(execute, String(customer.customerNo ?? ""));
      const totalUnpaid = unpaid.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      return {
        customer: publicInfo(customer),
        totalUnpaid,
        countUnpaid: unpaid.length,
        unpaid: unpaid.slice(0, 20),
        ...(truncated ? { truncated } : {}),
      };
    }
    case "customer.summaryByName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const customer = await findCustomer(execute, name);
      if (!customer) return { error: `pelanggan "${name}" tidak ditemukan` };
      const inv = await customerInvoices(execute, String(customer.customerNo ?? ""));
      const total = inv.rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      const up = await customerUnpaidInvoices(execute, String(customer.customerNo ?? ""));
      const totalUnpaid = up.rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      const truncated = inv.truncated || up.truncated;
      return {
        customer: publicInfo(customer),
        summary: {
          invoiceCount: inv.rows.length,
          totalSales: total,
          unpaidCount: up.rows.length,
          totalUnpaid,
          ...(truncated ? { truncated } : {}),
        },
        lastOrder: inv.rows[0] ?? null,
      };
    }
    case "salesInvoice.summary": {
      const { from, to } = periodOf(args);
      const all = await listAllPages(execute, "salesInvoice.list", {
        filter: { transDate: { op: "BETWEEN", value: [from, to] } },
        sort: "id|desc",
      });
      const rows = all.rows;
      const total = rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      return {
        period: { fromDate: from, toDate: to },
        summary: {
          invoiceCount: rows.length,
          totalSales: total,
          average: rows.length ? Math.round(total / rows.length) : 0,
          ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
        },
        invoices: rows.slice(0, 20),
      };
    }
    case "purchaseInvoice.summary": {
      const { from, to } = periodOf(args);
      const all = await listAllPages(execute, "purchaseInvoice.list", {
        filter: { transDate: { op: "BETWEEN", value: [from, to] } },
        sort: "id|desc",
      });
      const rows = all.rows;
      const total = rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      return {
        period: { fromDate: from, toDate: to },
        summary: {
          invoiceCount: rows.length,
          totalPurchase: total,
          average: rows.length ? Math.round(total / rows.length) : 0,
          ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
        },
        invoices: rows.slice(0, 20),
      };
    }
    case "vendor.lastPurchaseByName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const vendor = await findVendor(execute, name);
      if (!vendor) return { error: `pemasok "${name}" tidak ditemukan` };
      const invoices = await vendorInvoices(execute, String(vendor.vendorNo ?? ""), { limit: 1 });
      return {
        vendor: publicInfo(vendor),
        lastPurchase: invoices.rows[0] ?? null,
      };
    }
    case "vendor.unpaidByName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const vendor = await findVendor(execute, name);
      if (!vendor) return { error: `pemasok "${name}" tidak ditemukan` };
      const { rows: unpaid, truncated } = await vendorUnpaidInvoices(execute, String(vendor.vendorNo ?? ""));
      const totalUnpaid = unpaid.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      return {
        vendor: publicInfo(vendor),
        totalUnpaid,
        countUnpaid: unpaid.length,
        unpaid: unpaid.slice(0, 20),
        ...(truncated ? { truncated } : {}),
      };
    }
    case "vendor.summaryByName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const vendor = await findVendor(execute, name);
      if (!vendor) return { error: `pemasok "${name}" tidak ditemukan` };
      const inv = await vendorInvoices(execute, String(vendor.vendorNo ?? ""));
      const total = inv.rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      const up = await vendorUnpaidInvoices(execute, String(vendor.vendorNo ?? ""));
      const totalUnpaid = up.rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      const truncated = inv.truncated || up.truncated;
      return {
        vendor: publicInfo(vendor),
        summary: {
          invoiceCount: inv.rows.length,
          totalPurchase: total,
          unpaidCount: up.rows.length,
          totalUnpaid,
          ...(truncated ? { truncated } : {}),
        },
        lastPurchase: inv.rows[0] ?? null,
      };
    }
    case "salesInvoice.perCustomer": {
      const { from, to } = periodOf(args);
      const all = await listAllPages(execute, "salesInvoice.list", {
        filter: { transDate: { op: "BETWEEN", value: [from, to] } },
        sort: "id|desc",
      });
      const rows = all.rows;
      type Group = { customerNo: string; name: string; invoiceCount: number; total: number };
      const groups = new Map<string, Group>();
      for (const r of rows) {
        const cust = (r.customer ?? {}) as Record<string, unknown>;
        const cno = String(r.customerNo ?? cust.customerNo ?? "");
        const key = cno || String(cust.name ?? "") || "tanpa-kode";
        const g =
          groups.get(key) ?? { customerNo: cno, name: String(cust.name ?? cno), invoiceCount: 0, total: 0 };
        g.invoiceCount += 1;
        g.total += Number(r.totalAmount) || 0;
        groups.set(key, g);
      }
      const customers = [...groups.values()].sort((a, b) => b.total - a.total);
      const totalSales = customers.reduce((s, g) => s + g.total, 0);
      return {
        period: { fromDate: from, toDate: to },
        summary: {
          customerCount: customers.length,
          invoiceCount: rows.length,
          totalSales,
          ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
        },
        customers: customers.slice(0, 20),
      };
    }
    case "item.topSelling": {
      const { from, to } = periodOf(args);
      const limit = Math.max(1, Math.min(50, Number(args.limit ?? 10) || 10));
      const all = await listAllPages(execute, "salesInvoice.list", {
        filter: { transDate: { op: "BETWEEN", value: [from, to] } },
        sort: "id|desc",
      });
      const rows = all.rows;
      // detail per faktur: 59KB/row di API asli → batasi 100 faktur terakhir, konkurensi 6
      const SCAN_CAP = 100;
      const scanned = rows.slice(0, SCAN_CAP);
      const agg = new Map<string, { itemName: string; quantity: number; amount: number }>();
      let detailErrors = 0;
      await mapPool(scanned, 6, async (r) => {
        try {
          const d = await execute("salesInvoice.detail", { id: r.id });
          // API asli membalas objek faktur; mock membalas array 1 baris
          const inv = (Array.isArray(d) ? d[0] : d) as Record<string, unknown> | null;
          const items = Array.isArray(inv?.detailItem) ? (inv.detailItem as Array<Record<string, unknown>>) : [];
          for (const it of items) {
            const itemObj = (it.item ?? {}) as Record<string, unknown>;
            const nm = String(it.detailName ?? itemObj.name ?? "").trim();
            if (!nm) continue;
            const g = agg.get(nm) ?? { itemName: nm, quantity: 0, amount: 0 };
            g.quantity += Number(it.quantity) || 0;
            g.amount += Number(it.totalPrice) || 0;
            agg.set(nm, g);
          }
        } catch {
          detailErrors += 1;
        }
      });
      const items = [...agg.values()].sort((a, b) => b.quantity - a.quantity).slice(0, limit);
      const scanTruncated = rows.length > scanned.length;
      return {
        period: { fromDate: from, toDate: to },
        summary: {
          invoicesInPeriod: rows.length,
          invoicesScanned: scanned.length,
          detailErrors,
          itemCount: agg.size,
          ...(scanTruncated ? { scanTruncated: true } : {}),
          ...(all.truncated ? { listTruncated: true, totalOnServer: all.total } : {}),
        },
        items,
      };
    }
    case "receivables.summary": {
      const limit = Math.max(1, Math.min(50, Number(args.limit ?? 10) || 10));
      const all = await listAllPages(execute, "salesInvoice.list", {
        filter: { outstanding: true },
        sort: "id|desc",
      });
      type Group = { customerNo: string; name: string; invoiceCount: number; total: number };
      const groups = new Map<string, Group>();
      for (const r of all.rows) {
        const cust = (r.customer ?? {}) as Record<string, unknown>;
        const cno = String(r.customerNo ?? cust.customerNo ?? "");
        const key = cno || String(cust.name ?? "") || "tanpa-kode";
        const g = groups.get(key) ?? { customerNo: cno, name: String(cust.name ?? cno), invoiceCount: 0, total: 0 };
        g.invoiceCount += 1;
        g.total += Number(r.totalAmount) || 0;
        groups.set(key, g);
      }
      const customers = [...groups.values()].sort((a, b) => b.total - a.total);
      const totalReceivables = customers.reduce((s, g) => s + g.total, 0);
      return {
        summary: {
          totalReceivables,
          invoiceCount: all.rows.length,
          customerCount: customers.length,
          ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
        },
        customers: customers.slice(0, limit),
      };
    }
    case "payables.summary": {
      const limit = Math.max(1, Math.min(50, Number(args.limit ?? 10) || 10));
      const all = await listAllPages(execute, "purchaseInvoice.list", {
        filter: { outstanding: true },
        sort: "id|desc",
      });
      type Group = { vendorNo: string; name: string; invoiceCount: number; total: number };
      const groups = new Map<string, Group>();
      for (const r of all.rows) {
        const vend = (r.vendor ?? {}) as Record<string, unknown>;
        const vno = String(r.vendorNo ?? vend.vendorNo ?? "");
        const key = vno || String(vend.name ?? "") || "tanpa-kode";
        const g = groups.get(key) ?? { vendorNo: vno, name: String(vend.name ?? vno), invoiceCount: 0, total: 0 };
        g.invoiceCount += 1;
        g.total += Number(r.totalAmount) || 0;
        groups.set(key, g);
      }
      const vendors = [...groups.values()].sort((a, b) => b.total - a.total);
      const totalPayables = vendors.reduce((s, g) => s + g.total, 0);
      return {
        summary: {
          totalPayables,
          invoiceCount: all.rows.length,
          vendorCount: vendors.length,
          ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
        },
        vendors: vendors.slice(0, limit),
      };
    }
    case "gl.plSummary": {
      const { from, to } = periodOf(args);
      // SATU panggilan get-pl memuat seluruh akun P&L periode ini.
      // Baris isParent=true = agregat anak → hitung hanya leaf (isParent=false).
      const raw = await execute("glaccount.get-pl-account-amount", { fromDate: from, toDate: to });
      const rows = asArray(raw);
      const CATS = ["REVENUE", "COST_OF_GOOD_SOLD", "EXPENSE", "OTHER_INCOME", "OTHER_EXPENSE"] as const;
      const sums: Record<string, number> = { REVENUE: 0, COST_OF_GOOD_SOLD: 0, EXPENSE: 0, OTHER_INCOME: 0, OTHER_EXPENSE: 0 };
      const byCat = new Map<string, Array<{ accountNo: string; accountName: string; amount: number }>>();
      for (const r of rows) {
        if (r.isParent === true) continue;
        const cat = String(r.accountType ?? "");
        if (!(CATS as readonly string[]).includes(cat)) continue;
        const amount = Number(r.amount) || 0;
        sums[cat] += amount;
        const list = byCat.get(cat) ?? [];
        list.push({ accountNo: String(r.accountNo ?? ""), accountName: String(r.accountName ?? ""), amount });
        byCat.set(cat, list);
      }
      const top = (cat: string) =>
        (byCat.get(cat) ?? [])
          .filter((a) => a.amount !== 0)
          .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
          .slice(0, 5);
      const grossProfit = sums.REVENUE - sums.COST_OF_GOOD_SOLD;
      const netProfit =
        sums.REVENUE - sums.COST_OF_GOOD_SOLD - sums.EXPENSE + sums.OTHER_INCOME - sums.OTHER_EXPENSE;
      return {
        period: { fromDate: from, toDate: to },
        accountCount: rows.length,
        summary: {
          revenue: Math.round(sums.REVENUE),
          costOfGoodsSold: Math.round(sums.COST_OF_GOOD_SOLD),
          grossProfit: Math.round(grossProfit),
          operatingExpense: Math.round(sums.EXPENSE),
          otherIncome: Math.round(sums.OTHER_INCOME),
          otherExpense: Math.round(sums.OTHER_EXPENSE),
          netProfit: Math.round(netProfit),
        },
        topAccounts: {
          revenue: top("REVENUE"),
          costOfGoodsSold: top("COST_OF_GOOD_SOLD"),
          operatingExpense: top("EXPENSE"),
          otherIncome: top("OTHER_INCOME"),
          otherExpense: top("OTHER_EXPENSE"),
        },
      };
    }
    default:
      throw new Error(`tool agregasi tidak dikenal: ${tool}`);
  }
}
