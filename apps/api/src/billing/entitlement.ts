import { prisma } from "../db.js";
import { isBillingEnabled } from "./midtrans.js";

export async function isEntitled(tenantId: string): Promise<boolean> {
  if (!isBillingEnabled()) return true; // dormant: semua fitur aktif
  const sub = await prisma.subscription.findFirst({
    where: { tenantId, status: "active" },
    orderBy: { createdAt: "desc" },
  });
  if (!sub) return false;
  if (sub.expiresAt && sub.expiresAt.getTime() < Date.now()) return false;
  return true;
}
