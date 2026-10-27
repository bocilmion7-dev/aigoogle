import { prisma } from "../db.js";
import { sendMail } from "../mail.js";
import { sendWaText } from "../wa/service.js";
import { sendPushToUser } from "../push.js";
import { isAutoRenewEnabled } from "./recurring.js";
import { wibDate } from "../wawasan/time.js";

function rupiah(n: number): string {
  return `Rp${Math.round(Number.isFinite(n) ? n : 0).toLocaleString("id-ID")}`;
}

async function ownerForTenant(tenantId: string) {
  return (
    (await prisma.user.findFirst({
      where: { tenantId, role: { key: "accurate-admin" } },
      orderBy: { createdAt: "asc" },
    })) ??
    (await prisma.user.findFirst({ where: { tenantId }, orderBy: { createdAt: "asc" } }))
  );
}

/**
 * Pengingat langganan H-3 / H+1 / H+7. Dijalankan berkala; idempoten per
 * tenant+subscription+hari via AppSetting sehingga tidak spam.
 */
export async function runBillingReminders(): Promise<number> {
  const now = Date.now();
  const until = new Date(now + 7 * 86400_000);
  const subs = await prisma.subscription.findMany({
    where: {
      status: "active",
      expiresAt: { not: null, lte: until, gte: new Date(now - 7 * 86400_000) },
    },
    take: 500,
  });
  let sent = 0;
  const today = wibDate();
  for (const sub of subs) {
    if (!sub.expiresAt) continue;
    const key = `billing:reminder:${sub.tenantId}:${sub.id}:${today}`;
    const already = await prisma.appSetting.findUnique({ where: { key } });
    if (already) continue;
    const tenant = await prisma.tenant.findUnique({ where: { id: sub.tenantId }, select: { name: true } });
    const owner = await ownerForTenant(sub.tenantId);
    if (!owner) continue;
    const expired = sub.expiresAt.getTime() <= now;
    const days = Math.ceil((sub.expiresAt.getTime() - now) / 86400_000);
    let body = expired
      ? `Langganan ${sub.plan} untuk ${tenant?.name ?? "perusahaan"} sudah berakhir. Perpanjang agar fitur AI tetap aktif.`
      : `Langganan ${sub.plan} untuk ${tenant?.name ?? "perusahaan"} berakhir dalam ${Math.max(0, days)} hari (${sub.expiresAt.toLocaleDateString("id-ID")}).`;
    if (await isAutoRenewEnabled(sub.tenantId)) {
      body += ` Perpanjangan otomatis aktif — buka /subscription untuk menyelesaikan pembayaran.`;
    }
    let ok = false;
    if (owner.phone) {
      const r = await sendWaText(sub.tenantId, owner.phone, body);
      ok = ok || r.ok;
    }
    if (owner.email) {
      const m = await sendMail({ to: owner.email, subject: "Pengingat langganan AI Asisten", text: body });
      ok = ok || m;
    }
    const pushed = await sendPushToUser(owner.id, {
      title: expired ? "Langganan berakhir" : "Langganan segera berakhir",
      body,
      url: "/subscription",
    }).catch(() => 0);
    ok = ok || pushed > 0;
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: ok ? "1" : "0" },
      update: { value: ok ? "1" : "0" },
    });
    if (ok) sent++;
  }
  return sent;
}

/** Kirim peringatan sekali/hari saat saldo token menembus batas minimum. */
export async function maybeAlertLowBalance(userId: string, tenantId: string, balance: number): Promise<void> {
  const row = await prisma.appSetting.findUnique({ where: { key: "ai:min_reserve" } });
  const minReserve = Math.max(1, Number(row?.value ?? 500));
  if (balance > minReserve) return;
  const key = `ai:low_balance:${userId}:${wibDate()}`;
  const already = await prisma.appSetting.findUnique({ where: { key } });
  if (already) return;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, phone: true, name: true } });
  if (!user) return;
  const text =
    `Halo ${user.name}, saldo token AI Anda tinggal ${rupiah(balance)} ` +
    `(batas minimum ${rupiah(minReserve)}). Top up agar chat/voice tidak terhenti.`;
  if (user.phone) await sendWaText(tenantId, user.phone, text).catch(() => null);
  if (user.email) await sendMail({ to: user.email, subject: "Saldo token AI menipis", text }).catch(() => null);
  await sendPushToUser(userId, {
    title: "Saldo token AI menipis",
    body: text,
    url: "/saldo",
  }).catch(() => 0);
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: "1" },
    update: { value: "1" },
  });
}
