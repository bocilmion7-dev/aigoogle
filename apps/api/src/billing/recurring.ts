import { prisma } from "../db.js";

const keyOf = (tenantId: string) => `billing:auto_renew:${tenantId}`;

/**
 * Auto-renew untuk QRIS: menyimpan preferensi + memicu pengingat/invoice
 * perpanjangan. Auto-charge kartu/e-wallet tetap butuh Midtrans Subscription.
 */
export async function isAutoRenewEnabled(tenantId: string): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: keyOf(tenantId) } });
  return row?.value === "1";
}

export async function setAutoRenew(tenantId: string, enabled: boolean): Promise<void> {
  const key = keyOf(tenantId);
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: enabled ? "1" : "0" },
    update: { value: enabled ? "1" : "0" },
  });
}
