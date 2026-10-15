import { prisma } from "../../db.js";
import { decryptToken, encryptToken } from "../../crypto.js";
import { accurateProvider } from "./index.js";
import type { ProviderCtx, ProviderTokenSet } from "./types.js";

export async function accurateCtxFor(tenantId: string): Promise<ProviderCtx | null> {
  const conn = await prisma.connection.findUnique({
    where: { tenantId_provider: { tenantId, provider: "accurate" } },
  });
  if (!conn) return null;
  let accessToken = decryptToken(conn.accessTokenEnc);
  let host = conn.host;
  let session = conn.session;
  const provider = accurateProvider();
  if (conn.expiresAt.getTime() - Date.now() < 24 * 3600_000) {
    try {
      const fresh: ProviderTokenSet = await provider.refreshToken(decryptToken(conn.refreshTokenEnc));
      accessToken = fresh.accessToken;
      await prisma.connection.update({
        where: { id: conn.id },
        data: {
          accessTokenEnc: encryptToken(fresh.accessToken),
          refreshTokenEnc: encryptToken(fresh.refreshToken),
          expiresAt: fresh.expiresAt,
        },
      });
    } catch {
      await prisma.connection.update({ where: { id: conn.id }, data: { status: "expired" } });
      return null;
    }
  }
  if (!host || !session) {
    const fresh = await openAccurateDb(tenantId, conn.id, accessToken);
    if (!fresh) return null;
    host = fresh.host;
    session = fresh.session;
  }
  return { tenantId, host, session, accessToken };
}

/** Buka DB & simpan session baru — dipakai saat session kosong ATAU "Upsss..." (expired). */
async function openAccurateDb(
  tenantId: string,
  connId: string,
  accessToken: string
): Promise<{ host: string; session: string } | null> {
  const provider = accurateProvider();
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { providerDbId: true },
  });
  const dbs = await provider.listDbs(accessToken);
  const target = dbs.find((d) => d.providerDbId === tenant?.providerDbId);
  if (!target) return null;
  const open = await provider.openDb(accessToken, target.providerDbId);
  await prisma.connection.update({
    where: { id: connId },
    data: { host: open.host, session: open.session },
  });
  return { host: open.host, session: open.session };
}

/**
 * Refresh session Accurate setelah error "Upsss..." (session expired/transient).
 * Return ctx baru dengan session fresh, atau null bila gagal.
 */
export async function refreshAccurateSession(tenantId: string): Promise<ProviderCtx | null> {
  const conn = await prisma.connection.findUnique({
    where: { tenantId_provider: { tenantId, provider: "accurate" } },
  });
  if (!conn) return null;
  let accessToken: string;
  try {
    accessToken = decryptToken(conn.accessTokenEnc);
  } catch {
    return null;
  }
  // token mungkin juga expired — coba refresh dulu
  if (conn.expiresAt.getTime() - Date.now() < 5 * 60_000) {
    try {
      const fresh = await accurateProvider().refreshToken(decryptToken(conn.refreshTokenEnc));
      accessToken = fresh.accessToken;
      await prisma.connection.update({
        where: { id: conn.id },
        data: {
          accessTokenEnc: encryptToken(fresh.accessToken),
          refreshTokenEnc: encryptToken(fresh.refreshToken),
          expiresAt: fresh.expiresAt,
        },
      });
    } catch {
      await prisma.connection.update({ where: { id: conn.id }, data: { status: "expired" } });
      return null;
    }
  }
  const fresh = await openAccurateDb(tenantId, conn.id, accessToken);
  if (!fresh) return null;
  return { tenantId, host: fresh.host, session: fresh.session, accessToken };
}
