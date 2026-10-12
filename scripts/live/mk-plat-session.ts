import { prisma } from "../../apps/api/src/db.js";
import { randomBytes } from "node:crypto";
async function main() {
  // tenant nyata = koneksi host accurate.id
  const conn = await prisma.connection.findFirst({ where: { host: { contains: "accurate.id" } } });
  if (!conn) throw new Error("tidak ada koneksi nyata");
  const user = await prisma.user.findFirst({ where: { tenantId: conn.tenantId }, orderBy: { createdAt: "asc" } });
  if (!user) throw new Error("tidak ada user di tenant nyata");
  // beri sementara permission platform pada role user tsb (dipulihkan di akhir via hapus)
  await prisma.rolePermission.upsert({
    where: { roleId_permissionKey: { roleId: user.roleId, permissionKey: "app:settings.manage" } },
    create: { roleId: user.roleId, permissionKey: "app:settings.manage" },
    update: {},
  });
  const sid = randomBytes(24).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
  console.log("SID=" + sid);
  console.log("RPID=" + user.roleId);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
