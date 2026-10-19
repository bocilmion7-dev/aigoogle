import { prisma } from "../db.js";
import { accurateCtxFor } from "../providers/accounting/connection.js";
import { accurateProvider } from "../providers/accounting/index.js";
import { sendWaText, getWaSettings } from "./service.js";

/**
 * Scheduler ringan: cek jatuh tempo + laporan harian.
 * Dipanggil dari index.ts interval (dev) / cron eksternal (produksi).
 *
 * Zona waktu: server berjalan UTC — semua perhitungan "hari ini" & jam kirim
 * memakai Asia/Jakarta (WIB) supaya laporan harian tiba jam 08.00 WIB sesuai
 * label dashboard, bukan 08.00 UTC (= 15.00 WIB).
 */

/** tanggal & jam WIB saat ini — server UTC, jangan pakai getHours()/toISOString() langsung */
export function wibNow(now = new Date()): { date: string; hour: number; dayLabel: string } {
  const fmt = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "long",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: hour === 24 ? 0 : hour,
    dayLabel: `${parts.weekday}, ${parts.day}/${parts.month}/${parts.year}`,
  };
}

/** format angka → Rp1.234.567 */
function rupiah(n: number): string {
  return `Rp${(Number.isFinite(n) ? n : 0).toLocaleString("id-ID")}`;
}

/** YYYY-MM-DD → dd/mm/yyyy (format yang dipahami tool Accurate) */
function dmy(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

/** ambil ringkasan dari tool agregasi Accurate — null bila tenant tanpa koneksi/gagal */
async function aggSummary(
  tenantId: string,
  tool: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  try {
    const ctx = await accurateCtxFor(tenantId);
    if (!ctx) return null;
    const res = await accurateProvider().execute(tool, args, ctx);
    return (res as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

/** susun isi laporan harian — penjualan hari ini, piutang, utang, & aktivitas WA */
export async function buildDailyReport(
  tenant: { id: string; name: string },
  wib: { date: string; dayLabel: string }
): Promise<string> {
  const lines = [`Laporan harian ${tenant.name} — ${wib.dayLabel}`];

  const [sales, receivables, payables] = await Promise.all([
    aggSummary(tenant.id, "salesInvoice.summary", {
      fromDate: dmy(wib.date),
      toDate: dmy(wib.date),
    }),
    aggSummary(tenant.id, "receivables.summary", {}),
    aggSummary(tenant.id, "payables.summary", {}),
  ]);

  const s = (sales?.summary ?? {}) as Record<string, unknown>;
  const r = (receivables?.summary ?? {}) as Record<string, unknown>;
  const p = (payables?.summary ?? {}) as Record<string, unknown>;

  if (sales) {
    lines.push(`Penjualan hari ini: ${rupiah(Number(s.totalSales) || 0)} (${s.invoiceCount ?? 0} faktur)`);
  } else {
    lines.push("Penjualan hari ini: tidak tersedia (koneksi Accurate belum aktif)");
  }
  if (receivables) {
    lines.push(`Piutang belum dibayar: ${rupiah(Number(r.totalReceivables) || 0)} (${r.customerCount ?? 0} pelanggan)`);
  }
  if (payables) {
    lines.push(`Utang belum dibayar: ${rupiah(Number(p.totalPayables) || 0)} (${p.vendorCount ?? 0} pemasok)`);
  }

  const sent = await prisma.waMessageLog.count({
    where: { tenantId: tenant.id, status: "sent", createdAt: { gte: new Date(Date.now() - 86400_000) } },
  });
  lines.push(`WhatsApp terkirim 24 jam terakhir: ${sent} pesan`);

  return lines.join("\n");
}

export async function runWaJobs(): Promise<{ dueChecked: number; reportsSent: number }> {
  const tenants = await prisma.tenant.findMany({ select: { id: true, alias: true, name: true } });
  let dueChecked = 0;
  let reportsSent = 0;
  const wib = wibNow();
  const today = wib.date;

  for (const t of tenants) {
    const s = await getWaSettings(t.id);
    if (!s.autoDueDate && !s.dailyReport) continue;

    if (s.autoDueDate) {
      dueChecked++;
      try {
        const ctx = await accurateCtxFor(t.id);
        if (!ctx) continue;
        const listed = await accurateProvider().execute(
          "salesInvoice.list",
          { fields: "no,customerName,date,total,status" },
          ctx
        );
        const rows = (Array.isArray(listed)
          ? listed
          : (listed as { items?: Array<Record<string, unknown>> }).items ?? []) as Array<Record<string, unknown>>;
        const due = rows.filter((r) => {
          const d = String(r.dueDate ?? r.date ?? "");
          return d && d <= today && !/paid|lunas/i.test(String(r.status ?? ""));
        });
        for (const inv of due.slice(0, 20)) {
          const phone = String(inv.customerPhone ?? inv.phone ?? "").replace(/\D/g, "");
          if (!phone) continue;
          const to = phone.startsWith("62") ? phone : `62${phone.replace(/^0/, "")}`;
          const body = `Yth. ${inv.customerName ?? "Pelanggan"}, tagihan ${inv.no ?? ""} sebesar ${rupiah(
            Number(inv.total) || 0
          )} jatuh tempo. Mohon pembayarannya. Terima kasih.`;
          await sendWaText(t.id, to, body);
        }
      } catch {
        /* tenant tanpa koneksi Accurate — skip */
      }
    }

    if (s.dailyReport && s.ownerPhone && wib.hour === 8) {
      const body = await buildDailyReport(t, wib);
      const r = await sendWaText(t.id, s.ownerPhone, body);
      if (r.ok) reportsSent++;
    }
  }
  return { dueChecked, reportsSent };
}
