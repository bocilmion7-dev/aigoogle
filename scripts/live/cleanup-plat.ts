import { prisma } from "../../apps/api/src/db.js";
async function main() {
  const r = await prisma.rolePermission.deleteMany({
    where: { roleId: "cmv53ezyf000wmg7e645pu8ds", permissionKey: "app:settings.manage" },
  });
  console.log("permission platform sementara dihapus:", r.count);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
