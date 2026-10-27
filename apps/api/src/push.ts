import { createHash } from "node:crypto";
import webpush from "web-push";
import { prisma } from "./db.js";
import { env } from "./env.js";

let ready = false;
if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    ready = true;
  } catch (e) {
    console.warn("[push] VAPID tidak valid:", e instanceof Error ? e.message : e);
  }
}

export function pushReady(): boolean {
  return ready;
}

export function pushPublicKey(): string {
  return ready ? env.VAPID_PUBLIC_KEY : "";
}

export function pushSubKey(userId: string, endpoint: string): string {
  return `push:sub:${userId}:${createHash("sha256").update(endpoint).digest("hex")}`;
}

/** Kirim Web Push ke semua perangkat user. Return jumlah terkirim. */
export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; url?: string }
): Promise<number> {
  if (!ready) return 0;
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: `push:sub:${userId}:` } } });
  let sent = 0;
  for (const row of rows) {
    try {
      const sub = JSON.parse(row.value) as { endpoint: string; keys: { p256dh: string; auth: string } };
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await prisma.appSetting.delete({ where: { key: row.key } }).catch(() => null);
      }
    }
  }
  return sent;
}
