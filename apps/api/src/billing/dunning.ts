import { prisma } from "../db.js";
import { sendMail, escapeHtml } from "../mail.js";
import { renderMailLayout, formatRupiah, BRAND } from "../mail/templates.js";
import { env } from "../env.js";
import { sendWaText } from "../wa/service.js";
import { sendPushToUser } from "../push.js";
import { isAutoRenewEnabled } from "./recurring.js";
import { wibDate } from "../wawasan/time.js";

function rupiah(n: number): string {
  return formatRupiah(n);
}

/** Kartu ringkasan label–nilai (HTML inline, nilai sudah di-escape). */
function kvCard(rows: Array<[string, string]>): string {
  const body = rows
    .map(
      ([k, v], i) =>
        `<tr>
          <td style="padding:10px 0;font-size:12.5px;color:${BRAND.muted};border-bottom:${i === rows.length - 1 ? "none" : `1px solid ${BRAND.border}`};width:40%">${escapeHtml(k)}</td>
          <td style="padding:10px 0;font-size:13px;font-weight:600;color:${BRAND.ink};text-align:right;border-bottom:${i === rows.length - 1 ? "none" : `1px solid ${BRAND.border}`}">${escapeHtml(v)}</td>
        </tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BRAND.border};border-radius:12px;background:${BRAND.card};padding:2px 18px;margin:6px 0 0">${body}</table>`;
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
    const autoRenew = await isAutoRenewEnabled(sub.tenantId);
    if (autoRenew) {
      body += ` Perpanjangan otomatis aktif — buka ${env.APP_ORIGIN}/subscription untuk menyelesaikan pembayaran.`;
    }
    let ok = false;
    if (owner.phone) {
      const r = await sendWaText(sub.tenantId, owner.phone, body);
      ok = ok || r.ok;
    }
    if (owner.email) {
      const html = renderMailLayout({
        heading: expired ? "Langganan telah berakhir" : "Langganan segera berakhir",
        preheader: `Langganan ${sub.plan} untuk ${tenant?.name ?? "perusahaan"}`,
        intro: expired
          ? `Masa aktif langganan Anda sudah berakhir. Perpanjang sekarang agar fitur AI tetap dapat digunakan.`
          : `Langganan Anda akan berakhir dalam ${Math.max(0, days)} hari. Perpanjang agar layanan tetap aktif tanpa terputus.`,
        bodyHtml: kvCard([
          ["Langganan", sub.plan],
          ["Perusahaan", tenant?.name ?? "-"],
          ["Berakhir", sub.expiresAt.toLocaleDateString("id-ID")],
        ]),
        cta: { label: "Perpanjang langganan", url: `${env.APP_ORIGIN}/subscription` },
        note: autoRenew
          ? "Perpanjangan otomatis aktif — selesaikan pembayaran saat diminta agar masa aktif diperpanjang."
          : "Buka halaman Langganan untuk memilih paket dan menyelesaikan pembayaran.",
      });
      const m = await sendMail({ to: owner.email, subject: "Pengingat langganan AI Asisten", text: body, html });
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
  const html = renderMailLayout({
    heading: "Saldo token AI menipis",
    preheader: `Sisa saldo ${rupiah(balance)}`,
    intro: `Saldo token AI Anda sudah di bawah batas minimum. Isi ulang agar percakapan dan fitur suara tidak terputus.`,
    bodyHtml: kvCard([
      ["Sisa saldo", rupiah(balance)],
      ["Batas minimum", rupiah(minReserve)],
    ]),
    cta: { label: "Isi ulang saldo", url: `${env.APP_ORIGIN}/saldo` },
    note: "Pengingat ini dikirim maksimal satu kali per hari.",
  });
  if (user.phone) await sendWaText(tenantId, user.phone, text).catch(() => null);
  if (user.email) await sendMail({ to: user.email, subject: "Saldo token AI menipis", text, html }).catch(() => null);
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
