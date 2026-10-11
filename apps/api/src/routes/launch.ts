import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { encryptToken } from "../crypto.js";
import { accurateProvider, OAUTH_REDIRECT_URI } from "../providers/accounting/index.js";

export const launchRouter = Router();

// state sementara in-memory (dev; produksi: tabel/signed state)
const pending = new Map<string, { dbId?: string; exp: number }>();

launchRouter.get("/launch", (req, res) => {
  const q = z.object({ dbId: z.string().optional(), user: z.string().optional() }).parse(req.query);
  const state = `ls-${randomBytes(16).toString("hex")}`;
  pending.set(state, { dbId: q.dbId, exp: Date.now() + 600_000 });
  const url = new URL(accurateProvider().authorizeUrl({ redirectUri: OAUTH_REDIRECT_URI, state }));
  if (q.user) url.searchParams.set("user", q.user); // mock only
  res.redirect(url.toString());
});

launchRouter.get("/oauth/accurate/callback", async (req, res, next) => {
  try {
    const { code, state } = z.object({ code: z.string(), state: z.string() }).parse(req.query);
    const st = pending.get(state);
    pending.delete(state);
    if (!st || st.exp < Date.now()) return res.redirect(`${env.APP_ORIGIN}/?error=state`);
    const provider = accurateProvider();
    const tok = await provider.exchangeCode(code, OAUTH_REDIRECT_URI);
    const pUser = await provider.fetchUser(tok.accessToken);
    const dbs = await provider.listDbs(tok.accessToken);
    const db = (st.dbId ? dbs.find((d) => d.providerDbId === st.dbId) : dbs[0]) ?? dbs[0];
    if (!db) return res.redirect(`${env.APP_ORIGIN}/?error=nodb`);
    const open = await provider.openDb(tok.accessToken, db.providerDbId);

    const tenant = await prisma.tenant.upsert({
      where: { provider_providerDbId: { provider: "accurate", providerDbId: db.providerDbId } },
      create: { provider: "accurate", providerDbId: db.providerDbId, name: db.name, alias: db.alias },
      update: {},
    });
    const roleKey = db.admin ? "admin" : "staff";
    const role = await prisma.role.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key: roleKey } },
      create: { tenantId: tenant.id, key: roleKey, name: db.admin ? "Administrator" : "Staff" },
      update: {},
    });
    if (db.admin) {
      await prisma.rolePermission.createMany({
        data: ["app:users.manage", "app:settings.manage", "app:drive.tidy", "app:chat.history", "app:audit.view"].map(
          (permissionKey) => ({ roleId: role.id, permissionKey })
        ),
        skipDuplicates: true,
      });
    }
    const user = await prisma.user.upsert({
      where: { tenantId_providerUserId: { tenantId: tenant.id, providerUserId: pUser.providerUserId } },
      create: {
        tenantId: tenant.id,
        providerUserId: pUser.providerUserId,
        email: pUser.email.toLowerCase(),
        name: pUser.name,
        phone: pUser.phone ?? "",
        roleId: role.id,
      },
      update: { roleId: role.id, phone: pUser.phone ?? undefined },
    });
    await prisma.connection.upsert({
      where: { tenantId_provider: { tenantId: tenant.id, provider: "accurate" } },
      create: {
        tenantId: tenant.id,
        provider: "accurate",
        accessTokenEnc: encryptToken(tok.accessToken),
        refreshTokenEnc: encryptToken(tok.refreshToken),
        expiresAt: tok.expiresAt,
        host: open.host,
        session: open.session,
      },
      update: {
        accessTokenEnc: encryptToken(tok.accessToken),
        refreshTokenEnc: encryptToken(tok.refreshToken),
        expiresAt: tok.expiresAt,
        status: "connected",
        host: open.host,
        session: open.session,
      },
    });
    if (db.admin) {
      const modulPerms = accurateProvider()
        .capabilityCatalog()
        .map((t) => t.requiredPermission);
      await prisma.rolePermission.createMany({
        data: modulPerms.map((permissionKey) => ({ roleId: role.id, permissionKey })),
        skipDuplicates: true,
      });
    }
    const sid = randomBytes(32).toString("hex");
    await prisma.session.create({
      data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 7 * 86400_000) },
    });
    res.cookie("sid", sid, { httpOnly: true, sameSite: "lax", maxAge: 7 * 86400_000 });
    if (!user.passwordHash) {
      res.redirect(`${env.APP_ORIGIN}/set-password`);
      return;
    }
    res.redirect(`${env.APP_ORIGIN}/app`);
  } catch (e) {
    next(e);
  }
});
