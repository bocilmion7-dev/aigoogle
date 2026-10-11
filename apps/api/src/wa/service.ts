import { env } from "../env.js";
import { decryptToken, encryptToken } from "../crypto.js";
import { prisma } from "../db.js";

export const WA_COST_CREDITS_PER_MESSAGE = 1;
export const WA_TOPUP_RUPIAH_PER_CREDIT = 200;

export function metaConfigured(): boolean {
  return env.META_APP_ID !== "" && env.META_APP_SECRET !== "";
}

export function embeddedSignupUrl(redirectUri: string): string | null {
  if (!env.META_APP_ID || !env.META_EMBEDDED_CONFIG_ID) return null;
  const u = new URL("https://www.facebook.com/v21.0/dialog/wa_embedded_signup");
  u.searchParams.set("app_id", env.META_APP_ID);
  u.searchParams.set("config_id", env.META_EMBEDDED_CONFIG_ID);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("override_default_response_type", "1");
  u.searchParams.set("redirect_uri", redirectUri);
  return u.toString();
}

export async function sendWaText(
  tenantId: string,
  to: string,
  body: string
): Promise<{ ok: boolean; error?: string }> {
  const acct = await prisma.waAccount.findUnique({ where: { tenantId } });
  if (!acct || !acct.phoneNumberId || !acct.tokenEnc) {
    await prisma.waMessageLog.create({
      data: { tenantId, to, body, status: "failed", error: "belum_connect", costCredits: 0 },
    });
    return { ok: false, error: "belum_connect" };
  }
  const bal = await prisma.waBalance.upsert({
    where: { tenantId },
    create: { tenantId, amount: 0 },
    update: {},
  });
  if (bal.amount < WA_COST_CREDITS_PER_MESSAGE) {
    await prisma.waMessageLog.create({
      data: { tenantId, to, body, status: "failed", error: "saldo_kurang", costCredits: 0 },
    });
    return { ok: false, error: "saldo_kurang" };
  }
  const token = decryptToken(acct.tokenEnc);
  const res = await fetch(`https://graph.facebook.com/v21.0/${acct.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    await prisma.waMessageLog.create({
      data: { tenantId, to, body, status: "failed", error: `graph_${res.status}:${err.slice(0, 200)}`, costCredits: 0 },
    });
    return { ok: false, error: `graph_${res.status}` };
  }
  await prisma.$transaction([
    prisma.waBalance.update({
      where: { tenantId },
      data: { amount: { decrement: WA_COST_CREDITS_PER_MESSAGE } },
    }),
    prisma.waMessageLog.create({
      data: {
        tenantId,
        to,
        body,
        status: "sent",
        costCredits: WA_COST_CREDITS_PER_MESSAGE,
      },
    }),
  ]);
  return { ok: true };
}

export async function getOrCreateBalance(tenantId: string): Promise<number> {
  const bal = await prisma.waBalance.upsert({
    where: { tenantId },
    create: { tenantId, amount: 0 },
    update: {},
  });
  return bal.amount;
}

export function creditsFromRupiah(rupiah: number): number {
  return Math.floor(rupiah / WA_TOPUP_RUPIAH_PER_CREDIT);
}

export async function getWaSettings(tenantId: string): Promise<{
  autoDueDate: boolean;
  dailyReport: boolean;
  ownerPhone: string;
}> {
  const keys = [`wa:auto_due:${tenantId}`, `wa:daily_report:${tenantId}`, `wa:owner_phone:${tenantId}`];
  const rows = await prisma.appSetting.findMany({ where: { key: { in: keys } } });
  const m = new Map(rows.map((r) => [r.key, r.value]));
  return {
    autoDueDate: m.get(keys[0]) === "1",
    dailyReport: m.get(keys[1]) === "1",
    ownerPhone: m.get(keys[2]) ?? "",
  };
}

export async function setWaSettings(
  tenantId: string,
  s: { autoDueDate?: boolean; dailyReport?: boolean; ownerPhone?: string }
): Promise<void> {
  const ops: Array<{ key: string; value: string }> = [];
  if (s.autoDueDate !== undefined) ops.push({ key: `wa:auto_due:${tenantId}`, value: s.autoDueDate ? "1" : "0" });
  if (s.dailyReport !== undefined) ops.push({ key: `wa:daily_report:${tenantId}`, value: s.dailyReport ? "1" : "0" });
  if (s.ownerPhone !== undefined) ops.push({ key: `wa:owner_phone:${tenantId}`, value: s.ownerPhone });
  for (const o of ops) {
    await prisma.appSetting.upsert({
      where: { key: o.key },
      create: o,
      update: { value: o.value },
    });
  }
}
