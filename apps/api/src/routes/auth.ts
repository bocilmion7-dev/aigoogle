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
    await writeAudit(user.tenantId, user.id, "auth.login", { via: "password" });
    res.json({ ok: true });
  })
);

// GET /api/auth/memberships — daftar identitas user ini di seluruh tenant
// (platform internal + perusahaan tempat dia terdaftar) utk pemilih konteks
authRouter.get(
  "/auth/memberships",
  requireUser,
  asyncHandler(async (req, res) => {
    const me = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { providerUserId: true },
    });
    if (!me) return res.json([]);
    const rows = await prisma.user.findMany({
      where: { providerUserId: me.providerUserId },
      include: {
        tenant: { select: { id: true, name: true, alias: true, provider: true } },
        role: { select: { key: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    res.json(
      rows.map((r) => ({
        tenantId: r.tenant.id,
        name: r.tenant.name,
        alias: r.tenant.alias,
        provider: r.tenant.provider,
        roleKey: r.role.key,
        current: r.tenant.id === req.user!.tenant.id,
      }))
    );
  })
);

// POST /api/auth/switch — pindah konteks ke identitas lain milik user yg sama
// (operator platform ⇄ perusahaannya; pemilik beberapa perusahaan ⇄ antar-perusahaan)
authRouter.post(
  "/auth/switch",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = z.object({ tenantId: z.string().min(1).max(64) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const me = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { providerUserId: true },
    });
    if (!me) return res.status(401).json({ error: "belum_login" });
    const target = await prisma.user.findFirst({
      where: { providerUserId: me.providerUserId, tenantId: body.data.tenantId },
      include: { tenant: { select: { provider: true } } },
    });
    if (!target) return res.status(403).json({ error: "bukan_anggota" });
    // hanya ke tenant platform internal atau perusahaan dgn koneksi Accurate nyata
    const isPlatformTenant = target.tenant.provider === "platform";
    const realConn = await prisma.connection.findFirst({
      where: { tenantId: target.tenantId, provider: "accurate", host: { contains: "accurate.id" } },
      select: { id: true },
    });
    if (!isPlatformTenant && !realConn) return res.status(403).json({ error: "tenant_tidak_aktif" });
    const oldSid = req.cookies?.sid as string | undefined;
    if (oldSid) await prisma.session.deleteMany({ where: { id: oldSid } });
    const sid = randomBytes(32).toString("hex");
    await prisma.session.create({
      data: { id: sid, userId: target.id, expiresAt: new Date(Date.now() + 7 * 86400_000) },
    });
    res.cookie("sid", sid, { httpOnly: true, sameSite: "lax", maxAge: 7 * 86400_000 });
    await writeAudit(target.tenantId, target.id, "auth.switch", { fromTenantId: req.user!.tenant.id });
    res.json({ ok: true, tenantId: target.tenantId });
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
