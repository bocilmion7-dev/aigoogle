import { prisma } from "../db.js";
import { accurateCtxFor } from "../providers/accounting/connection.js";
import { accurateProvider } from "../providers/accounting/index.js";
import { sendWaText, getWaSettings } from "./service.js";

/**
 * Scheduler ringan: cek jatuh tempo + laporan harian.
 * Dipanggil dari index.ts interval (dev) / cron eksternal (produksi).
 */
export async function runWaJobs(): Promise<{ dueChecked: number; reportsSent: number }> {
  const tenants = await prisma.tenant.findMany({ select: { id: true, alias: true, name: true } });
  let dueChecked = 0;
  let reportsSent = 0;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  for (const t of tenants) {
    const s = await getWaSettings(t.id);
    if (!s.autoDueDate && !s.dailyReport) continue;

    if (s.autoDueDate) {
      dueChecked++;
      try {
        const ctx = await accurateCtxFor(t.id);
        if (!ctx) continue;
        const rows = (await accurateProvider().execute(
          "salesInvoice.list",
          { fields: "no,customerName,date,total,status" },
          ctx
        )) as Array<Record<string, unknown>>;
        const due = rows.filter((r) => {
          const d = String(r.dueDate ?? r.date ?? "");
          return d && d <= today && !/paid|lunas/i.test(String(r.status ?? ""));
        });
        for (const inv of due.slice(0, 20)) {
          const phone = String(inv.customerPhone ?? inv.phone ?? "").replace(/\D/g, "");
          if (!phone) continue;
          const to = phone.startsWith("62") ? phone : `62${phone.replace(/^0/, "")}`;
          const body = `Yth. ${inv.customerName ?? "Pelanggan"}, tagihan ${inv.no ?? ""} sebesar Rp${inv.total ?? 0} jatuh tempo. Mohon pembayarannya. Terima kasih.`;
          await sendWaText(t.id, to, body);
        }
      } catch {
        /* tenant tanpa koneksi Accurate — skip */
      }
    }

    if (s.dailyReport && s.ownerPhone && now.getHours() === 8) {
      const sent = await prisma.waMessageLog.count({
        where: { tenantId: t.id, status: "sent", createdAt: { gte: new Date(now.getTime() - 86400_000) } },
      });
      const body = `Laporan harian ${t.name} (${today}): ${sent} pesan WhatsApp terkirim 24 jam terakhir.`;
      const r = await sendWaText(t.id, s.ownerPhone, body);
      if (r.ok) reportsSent++;
    }
  }
  return { dueChecked, reportsSent };
}
