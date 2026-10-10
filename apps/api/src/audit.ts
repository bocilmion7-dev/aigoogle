import { prisma } from "./db.js";

export async function writeAudit(tenantId: string, userId: string, action: string, detail: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: { tenantId, userId, action, detail: JSON.stringify(detail) },
  });
}
