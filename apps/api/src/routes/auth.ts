import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireUser } from "../middleware/session.js";
import { asyncHandler } from "../asyncHandler.js";
import { hashPassword, validatePasswordStrength, verifyPassword } from "../password.js";
import { writeAudit } from "../audit.js";

export const authRouter = Router();

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const SetPasswordBody = z.object({
  password: z.string().min(1),
});

authRouter.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const body = LoginBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const user = await prisma.user.findFirst({
      where: { email: body.data.email.toLowerCase(), passwordHash: { not: "" } },
    });
    if (!user || !verifyPassword(body.data.password, user.passwordHash)) {
      return res.status(401).json({ error: "email_atau_password_salah" });
    }
    const sid = randomBytes(32).toString("hex");
    await prisma.session.create({
      data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 7 * 86400_000) },
    });
    res.cookie("sid", sid, { httpOnly: true, sameSite: "lax", maxAge: 7 * 86400_000 });
    res.clearCookie("psid"); // sesi platform tidak boleh menumpuk di browser yg sama
    await writeAudit(user.tenantId, user.id, "auth.login", { via: "password" });
    res.json({ ok: true });
  })
);

// ── Autentikasi PLATFORM (tabel PlatformUser terpisah dari akun Accurate) ──
const PlatformLoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post(
  "/platform/login",
  asyncHandler(async (req, res) => {
    const body = PlatformLoginBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const u = await prisma.platformUser.findUnique({ where: { email: body.data.email.toLowerCase() } });
    if (!u || !u.passwordHash || !verifyPassword(body.data.password, u.passwordHash)) {
      return res.status(401).json({ error: "email_atau_password_salah" });
    }
    const sid = randomBytes(32).toString("hex");
    await prisma.platformSession.create({
      data: { id: sid, platformUserId: u.id, expiresAt: new Date(Date.now() + 7 * 86400_000) },
    });
    res.cookie("psid", sid, { httpOnly: true, sameSite: "lax", maxAge: 7 * 86400_000 });
    res.clearCookie("sid"); // sesi perusahaan tidak boleh menumpuk di browser yg sama
    res.json({ ok: true });
  })
);

authRouter.post(
  "/platform/logout",
  asyncHandler(async (req, res) => {
    const psid = req.cookies?.psid as string | undefined;
    if (psid) await prisma.platformSession.deleteMany({ where: { id: psid } });
    res.clearCookie("psid").json({ ok: true });
  })
);

authRouter.post(
  "/auth/set-password",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = SetPasswordBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const strength = validatePasswordStrength(body.data.password);
    if (strength) return res.status(400).json({ error: strength });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (user.passwordHash) return res.status(409).json({ error: "sudah_diset" });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashPassword(body.data.password),
        email: user.email.toLowerCase(),
      },
    });
    await writeAudit(user.tenantId, user.id, "auth.set_password", {});
    res.json({ ok: true });
  })
);
