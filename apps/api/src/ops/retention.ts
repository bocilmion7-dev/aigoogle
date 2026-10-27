import { prisma } from "../db.js";

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86400_000);
}

/**
 * Retensi data: jangan simpan PII/chat/log selamanya.
 * Dijalankan harian; idempoten karena hanya menghapus baris lebih lama dari batas.
 */
export async function runRetentionCleanup(): Promise<Record<string, number>> {
  const [chat, audit, wa, webhook, news] = await Promise.all([
    prisma.chatMessage.deleteMany({ where: { createdAt: { lt: daysAgo(180) } } }),
    prisma.auditLog.deleteMany({ where: { createdAt: { lt: daysAgo(365) } } }),
    prisma.waMessageLog.deleteMany({ where: { createdAt: { lt: daysAgo(180) } } }),
    prisma.accurateWebhookEvent.deleteMany({ where: { createdAt: { lt: daysAgo(90) } } }),
    prisma.newsItem.deleteMany({ where: { fetchedAt: { lt: daysAgo(90) } } }),
  ]);

  // Token auth kedaluwarsa (reset/verify/2fa challenge) disimpan di AppSetting.
  let tokens = 0;
  const rows = await prisma.appSetting.findMany({
    where: { key: { startsWith: "auth:" } },
    select: { key: true, value: true },
  });
  for (const row of rows) {
    try {
      const data = JSON.parse(row.value) as { exp?: number };
      if (Number(data.exp ?? 0) > 0 && Number(data.exp) < Date.now()) {
        await prisma.appSetting.delete({ where: { key: row.key } }).catch(() => null);
        tokens++;
      }
    } catch {
      /* bukan JSON token — biarkan */
    }
  }

  return {
    chatMessages: chat.count,
    auditLogs: audit.count,
    waMessages: wa.count,
    webhookEvents: webhook.count,
    newsItems: news.count,
    expiredTokens: tokens,
  };
}
