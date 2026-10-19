import { prisma } from "./db.js";

// Audit platform dulu mengirim tenantId literal "platform" → melanggar FK AuditLog.tenant
// sehingga SEMUA aksi platform (ai_provider.*, settings.*) tak pernah tercatat.
// Arahkan ke tenant "AIGoogle Platform" bila ada; bila tidak → lewati (cukup warning).
let platformTenantId: string | null | undefined;
async function resolveTenantId(tenantId: string): Promise<string | null> {
  if (tenantId !== "platform") return tenantId;
  if (platformTenantId === undefined) {
    const t = await prisma.tenant.findFirst({
      where: { name: "AIGoogle Platform" },
      select: { id: true },
    });
    platformTenantId = t?.id ?? null;
  }
  return platformTenantId;
}

export async function writeAudit(tenantId: string, userId: string, action: string, detail: Record<string, unknown>) {
  try {
    const tid = await resolveTenantId(tenantId);
    if (!tid) {
      console.warn("[audit] tenant platform tak ditemukan — lewati:", action);
      return;
    }
    await prisma.auditLog.create({
      data: { tenantId: tid, userId, action, detail: JSON.stringify(detail) },
    });
  } catch (e) {
    // audit jangan pernah mematahkan operasi utama
    console.warn("[audit] gagal mencatat:", action, String(e).slice(0, 160));
  }
}
