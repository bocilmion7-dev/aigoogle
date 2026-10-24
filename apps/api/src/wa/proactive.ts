import { prisma } from "../db.js";
import { accurateCtxFor } from "../providers/accounting/connection.js";
import { accurateProvider } from "../providers/accounting/index.js";
import { sendWaText } from "./service.js";
import { syncTenantDaily } from "../sync/daily.js";

/**
 * Pesan proaktif harian via WhatsApp (opt-in per tenant):
 *  - ringkasan penjualan/pembelian hari ini
 *  - total piutang & utang + jatuh tempo terdekat
 *  - stok habis
 * Setelan (appSetting):
 *  wa:proactive_enabled:{tenantId} = "1"
 *  wa:owner_phone:{tenantId}        = nomor tujuan
 *  wa:digest_hour                   = jam kirim (default 18)
 *  wa:due_days                      = ambang jatuh tempo (default 3)
 *  wa:lowstock_threshold            = ambang stok dianggap menipis (default 5)
 */
const p2 = (n: number) => String(n).padStart(2, "0");
const rp = (n: number) => "Rp" + Math.round(n).toLocaleString("id-ID");
const todayIso = () => new Date().toISOString().slice(0, 10);
const ddmmyyyy = (d = new Date()) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;

async function settings(tenantId: string): Promise<Record<string, string>> {
  const keys = [
    `wa:proactive_enabled:${tenantId}`,
    `wa:owner_phone:${tenantId}`,
    "wa:digest_hour",
    "wa:due_days",
    "wa:lowstock_threshold",
    `wa:proactive_last:${tenantId}`,
  ];
  const rows = await prisma.appSetting.findMany({ where: { key: { in: keys } } });
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/** bangun teks digest; null bila tak ada yang perlu dikirim */
async function buildDigest(tenantId: string, cfg: Record<string, string>): Promise<string | null> {
  const ctx = await accurateCtxFor(tenantId);
  if (!ctx) return null;
  const provider = accurateProvider();
  const today = ddmmyyyy();
  const dueDays = Number(cfg["wa:due_days"] ?? 3) || 3;
  const lowThreshold = Number(cfg["wa:lowstock_threshold"] ?? 5) || 5;

  const metric = await prisma.dailyMetric.findUnique({ where: { tenantId_date: { tenantId, date: todayIso() } } });
  const [ar, ap, low] = await Promise.all([
    provider.execute("receivables.summary", {}, ctx).catch(() => null),
    provider.execute("payables.summary", {}, ctx).catch(() => null),
    provider.execute("item.zeroStock", {}, ctx).catch(() => null),
  ]);

  const arObj = (ar ?? {}) as Record<string, unknown>;
  const apObj = (ap ?? {}) as Record<string, unknown>;
  const lowObj = (low ?? {}) as Record<string, unknown>;
  const arTotal = Number(arObj.totalUnpaid ?? arObj.total ?? 0) || 0;
  const arCount = Number(arObj.countUnpaid ?? arObj.count ?? 0) || 0;
  const apTotal = Number(apObj.totalUnpaid ?? apObj.total ?? 0) || 0;
  const apCount = Number(apObj.countUnpaid ?? apObj.count ?? 0) || 0;
  const lowCount = Number(lowObj.count ?? 0) || 0;

  // jatuh tempo terdekat (bila ada)
  const earliestDue = String(arObj.earliestDue ?? "");
  let dueLine = "";
  if (earliestDue) {
    const m = earliestDue.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) {
      const due = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      const days = Math.ceil((due.getTime() - Date.now()) / 86400_000);
      if (days <= dueDays) {
        dueLine = `\n- Jatuh tempo terdekat: ${earliestDue} (${days <= 0 ? "sudah lewat" : `${days} hari lagi`})`;
      }
    }
  }

  const lines: string[] = [`Ringkasan ${today} — ${(await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }))?.name ?? "usaha Anda"}`];
  if (metric) {
    lines.push(`- Penjualan hari ini: ${rp(metric.salesTotal)} (${metric.salesCount} faktur)`);
    lines.push(`- Pembelian hari ini: ${rp(metric.purchaseTotal)} (${metric.purchaseCount} faktur)`);
  }
  lines.push(`- Piutang belum tertagih: ${rp(arTotal)} (${arCount} faktur)${dueLine}`);
  lines.push(`- Utang belum dibayar: ${rp(apTotal)} (${apCount} faktur)`);
  if (lowCount > 0) lines.push(`- Stok habis/menipis: ${lowCount} barang (ambang ${lowThreshold})`);
  lines.push("", "Balas di aplikasi AI Asisten untuk detail.");

  // tanpa angka apa pun → jangan kirim
  if (!metric && arTotal === 0 && apTotal === 0 && lowCount === 0) return null;
  return lines.join("\n");
}

export interface ProactiveResult {
  tenantId: string;
  sent: boolean;
  reason: string;
}

export async function runProactiveJobs(now = new Date()): Promise<ProactiveResult[]> {
  const conns = await prisma.connection.findMany({
    where: { provider: "accurate", status: "connected" },
    select: { tenantId: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const out: ProactiveResult[] = [];
  for (const c of conns) {
    const cfg = await settings(c.tenantId);
    if (cfg[`wa:proactive_enabled:${c.tenantId}`] !== "1") {
      out.push({ tenantId: c.tenantId, sent: false, reason: "nonaktif" });
      continue;
    }
    const phone = cfg[`wa:owner_phone:${c.tenantId}`] ?? "";
    if (!phone) {
      out.push({ tenantId: c.tenantId, sent: false, reason: "nomor belum diatur" });
      continue;
    }
    const hour = Number(cfg["wa:digest_hour"] ?? 18) || 18;
    if (now.getHours() < hour) {
      out.push({ tenantId: c.tenantId, sent: false, reason: "belum jam kirim" });
      continue;
    }
    const last = cfg[`wa:proactive_last:${c.tenantId}`] ?? "";
    if (last === todayIso()) {
      out.push({ tenantId: c.tenantId, sent: false, reason: "sudah dikirim hari ini" });
      continue;
    }

    // pastikan snapshot harian segar sebelum menyusun digest
    await syncTenantDaily(c.tenantId, { monthsBack: 1 }).catch(() => null);
    const body = await buildDigest(c.tenantId, cfg);
    if (!body) {
      out.push({ tenantId: c.tenantId, sent: false, reason: "tidak ada data" });
      continue;
    }
    const res = await sendWaText(c.tenantId, phone, body);
    if (res.ok) {
      await prisma.appSetting.upsert({
        where: { key: `wa:proactive_last:${c.tenantId}` },
        create: { key: `wa:proactive_last:${c.tenantId}`, value: todayIso() },
        update: { value: todayIso() },
      });
    }
    out.push({ tenantId: c.tenantId, sent: res.ok, reason: res.ok ? "terkirim" : res.error ?? "gagal" });
  }
  return out;
}
