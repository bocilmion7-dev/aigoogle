import { prisma } from "../db.js";
import { accurateCtxFor } from "../providers/accounting/connection.js";
import { accurateProvider } from "../providers/accounting/index.js";

/**
 * Sinkronisasi/backfill metrik harian dari Accurate → tabel DailyMetric.
 * Tujuan: jawaban tren/analitik cepat (tanpa panggilan Accurate) + snapshot
 * historis yang tahan gangguan koneksi.
 */
const PAGE = 1000;
const MAX_PAGES = 10;

const p2 = (n: number) => String(n).padStart(2, "0");
const ddmmyyyy = (d: Date) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
const ymd = (s: string): string => {
  const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const iso = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : "";
};

type Row = Record<string, unknown>;
const asItems = (v: unknown): Row[] =>
  Array.isArray(v) ? (v as Row[]) : ((v as { items?: Row[] })?.items ?? []);

export interface SyncResult {
  months: number;
  salesInvoices: number;
  purchaseInvoices: number;
  days: number;
}

export async function syncTenantDaily(tenantId: string, opts?: { monthsBack?: number }): Promise<SyncResult> {
  const ctx = await accurateCtxFor(tenantId);
  if (!ctx) throw new Error("belum_connect");
  const provider = accurateProvider();
  const months = Math.min(Math.max(opts?.monthsBack ?? 3, 1), 24);
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const fromStr = ddmmyyyy(from);
  const toStr = ddmmyyyy(now);
  const filter = { transDate: { op: "BETWEEN", value: [fromStr, toStr] } };

  const fetchAll = async (tool: string): Promise<Row[]> => {
    const out: Row[] = [];
    let pageCount = 1;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = (await provider.execute(tool, { pageSize: PAGE, page, filter }, ctx)) as {
        items?: Row[];
        pageCount?: number;
      };
      const items = asItems(res);
      out.push(...items);
      pageCount = Number(res.pageCount ?? 1);
      if (page >= pageCount || items.length < PAGE) break;
    }
    return out;
  };

  const [sales, purchases] = await Promise.all([fetchAll("salesInvoice.list"), fetchAll("purchaseInvoice.list")]);

  const byDay = new Map<string, { salesTotal: number; salesCount: number; purchaseTotal: number; purchaseCount: number }>();
  const bump = (rows: Row[], side: "sales" | "purchase") => {
    for (const r of rows) {
      const day = ymd(String(r.transDate ?? ""));
      if (!day) continue;
      const e = byDay.get(day) ?? { salesTotal: 0, salesCount: 0, purchaseTotal: 0, purchaseCount: 0 };
      const amount = Number(r.totalAmount ?? r.total ?? 0) || 0;
      if (side === "sales") {
        e.salesTotal += amount;
        e.salesCount += 1;
      } else {
        e.purchaseTotal += amount;
        e.purchaseCount += 1;
      }
      byDay.set(day, e);
    }
  };
  bump(sales, "sales");
  bump(purchases, "purchase");

  for (const [date, e] of byDay) {
    await prisma.dailyMetric.upsert({
      where: { tenantId_date: { tenantId, date } },
      create: { tenantId, date, ...e },
      update: e,
    });
  }
  return { months, salesInvoices: sales.length, purchaseInvoices: purchases.length, days: byDay.size };
}

/**
 * Sinkron semua tenant — dibatasi agar tidak membanjiri API Accurate:
 * hanya koneksi berstatus connected, diurutkan dari yang paling baru dipakai,
 * maksimal `limit` tenant per putaran, konkurensi 2.
 */
export async function syncAllTenants(
  monthsBack = 3,
  opts?: { limit?: number; concurrency?: number }
): Promise<Array<{ tenantId: string; ok: boolean; detail: string }>> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const concurrency = Math.min(Math.max(opts?.concurrency ?? 2, 1), 5);
  const conns = await prisma.connection.findMany({
    where: { provider: "accurate", status: "connected" },
    select: { tenantId: true },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  const out: Array<{ tenantId: string; ok: boolean; detail: string }> = new Array(conns.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= conns.length) return;
      const tenantId = conns[i]!.tenantId;
      try {
        const r = await syncTenantDaily(tenantId, { monthsBack });
        out[i] = { tenantId, ok: true, detail: `${r.days} hari, ${r.salesInvoices + r.purchaseInvoices} faktur` };
      } catch (e) {
        out[i] = { tenantId, ok: false, detail: e instanceof Error ? e.message.slice(0, 120) : "error" };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, conns.length) }, worker));
  return out;
}
