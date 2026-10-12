import { prisma } from "../../apps/api/src/db.js";
async function main() {
  // semua user dgn roleKey platform-admin di tenant BUKAN platform internal
  const platformTenant = await prisma.tenant.findFirst({ where: { provider: "platform" } });
  const stale = await prisma.user.findMany({
    where: { role: { key: "platform-admin", ...(platformTenant ? { NOT: { tenantId: platformTenant.id } } : {}) } },
    include: { tenant: true },
  });
  for (const u of stale) {
    // perusahaan asli: role harusnya accurate-admin (admin db Accurate)
    const role = await prisma.role.upsert({
      where: { tenantId_key: { tenantId: u.tenantId, key: "accurate-admin" } },
      create: { tenantId: u.tenantId, key: "accurate-admin", name: "Admin Accurate" },
      update: {},
    });
    await prisma.user.update({ where: { id: u.id }, data: { roleId: role.id } });
    console.log(`dipindah: ${u.email} @${u.tenant.name} → accurate-admin`);
  }
  console.log("total dipindah:", stale.length);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
