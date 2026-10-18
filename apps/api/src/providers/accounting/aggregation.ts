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
 * Baris pelanggan LENGKAP utk output agregasi (customerNo, name, email,
 * mobilePhone, balance) — model yang membandingkan dengan output customer.list
 * tidak akan merasa kekurangan data → tak memanggil customer.list lagi (hemat putaran).
 */
function customerInfo(row: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, ...rest } = row;
  return rest;
}

/** ambil faktur penjualan pelanggan (customerNo), urut id desc, opsional limit */
async function customerInvoices(
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  customerNo: string,
  limit = 50
): Promise<Array<Record<string, unknown>>> {
  // catatan (diverifikasi ke API asli): filter pakai VALUE LANGSUNG filter.customerNo=CSBY-0005.
  // Bentuk objek {customerNo:{op,value}} DITOLAK ("Pelanggan tidak tepat"), argumen top-level
  // customerNo="…" diabaikan (tidak memfilter) → baris pelanggan lain bisa bocor.
  const rows = asArray(
    await execute("salesInvoice.list", {
      filter: { customerNo },
      sort: "id|desc",
      pageSize: limit,
    })
  );
  // scoping defensif by customerNo (API asli sudah memfilter; bila mock mengabaikan filter,
  // saring manual — dan 0 cocok berarti memang tak ada faktur, JANGAN kembalikan baris mentah)
  const cno = String(customerNo);
  return rows.filter(
    (r) => String(r.customerNo ?? "") === cno || String((r.customer as Record<string, unknown>)?.customerNo ?? "") === cno
  );
}

/** faktur BELUM LUNAS — filter.outstanding=true di server (approvalStatus ≠ lunas) */
async function customerUnpaidInvoices(
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  customerNo: string
): Promise<Array<Record<string, unknown>>> {
  // diverifikasi ke API asli: filter.customerNo + filter.outstanding=true (value langsung)
  // mengembalikan hanya faktur belum lunas — padahal approvalStatus semuanya APPROVED.
  const rows = asArray(
    await execute("salesInvoice.list", {
      filter: { customerNo, outstanding: true },
      pageSize: 100,
    })
  );
  const cno = String(customerNo);
  return rows.filter(
    (r) => String(r.customerNo ?? "") === cno || String((r.customer as Record<string, unknown>)?.customerNo ?? "") === cno
  );
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
      const invoices = await customerInvoices(execute, String(customer.customerNo ?? ""), 1);
      return {
        customer: customerInfo(customer),
        lastOrder: invoices[0] ?? null,
      };
    }
    case "customer.unpaidByName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const customer = await findCustomer(execute, name);
      if (!customer) return { error: `pelanggan "${name}" tidak ditemukan` };
      const unpaid = await customerUnpaidInvoices(execute, String(customer.customerNo ?? ""));
      const totalUnpaid = unpaid.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      return {
        customer: customerInfo(customer),
        totalUnpaid,
        countUnpaid: unpaid.length,
        unpaid: unpaid.slice(0, 20),
      };
    }
    case "customer.summaryByName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const customer = await findCustomer(execute, name);
      if (!customer) return { error: `pelanggan "${name}" tidak ditemukan` };
      const invoices = await customerInvoices(execute, String(customer.customerNo ?? ""));
      const total = invoices.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      const unpaid = await customerUnpaidInvoices(execute, String(customer.customerNo ?? ""));
      const totalUnpaid = unpaid.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      return {
        customer: customerInfo(customer),
        summary: {
          invoiceCount: invoices.length,
          totalSales: total,
          unpaidCount: unpaid.length,
          totalUnpaid,
        },
        lastOrder: invoices[0] ?? null,
      };
    }
    case "salesInvoice.summary": {
      const now = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      const from = String(args.fromDate ?? `${p(now.getDate())}/${p(now.getMonth() + 1)}/${now.getFullYear()}`);
      const to = String(args.toDate ?? from);
      const rows = asArray(
        await execute("salesInvoice.list", {
          filter: { transDate: { op: "BETWEEN", value: [from, to] } },
          pageSize: 100,
        })
      );
      const total = rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      return {
        period: { fromDate: from, toDate: to },
        summary: {
          invoiceCount: rows.length,
          totalSales: total,
          average: rows.length ? Math.round(total / rows.length) : 0,
        },
        invoices: rows.slice(0, 20),
      };
    }
    default:
      throw new Error(`tool agregasi tidak dikenal: ${tool}`);
  }
}
