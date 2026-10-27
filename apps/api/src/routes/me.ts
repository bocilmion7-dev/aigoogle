import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireUser } from "../middleware/session.js";
import { asyncHandler } from "../asyncHandler.js";
import { loadPermissionSet } from "../permissions.js";
import { getTwoFactor, isEmailVerified } from "../auth/tokens.js";
import { isEmailOtpEnabled } from "../auth/email-otp.js";
import { backupCodesRemaining } from "../auth/backup-codes.js";
import {
  clearImpersonationCookie,
  clearPlatformCookie,
  clearSessionCookie,
  readImpersonationId,
  readPlatformId,
  readSessionId,
} from "../cookies.js";
import { writeAudit } from "../audit.js";

export const meRouter = Router();

meRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    // identitas platform (cookie psid) menang atas sesi perusahaan di browser yg sama
    if (req.platform) {
      const [two, emailOtp, backupRemaining] = await Promise.all([
        getTwoFactor(req.platform.id),
        isEmailOtpEnabled(req.platform.id),
        backupCodesRemaining(req.platform.id),
      ]);
      return res.json({
        id: req.platform.id,
        userId: req.platform.id,
        email: req.platform.email,
        name: req.platform.name,
        tenant: { id: "platform", name: "AIGoogle Platform", alias: "PLATFORM", provider: "platform" },
        roleKey: "platform-admin",
        permissions: ["app:users.manage", "app:settings.manage", "app:audit.view"],
        needsPassword: false,
        twoFactorEnabled: two.enabled,
        emailOtpEnabled: emailOtp,
        backupCodesRemaining: backupRemaining,
      });
    }
    if (!req.user) return res.status(401).json({ error: "belum_login" });
    const permissions = [...(await loadPermissionSet(req.user.roleId))];
    const [emailVerified, twoFactor, emailOtp, backupRemaining] = await Promise.all([
      isEmailVerified(req.user.id),
      getTwoFactor(req.user.id),
      isEmailOtpEnabled(req.user.id),
      backupCodesRemaining(req.user.id),
    ]);
    res.json({
      ...req.user,
      permissions,
      emailVerified,
      twoFactorEnabled: twoFactor.enabled,
      emailOtpEnabled: emailOtp,
      backupCodesRemaining: backupRemaining,
      impersonated: !!req.impersonated,
    });
  })
);

meRouter.put(
  "/me",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        phone: z.string().trim().max(32).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    if (body.data.name === undefined && body.data.phone === undefined) {
      return res.status(400).json({ error: "tidak_ada_perubahan" });
    }
    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(body.data.name !== undefined ? { name: body.data.name } : {}),
        ...(body.data.phone !== undefined ? { phone: body.data.phone.replace(/[^\d+]/g, "") } : {}),
      },
    });
    await writeAudit(req.user!.tenant.id, req.user!.id, "auth.profile_update", body.data);
    res.json({ ok: true });
  })
);

meRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const sid = readSessionId(req);
    if (sid) await prisma.session.deleteMany({ where: { id: sid } });
    const psid = readPlatformId(req);
    if (psid) await prisma.platformSession.deleteMany({ where: { id: psid } });
    // Sesi impersonation juga harus ikut mati.
    const imp = readImpersonationId(req);
    if (imp) await prisma.session.deleteMany({ where: { id: imp } });
    clearSessionCookie(res);
    clearPlatformCookie(res);
    clearImpersonationCookie(res);
    res.json({ ok: true });
  })
);
