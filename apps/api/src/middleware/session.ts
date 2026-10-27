import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db.js";
import { readImpersonationId, readPlatformId, readSessionId } from "../cookies.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        phone: string;
        roleKey: string;
        roleId: string;
        needsPassword: boolean;
        tenant: { id: string; name: string; alias: string; provider: string };
      };
      /** operator platform (tabel PlatformUser terpisah — bukan akun Accurate) */
      platform?: { id: string; email: string; name: string };
      /** true bila sesi perusahaan ini dibuat lewat impersonation platform */
      impersonated?: boolean;
      /** body JSON mentah (untuk verifikasi signature notifikasi pembayaran) */
      rawBody?: string;
    }
  }
}

const suspendedCache = new Map<string, { at: number; value: boolean }>();

export async function isTenantSuspended(tenantId: string): Promise<boolean> {
  const hit = suspendedCache.get(tenantId);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const row = await prisma.appSetting.findUnique({ where: { key: `tenant:suspended:${tenantId}` } });
  const value = row?.value === "1";
  suspendedCache.set(tenantId, { at: Date.now(), value });
  return value;
}

export function loadSession(req: Request, res: Response, next: NextFunction) {
  const imp = readImpersonationId(req);
  const sid = imp || readSessionId(req);
  if (!sid) return next();
  void (async () => {
    const s = await prisma.session.findUnique({
      where: { id: sid },
      include: { user: { include: { role: true, tenant: true } } },
    });
    if (s && s.expiresAt > new Date() && !(await isTenantSuspended(s.user.tenant.id))) {
      if (imp) req.impersonated = true;
      req.user = {
        id: s.user.id,
        email: s.user.email,
        name: s.user.name,
        phone: s.user.phone,
        roleKey: s.user.role.key,
        roleId: s.user.role.id,
        needsPassword: !s.user.passwordHash,
        tenant: {
          id: s.user.tenant.id,
          name: s.user.tenant.name,
          alias: s.user.tenant.alias,
          provider: s.user.tenant.provider,
        },
      };
    }
    next();
  })().catch(next);
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "belum_login" });
  next();
}

/** sesi perusahaan ATAU sesi platform (psid) — utk halaman konfigurasi milik platform */
export function requireUserOrPlatform(req: Request, res: Response, next: NextFunction) {
  if (!req.user && !req.platform) return res.status(401).json({ error: "belum_login" });
  next();
}

/** muat sesi platform dari cookie psid (terpisah dari sesi perusahaan sid) */
export function loadPlatformSession(req: Request, _res: Response, next: NextFunction) {
  // Saat impersonation, sesi perusahaan menang dan sesi platform diabaikan.
  if (readImpersonationId(req)) return next();
  const psid = readPlatformId(req);
  if (!psid) return next();
  void (async () => {
    const s = await prisma.platformSession.findUnique({
      where: { id: psid },
      include: { platformUser: true },
    });
    if (s && s.expiresAt > new Date()) {
      req.platform = { id: s.platformUser.id, email: s.platformUser.email, name: s.platformUser.name };
    }
    next();
  })().catch(next);
}

export function requirePlatform(req: Request, res: Response, next: NextFunction) {
  if (!req.platform) return res.status(401).json({ error: "bukan_platform" });
  next();
}
