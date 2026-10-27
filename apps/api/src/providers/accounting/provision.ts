import { prisma } from "../../db.js";
import { encryptToken } from "../../crypto.js";
import { ensureWallet } from "../../ai/billing.js";
import { accurateProvider } from "./index.js";
import type { OpenDbResult, ProviderDb, ProviderTokenSet, ProviderUser } from "./types.js";

/**
 * Provision tenant + role + user + koneksi untuk satu database Accurate.
 * Dipakai oleh callback OAuth dan fitur ganti perusahaan.
 */
export async function provisionDbUser(opts: {
  db: ProviderDb;
  pUser: ProviderUser;
  tokens: ProviderTokenSet;
  open: OpenDbResult;
  /** Salin hash password lokal saat switch perusahaan agar tidak perlu set ulang. */
  passwordHash?: string;
}): Promise<{ tenant: { id: string; name: string }; user: { id: string }; isNewTenant: boolean }> {
  const existing = await prisma.tenant.findUnique({
    where: { provider_providerDbId: { provider: "accurate", providerDbId: opts.db.providerDbId } },
    select: { id: true },
  });
  const tenant = await prisma.tenant.upsert({
    where: { provider_providerDbId: { provider: "accurate", providerDbId: opts.db.providerDbId } },
    create: {
      provider: "accurate",
      providerDbId: opts.db.providerDbId,
      name: opts.db.name,
      alias: opts.db.alias,
    },
    update: {},
    select: { id: true, name: true },
  });

  const roleKey = opts.db.admin ? "accurate-admin" : "staff";
  const roleName = opts.db.admin ? "Admin Accurate" : "Staff";
  const role = await prisma.role.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: roleKey } },
    create: { tenantId: tenant.id, key: roleKey, name: roleName },
    update: { name: roleName },
  });

  const modulPerms = accurateProvider().capabilityCatalog().map((t) => t.requiredPermission);
  const appPerms = opts.db.admin
    ? ["app:users.manage", "app:drive.tidy", "app:chat.history", "app:wa.send", "app:audit.view"]
    : [];
  const staffView = [
    "app:wa.send",
    "accurate:customer.view",
    "accurate:item.view",
    "accurate:sales-invoice.view",
    "accurate:sales-receipt.view",
  ];
  await prisma.rolePermission.createMany({
    data: (opts.db.admin ? [...appPerms, ...modulPerms] : [...appPerms, ...staffView]).map(
      (permissionKey) => ({ roleId: role.id, permissionKey })
    ),
    skipDuplicates: true,
  });

  const existingUser = await prisma.user.findUnique({
    where: {
      tenantId_providerUserId: {
        tenantId: tenant.id,
        providerUserId: opts.pUser.providerUserId,
      },
    },
    select: { id: true, passwordHash: true },
  });
  const user = await prisma.user.upsert({
    where: {
      tenantId_providerUserId: {
        tenantId: tenant.id,
        providerUserId: opts.pUser.providerUserId,
      },
    },
    create: {
      tenantId: tenant.id,
      providerUserId: opts.pUser.providerUserId,
      email: opts.pUser.email.toLowerCase(),
      name: opts.pUser.name,
      phone: opts.pUser.phone ?? "",
      passwordHash: opts.passwordHash ?? "",
      roleId: role.id,
    },
    update: { roleId: role.id, phone: opts.pUser.phone ?? undefined },
    select: { id: true },
  });
  if (existingUser && !existingUser.passwordHash && opts.passwordHash) {
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: opts.passwordHash } });
  }

  const isNewTenant = !existing;
  if (isNewTenant) await ensureWallet(user.id, tenant.id).catch(() => null);

  await prisma.connection.upsert({
    where: { tenantId_provider: { tenantId: tenant.id, provider: "accurate" } },
    create: {
      tenantId: tenant.id,
      provider: "accurate",
      accessTokenEnc: encryptToken(opts.tokens.accessToken),
      refreshTokenEnc: encryptToken(opts.tokens.refreshToken),
      expiresAt: opts.tokens.expiresAt,
      host: opts.open.host,
      session: opts.open.session,
    },
    update: {
      accessTokenEnc: encryptToken(opts.tokens.accessToken),
      refreshTokenEnc: encryptToken(opts.tokens.refreshToken),
      expiresAt: opts.tokens.expiresAt,
      host: opts.open.host,
      session: opts.open.session,
      status: "connected",
    },
  });

  return { tenant, user, isNewTenant };
}
