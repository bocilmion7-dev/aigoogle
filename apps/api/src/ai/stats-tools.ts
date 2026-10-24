import { prisma } from "../db.js";
import type { ToolSpec } from "../providers/accounting/types.js";
import { syncTenantDaily } from "../sync/daily.js";

/**
 * Tool chat yang membaca data LOKAL (snapshot DailyMetric) — jawaban tren
 * tanpa panggilan Accurate, dan sinkronisasi manual/backfill.
 */
export const STATS_TREND = "stats.dailyTrend";
export const STATS_SYNC = "stats.sync";

export const STATS_TOOLS: ToolSpec[] = [
  {
    name: STATS_TREND,
    label: "Membaca tren harian…",
    description:
      "Tren penjualan & pembelian PER HARI dari snapshot lokal (tanpa memanggil Accurate). " +
      "Pakai utk pertanyaan tren harian/beberapa bulan: 'tren penjualan 3 bulan terakhir', " +
      "'hari apa penjualan tertinggi bulan ini'. Data mungkin tertinggal — sinkronkan dulu bila perlu (stats.sync).",
    requiredPermission: "accurate:sales-invoice.view",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "tanggal awal dd/mm/yyyy (default 30 hari terakhir)" },
        toDate: { type: "string", description: "tanggal akhir dd/mm/yyyy (default hari ini)" },
        limit: { type: "number", description: "maks baris ditampilkan (default 31)" },
      },
    },
  },
  {
    name: STATS_SYNC,
    label: "Menyinkronkan data Accurate…",
    description:
      "Tarik ulang faktur penjualan & pembelian dari Accurate lalu simpan ringkasan per hari " +
      "(snapshot lokal). Pakai saat pengguna minta 'sinkronkan data', 'perbarui data harian', " +
      "atau saat data tren terasa tertinggal.",
    requiredPermission: "app:audit.view",
    jsonSchema: {
      type: "object",
      properties: {
        monthsBack: { type: "number", description: "jumlah bulan ke belakang (default 3, maks 24)" },
      },
    },
  },
];

const ymdToDdMmYyyy = (s: string): string => {
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
};
const todayIso = (): string => new Date().toISOString().slice(0, 10);

export async function executeStatsTool(
  tenantId: string,
  tool: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (tool === STATS_SYNC) {
    try {
      return await syncTenantDaily(tenantId, { monthsBack: Number(args.monthsBack) || 3 });
    } catch (e) {
      if (e instanceof Error && e.message === "belum_connect") {
        return { error: "Koneksi Accurate belum aktif", hint: "Hubungkan ulang Accurate di Pengaturan." };
      }
      throw e;
    }
  }
  if (tool !== STATS_TREND) throw new Error(`tool stats tidak dikenal: ${tool}`);

  const to = String(args.toDate ?? "") || ymdToDdMmYyyy(todayIso());
  const from = String(args.fromDate ?? "") || ymdToDdMmYyyy(new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
  const limit = Math.min(Math.max(Number(args.limit) || 31, 1), 92);
  const iso = (d: string) => {
    const m = d.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
  };
  const rows = await prisma.dailyMetric.findMany({
    where: { tenantId, date: { gte: iso(from), lte: iso(to) } },
    orderBy: { date: "desc" },
    take: limit,
  });
  return {
    period: { fromDate: from, toDate: to },
    days: rows.length,
    rows: rows.map((r) => ({
      date: ymdToDdMmYyyy(r.date),
      salesTotal: r.salesTotal,
      salesCount: r.salesCount,
      purchaseTotal: r.purchaseTotal,
      purchaseCount: r.purchaseCount,
    })),
    totals: rows.reduce(
      (a, r) => ({
        salesTotal: a.salesTotal + r.salesTotal,
        salesCount: a.salesCount + r.salesCount,
        purchaseTotal: a.purchaseTotal + r.purchaseTotal,
        purchaseCount: a.purchaseCount + r.purchaseCount,
      }),
      { salesTotal: 0, salesCount: 0, purchaseTotal: 0, purchaseCount: 0 }
    ),
  };
}
