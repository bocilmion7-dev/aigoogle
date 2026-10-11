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
    const dbs = await provider.listDbs(accessToken);
    const open = await provider.openDb(accessToken, dbs[0]?.providerDbId ?? "");
    host = open.host;
    session = open.session;
    await prisma.connection.update({ where: { id: conn.id }, data: { host, session } });
  }
  return { tenantId, host, session, accessToken };
}
