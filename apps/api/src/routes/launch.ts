import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { encryptToken } from "../crypto.js";
import {
  accurateProvider,
  realAccurateProvider,
  OAUTH_REDIRECT_URI,
  ACCURATE_REDIRECT_URI,
} from "../providers/accounting/index.js";
import type { AccountingProvider } from "../providers/accounting/types.js";

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

interface CallbackOpts {
  redirectUri: string;
  provider: () => AccountingProvider;
  requireState: boolean;
  /** origin tempat user diarahkan kembali setelah callback */
  origin: string;
}

async function handleCallback(
  req: Parameters<Parameters<import("express").Router["get"]>[1]>[0],
  res: Parameters<Parameters<import("express").Router["get"]>[1]>[1],
  next: (e?: unknown) => void,
  opts: CallbackOpts
): Promise<void> {
  try {
    // Accurate menolak akses (user batal) → kembali dengan kode error
    const qError = typeof req.query.error === "string" ? req.query.error : undefined;
    if (qError) {
      res.redirect(`${opts.origin}/?error=${encodeURIComponent(qError)}`);
      return;
    }
    const { code, state } = z
      .object({ code: z.string(), state: z.string().optional() })
      .parse(req.query);
    let st: { dbId?: string } | undefined;
    if (state) {
      const hit = pending.get(state);
      pending.delete(state);
      if (!hit || hit.exp < Date.now()) {
        res.redirect(`${opts.origin}/?error=state`);
        return;
      }
      st = hit;
    } else if (opts.requireState) {
      // alur launch lama selalu membawa state
      res.redirect(`${opts.origin}/?error=state`);
      return;
    }
    const provider = opts.provider();
    const tok = await provider.exchangeCode(code, opts.redirectUri);
    const pUser = await provider.fetchUser(tok.accessToken);
    const dbs = await provider.listDbs(tok.accessToken);
    const db = (st?.dbId ? dbs.find((d) => d.providerDbId === st.dbId) : dbs[0]) ?? dbs[0];
    if (!db) {
      res.redirect(`${opts.origin}/?error=nodb`);
      return;
    }
    const open = await provider.openDb(tok.accessToken, db.providerDbId);

    // ── Alur perusahaan pelanggan ────────────────────────────────────────────
    const tenant = await prisma.tenant.upsert({
      where: { provider_providerDbId: { provider: "accurate", providerDbId: db.providerDbId } },
      create: { provider: "accurate", providerDbId: db.providerDbId, name: db.name, alias: db.alias },
      update: {},
    });
    // Tingkat peran sisi perusahaan:
    //  - accurate-admin : admin database Accurate (db.admin) — kelola perusahaannya
    //  - staff          : pengguna Accurate biasa
    const roleKey = db.admin ? "accurate-admin" : "staff";
    const roleName = db.admin ? "Admin Accurate" : "Staff";
    const role = await prisma.role.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key: roleKey } },
      create: { tenantId: tenant.id, key: roleKey, name: roleName },
      update: { name: roleName },
    });
    const modulPerms = accurateProvider()
      .capabilityCatalog()
      .map((t) => t.requiredPermission);
    const appPerms = db.admin
      ? ["app:users.manage", "app:drive.tidy", "app:chat.history", "app:audit.view"] // tanpa settings.manage
      : [];
    const staffView = ["accurate:customer.view", "accurate:item.view", "accurate:sales-invoice.view", "accurate:sales-receipt.view"];
    await prisma.rolePermission.createMany({
      data: (db.admin ? [...appPerms, ...modulPerms] : [...appPerms, ...staffView]).map(
        (permissionKey) => ({ roleId: role.id, permissionKey })
      ),
      skipDuplicates: true,
    });
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
    const sid = randomBytes(32).toString("hex");
    await prisma.session.create({
      data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 7 * 86400_000) },
    });
    res.cookie("sid", sid, { httpOnly: true, sameSite: "lax", maxAge: 7 * 86400_000 });
    // login perusahaan membersihkan sesi platform lama di browser yang sama
    res.clearCookie("psid");
    if (!user.passwordHash) {
      res.redirect(`${opts.origin}/set-password`);
      return;
    }
    res.redirect(`${opts.origin}/app`);
  } catch (e) {
    next(e);
  }
}

// alur lama (mock/dev): /api/oauth/accurate/callback — wajib state, apiBase mock-aware
launchRouter.get("/oauth/accurate/callback", (req, res, next) =>
  handleCallback(req, res, next, {
    redirectUri: OAUTH_REDIRECT_URI,
    provider: accurateProvider,
    requireState: true,
    origin: env.APP_ORIGIN,
  })
);

// CTA OAuth: /api/callback/accurate — tanpa state, apiBase Accurate asli
launchRouter.get("/callback/accurate", (req, res, next) =>
  handleCallback(req, res, next, {
    redirectUri: ACCURATE_REDIRECT_URI,
    provider: realAccurateProvider,
    requireState: false,
    origin: new URL(ACCURATE_REDIRECT_URI).origin,
  })
);
