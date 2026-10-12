import { randomUUID } from "node:crypto";
import { prisma } from "../src/db.js";
import { hashPassword } from "../src/password.js";
import { ACCURATE_CATALOG } from "../src/providers/accounting/catalog.js";

const PASSWORD = process.env.DEMO_PASSWORD ?? "password123";
const TENANT_ALIAS = "MAJU";

const ADMIN_PERMS = [
  "app:users.manage",
  "app:settings.manage",
  "app:drive.tidy",
  "app:chat.history",
  "app:audit.view",
  ...ACCURATE_CATALOG.map((t) => t.requiredPermission),
];

const STAFF_PERMS = [
  "accurate:customer.view",
  "accurate:sales-invoice.view",
  "accurate:sales-receipt.view",
  "accurate:item.view",
];

async function upsertRole(tenantId: string, key: string, name: string) {
  const found = await prisma.role.findUnique({
    where: { tenantId_key: { tenantId, key } },
  });
  if (found) return found;
  return prisma.role.create({ data: { tenantId, key, name } });
}

async function grant(roleId: string, perms: string[]) {
  await prisma.rolePermission.createMany({
    data: perms.map((permissionKey) => ({ roleId, permissionKey })),
    skipDuplicates: true,
  });
}

async function ensureUser(tenantId: string, email: string, name: string, roleId: string) {
  const normalized = email.toLowerCase();
  const existing = await prisma.user.findFirst({ where: { tenantId, email: normalized } });
  const passwordHash = hashPassword(PASSWORD);
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, roleId, name },
    });
    return { id: existing.id, created: false };
  }
  const u = await prisma.user.create({
    data: {
      tenantId,
      providerUserId: `pw-${randomUUID()}`,
      email: normalized,
      name,
      passwordHash,
      roleId,
    },
  });
  return { id: u.id, created: true };
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { alias: TENANT_ALIAS } });
  if (!tenant) throw new Error(`tenant alias ${TENANT_ALIAS} tidak ditemukan`);

  const adminRole = await upsertRole(tenant.id, "admin", "Administrator");
  await grant(adminRole.id, ADMIN_PERMS);

  const staffRole = await upsertRole(tenant.id, "staff", "Staff");
  await grant(staffRole.id, STAFF_PERMS);

  const admin = await ensureUser(tenant.id, "admin@demo.local", "Admin Demo", adminRole.id);
  const pelanggan = await ensureUser(tenant.id, "pelanggan@demo.local", "Pelanggan Demo", staffRole.id);

  console.log(`tenant: ${tenant.name} (${tenant.alias})`);
  console.log(`admin@demo.local / ${PASSWORD} — role admin${admin.created ? " (baru)" : " (diperbarui)"}`);
  console.log(`pelanggan@demo.local / ${PASSWORD} — role staff${pelanggan.created ? " (baru)" : " (diperbarui)"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
