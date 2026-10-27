import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { decryptToken, encryptToken } from "../crypto.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { isTenantSuspended } from "../middleware/session.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { writeAudit } from "../audit.js";
import { accurateProvider } from "../providers/accounting/index.js";
import { provisionDbUser } from "../providers/accounting/provision.js";
import { issueCompanySession } from "./auth.js";

export const accurateCompanyRouter = Router();

async function tokensForTenant(tenantId: string) {
  const conn = await prisma.connection.findUnique({
    where: { tenantId_provider: { tenantId, provider: "accurate" } },
  });
  if (!conn) return null;
  let accessToken = decryptToken(conn.accessTokenEnc);
  let refreshToken = decryptToken(conn.refreshTokenEnc);
  let expiresAt = conn.expiresAt;
  if (expiresAt.getTime() - Date.now() < 5 * 60_000) {
    const fresh = await accurateProvider().refreshToken(refreshToken);
    accessToken = fresh.accessToken;
    refreshToken = fresh.refreshToken;
    expiresAt = fresh.expiresAt;
    await prisma.connection.update({
      where: { id: conn.id },
      data: {
        accessTokenEnc: encryptToken(accessToken),
        refreshTokenEnc: encryptToken(refreshToken),
        expiresAt,
      },
    });
  }
  return { accessToken, refreshToken, expiresAt };
}

accurateCompanyRouter.get(
  "/accurate/companies",
  requireUser,
  rateLimit({ name: "accurate-companies", windowMs: 60_000, max: 20 }),
  asyncHandler(async (req, res) => {
    const tokens = await tokensForTenant(req.user!.tenant.id);
    if (!tokens) return res.status(409).json({ error: "belum_connect" });
    let dbs;
    try {
      dbs = await accurateProvider().listDbs(tokens.accessToken);
    } catch {
      return res.status(409).json({ error: "accurate_tidak_terjangkau" });
    }
    const current = await prisma.tenant.findUnique({
      where: { id: req.user!.tenant.id },
      select: { providerDbId: true },
    });
    res.json(
      dbs.map((d) => ({
        providerDbId: d.providerDbId,
        name: d.name,
        alias: d.alias,
        admin: d.admin,
        current: d.providerDbId === current?.providerDbId,
      }))
    );
  })
);

accurateCompanyRouter.post(
  "/accurate/switch",
  requireUser,
  rateLimit({ name: "accurate-switch", windowMs: 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const body = z.object({ providerDbId: z.string().min(1).max(64) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });

    const currentTenantId = req.user!.tenant.id;
    const tokens = await tokensForTenant(currentTenantId);
    if (!tokens) return res.status(409).json({ error: "belum_connect" });

    let dbs;
    try {
      dbs = await accurateProvider().listDbs(tokens.accessToken);
    } catch {
      return res.status(409).json({ error: "accurate_tidak_terjangkau" });
    }
    const db = dbs.find((d) => d.providerDbId === body.data.providerDbId);
    if (!db) return res.status(404).json({ error: "perusahaan_tidak_ditemukan" });

    const pUser = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { providerUserId: true, email: true, name: true, phone: true, passwordHash: true },
    });
    if (!pUser) return res.status(404).json({ error: "user_tidak_ditemukan" });

    const existingTenant = await prisma.tenant.findUnique({
      where: { provider_providerDbId: { provider: "accurate", providerDbId: db.providerDbId } },
      select: { id: true },
    });
    if (existingTenant && (await isTenantSuspended(existingTenant.id))) {
      return res.status(403).json({ error: "tenant_ditangguhkan" });
    }

    const open = await accurateProvider().openDb(tokens.accessToken, db.providerDbId);
    const { tenant, user } = await provisionDbUser({
      db,
      pUser: {
        providerUserId: pUser.providerUserId,
        email: pUser.email,
        name: pUser.name,
        phone: pUser.phone,
      },
      tokens,
      open,
      passwordHash: pUser.passwordHash,
    });
    if (await isTenantSuspended(tenant.id)) {
      return res.status(403).json({ error: "tenant_ditangguhkan" });
    }

    await issueCompanySession(res, user.id);
    await writeAudit(tenant.id, user.id, "tenant.switch", {
      fromTenantId: currentTenantId,
      providerDbId: db.providerDbId,
      company: tenant.name,
    });
    res.json({ ok: true, tenant: { id: tenant.id, name: tenant.name } });
  })
);
