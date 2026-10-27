import { prisma } from "../../apps/api/src/db.js";
import { hashPassword } from "../../apps/api/src/password.js";

const PASS_DEMO = process.env.DEMO_PASSWORD ?? "";
const PASS_PLATFORM = process.env.PLATFORM_DEMO_PASSWORD ?? "";
if (!PASS_DEMO || !PASS_PLATFORM) {
  throw new Error("Set DEMO_PASSWORD dan PLATFORM_DEMO_PASSWORD (jangan hardcode di repo).");
}

async function main() {
  // 1) Admin Platform — tabel PlatformUser (terpisah dari akun Accurate)
  const plat = await prisma.platformUser.upsert({
    where: { email: "platform@aigoogle.local" },
    create: { email: "platform@aigoogle.local", name: "Admin Platform (Demo)", passwordHash: hashPassword(PASS_PLATFORM) },
    update: { name: "Admin Platform (Demo)", passwordHash: hashPassword(PASS_PLATFORM) },
  });
  console.log("Admin Platform :", plat.email);

  // 2&3) Admin Accurate + Staff — akun perusahaan di tenant NYATA (koneksi Accurate asli)
  const conn = await prisma.connection.findFirst({
    where: { provider: "accurate", host: { contains: "accurate.id" } },
    orderBy: { updatedAt: "desc" },
  });
  if (!conn) throw new Error("tidak ada tenant nyata");
  const tid = conn.tenantId;

  const adminRole = await prisma.role.upsert({
    where: { tenantId_key: { tenantId: tid, key: "accurate-admin" } },
    create: { tenantId: tid, key: "accurate-admin", name: "Admin Accurate" },
    update: {},
  });
  const staffRole = await prisma.role.upsert({
    where: { tenantId_key: { tenantId: tid, key: "staff" } },
    create: { tenantId: tid, key: "staff", name: "Staff" },
    update: {},
  });
  // staff perlu hak lihat data utk menu Scan/Dashboard
  const staffView = ["accurate:customer.view", "accurate:item.view", "accurate:sales-invoice.view", "accurate:sales-receipt.view"];
  await prisma.rolePermission.createMany({
    data: staffView.map((permissionKey) => ({ roleId: staffRole.id, permissionKey })),
    skipDuplicates: true,
  });

  const admin = await prisma.user.upsert({
    where: { tenantId_providerUserId: { tenantId: tid, providerUserId: "demo-admin" } },
    create: {
      tenantId: tid, providerUserId: "demo-admin",
      email: "admin.demo@retaildemo.local", name: "Admin Accurate (Demo)",
      passwordHash: hashPassword(PASS_DEMO), roleId: adminRole.id,
    },
    update: { roleId: adminRole.id, passwordHash: hashPassword(PASS_DEMO) },
  });
  const staff = await prisma.user.upsert({
    where: { tenantId_providerUserId: { tenantId: tid, providerUserId: "demo-staff" } },
    create: {
      tenantId: tid, providerUserId: "demo-staff",
      email: "staff.demo@retaildemo.local", name: "Staf Accurate (Demo)",
      passwordHash: hashPassword(PASS_DEMO), roleId: staffRole.id,
    },
    update: { roleId: staffRole.id, passwordHash: hashPassword(PASS_DEMO) },
  });
  console.log("Admin Accurate:", admin.email, "@", tid.slice(-6));
  console.log("Staf Accurate :", staff.email, "@", tid.slice(-6));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
