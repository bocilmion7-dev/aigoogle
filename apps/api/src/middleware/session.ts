import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        roleKey: string;
        roleId: string;
        needsPassword: boolean;
        tenant: { id: string; name: string; alias: string; provider: string };
      };
      /** operator platform (tabel PlatformUser terpisah — bukan akun Accurate) */
      platform?: { id: string; email: string; name: string };
      /** body JSON mentah (untuk verifikasi signature notifikasi pembayaran) */
      rawBody?: string;
    }
  }
}

export function loadSession(req: Request, res: Response, next: NextFunction) {
  const sid = req.cookies?.sid as string | undefined;
  if (!sid) return next();
  void (async () => {
    const s = await prisma.session.findUnique({
      where: { id: sid },
      include: { user: { include: { role: true, tenant: true } } },
    });
    if (s && s.expiresAt > new Date()) {
      req.user = {
        id: s.user.id,
        email: s.user.email,
        name: s.user.name,
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
  const psid = req.cookies?.psid as string | undefined;
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
