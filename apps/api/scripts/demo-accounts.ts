import { randomUUID } from "node:crypto";
import { prisma } from "../src/db.js";
import { hashPassword } from "../src/password.js";
import { encryptToken } from "../src/crypto.js";
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

/**
 * Segarkan koneksi Accurate tenant demo ke mock (MOCK_ACCURATE_URL, default :4010).
 * Sesi mock in-memory — token/session lama mati tiap mock restart.
 */
async function refreshConnection(tenantId: string) {
  const base = process.env.MOCK_ACCURATE_URL ?? "http://127.0.0.1:4010";
  try {
    const auth = await fetch(`${base}/oauth/authorize?redirect_uri=${encodeURIComponent("http://x/cb")}&admin=1`, {
      redirect: "manual",
    });
    const loc = auth.headers.get("location");
    if (!loc) throw new Error("oauth authorize tanpa redirect");
    const code = new URL(loc).searchParams.get("code");
    if (!code) throw new Error("oauth authorize tanpa code");
    const tokRes = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: "http://x/cb",
        client_id: "c",
        client_secret: "s",
      }),
    });
    const tok = (await tokRes.json()) as { access_token: string; refresh_token: string; expires_in?: number };
    const open = (await (
      await fetch(`${base}/api/open-db.do?id=1001`, { headers: { Authorization: `Bearer ${tok.access_token}` } })
    ).json()) as { session: string; host: string };
    await prisma.connection.upsert({
      where: { tenantId_provider: { tenantId, provider: "accurate" } },
      create: {
        tenantId,
        provider: "accurate",
        accessTokenEnc: encryptToken(tok.access_token),
        refreshTokenEnc: encryptToken(tok.refresh_token),
        expiresAt: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000),
        host: open.host,
        session: open.session,
      },
      update: {
        accessTokenEnc: encryptToken(tok.access_token),
        refreshTokenEnc: encryptToken(tok.refresh_token),
        expiresAt: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000),
        host: open.host,
        session: open.session,
      },
    });
    console.log(`koneksi Accurate disegarkan → ${open.host}`);
  } catch (e) {
    console.warn(`koneksi Accurate tidak disegarkan (${base}):`, e instanceof Error ? e.message : e);
  }
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { alias: TENANT_ALIAS } });
  if (!tenant) throw new Error(`tenant alias ${TENANT_ALIAS} tidak ditemukan`);

  const adminRole = await upsertRole(tenant.id, "platform-admin", "Admin Platform");
  await grant(adminRole.id, ADMIN_PERMS);

  const staffRole = await upsertRole(tenant.id, "staff", "Staff");
  await grant(staffRole.id, STAFF_PERMS);

  const admin = await ensureUser(tenant.id, "admin@demo.local", "Admin Demo", adminRole.id);
  const pelanggan = await ensureUser(tenant.id, "pelanggan@demo.local", "Pelanggan Demo", staffRole.id);

  console.log(`tenant: ${tenant.name} (${tenant.alias})`);
  console.log(`admin@demo.local / ${PASSWORD} — role platform-admin${admin.created ? " (baru)" : " (diperbarui)"}`);
  console.log(`pelanggan@demo.local / ${PASSWORD} — role staff${pelanggan.created ? " (baru)" : " (diperbarui)"}`);

  await refreshConnection(tenant.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
