import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { decryptToken, encryptToken } from "../crypto.js";
import {
  accurateProvider,
  realAccurateProvider,
  OAUTH_REDIRECT_URI,
  ACCURATE_REDIRECT_URI,
} from "../providers/accounting/index.js";
import type { AccountingProvider } from "../providers/accounting/types.js";
import { ensureWallet } from "../ai/billing.js";

export const launchRouter = Router();

// state sementara in-memory (dev; produksi: tabel/signed state)
const pending = new Map<string, { dbId?: string; exp: number }>();
const LAUNCH_COOKIE = "launch_state";

function isHttps(req: Request): boolean {
  return !!req.secure || String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]!.trim() === "https";
}

/** Buat state OAuth + ikat ke browser lewat cookie terenkripsi (cegah login CSRF). */
export function issueLaunchState(res: Response, dbId?: string): string {
  if (pending.size > 2_000) {
    const now = Date.now();
    for (const [k, v] of pending) if (v.exp < now) pending.delete(k);
    if (pending.size > 5_000) pending.clear();
  }
  const state = `ls-${randomBytes(16).toString("hex")}`;
  pending.set(state, { dbId, exp: Date.now() + 600_000 });
  res.cookie(LAUNCH_COOKIE, encryptToken(JSON.stringify({ s: state })), {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(res.req as Request),
    maxAge: 10 * 60_000,
    path: "/api",
  });
  return state;
}

function launchStateMatches(req: Request, state: string): boolean {
  try {
    const pack = JSON.parse(decryptToken(String(req.cookies?.[LAUNCH_COOKIE] ?? ""))) as { s?: string };
    return !!pack.s && pack.s === state;
  } catch {
    return false;
  }
}

launchRouter.get("/launch", (req, res) => {
  const q = z.object({ dbId: z.string().optional(), user: z.string().optional() }).parse(req.query);
  const state = issueLaunchState(res, q.dbId);
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
      const cookieOk = launchStateMatches(req, state);
      res.clearCookie(LAUNCH_COOKIE, { path: "/api" });
      if (!hit || hit.exp < Date.now() || !cookieOk) {
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
    const existingTenant = await prisma.tenant.findUnique({
      where: { provider_providerDbId: { provider: "accurate", providerDbId: db.providerDbId } },
      select: { id: true },
    });
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
    // perusahaan baru via Accurate → beri bonus token pendaftaran (sekali per tenant)
    if (!existingTenant) {
      await ensureWallet(user.id, tenant.id).catch((e) =>
        console.warn("[billing] gagal memberi bonus pendaftaran:", e instanceof Error ? e.message : e)
      );
    }
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
    res.cookie("sid", sid, {
      httpOnly: true,
      sameSite: "lax",
      secure: isHttps(req as Request),
      maxAge: 7 * 86400_000,
    });
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
    requireState: true,
    origin: new URL(ACCURATE_REDIRECT_URI).origin,
  })
);
