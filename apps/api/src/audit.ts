import { prisma } from "./db.js";

export async function writeAudit(tenantId: string, userId: string, action: string, detail: Record<string, unknown>) {
  try {
    await prisma.auditLog.create({
      data: { tenantId, userId, action, detail: JSON.stringify(detail) },
    });
  } catch (e) {
    // audit jangan pernah mematahkan operasi utama (mis. tenant khusus platform)
    console.warn("[audit] gagal mencatat:", action, String(e).slice(0, 160));
  }
}
