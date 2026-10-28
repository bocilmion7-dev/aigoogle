import { Router, type Response } from "express";
import QRCode from "qrcode";
import { env } from "../env.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { isTenantSuspended, requireUser, requireUserOrPlatform } from "../middleware/session.js";
import { asyncHandler } from "../asyncHandler.js";
import { hashPassword, validatePasswordStrength, verifyPassword } from "../password.js";
import { writeAudit } from "../audit.js";
import { escapeHtml, sendMail } from "../mail.js";
import { renderMailLayout } from "../mail/templates.js";
import {
  clearImpersonationCookie,
  clearPlatformCookie,
  clearSessionCookie,
  readPlatformId,
  readSessionId,
  setPlatformCookie,
  setSessionCookie,
} from "../cookies.js";
import {
  consumeToken,
  createToken,
  disableTwoFactor,
  getTwoFactor,
  isEmailVerified,
  markEmailVerified,
  saveTwoFactorSecret,
} from "../auth/tokens.js";
import { generateTotpSecret, totpUri, verifyTotp } from "../auth/totp.js";
import { consumeBackupCode, deleteBackupCodes, generateBackupCodes } from "../auth/backup-codes.js";
import {
  createEmailOtpChallenge,
  getEmailOtpInfo,
  isEmailOtpEnabled,
  resendEmailOtp,
  setEmailOtpEnabled,
  verifyEmailOtp,
} from "../auth/email-otp.js";

export const authRouter = Router();

const SESSION_TTL_MS = 7 * 86400_000;

export async function issueCompanySession(res: Response, userId: string): Promise<void> {
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
  setSessionCookie(res, sid, SESSION_TTL_MS);
  clearPlatformCookie(res);
  clearImpersonationCookie(res);
}

async function issuePlatformSession(res: Response, platformUserId: string): Promise<void> {
  const sid = randomBytes(32).toString("hex");
  await prisma.platformSession.create({
    data: { id: sid, platformUserId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  setPlatformCookie(res, sid, SESSION_TTL_MS);
  clearSessionCookie(res);
  clearImpersonationCookie(res);
}

function verifyEmailHtml(name: string, link: string): string {
  const safe = escapeHtml(name || "Pengguna");
  return renderMailLayout({
    heading: "Verifikasi email Anda",
    preheader: "Klik tautan untuk memverifikasi email akun AI Asisten",
    intro: `Halo ${safe}, klik tombol di bawah untuk memverifikasi email akun AI Asisten Anda.`,
    bodyHtml: `<p style="margin:0;font-size:14px;line-height:1.6;color:#44403c">Verifikasi diperlukan agar notifikasi, invoice, dan keamanan akun dapat dikirim ke email Anda.</p>`,
    cta: { label: "Verifikasi email", url: link },
    note: "Tautan berlaku 24 jam. Abaikan email ini jika Anda tidak memintanya.",
  });
}

async function sendVerificationEmail(user: { id: string; email: string; name: string }): Promise<void> {
  const token = await createToken("verify", { userId: user.id }, 24 * 3600_000);
  const link = `${env.APP_ORIGIN}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: user.email,
    subject: "Verifikasi email AI Asisten",
    text:
      `Halo ${user.name || "Pengguna"},\n\n` +
      `Verifikasi email Anda dengan membuka tautan berikut:\n${link}\n\n` +
      `Tautan berlaku 24 jam.`,
    html: verifyEmailHtml(user.name, link),
  });
}

const resetRateKey = (email: string) =>
  `auth:forgot_rate:${createHash("sha256").update(email.toLowerCase()).digest("hex")}`;

/** Cooldown 5 menit + maks 5 email reset/hari per alamat email (anti email-bombing). */
async function allowResetEmail(email: string): Promise<boolean> {
  const key = resetRateKey(email);
  const now = Date.now();
  const day = new Date().toISOString().slice(0, 10);
  const row = await prisma.appSetting.findUnique({ where: { key } });
  let data: { day?: string; count?: number; last?: number } = {};
  try {
    data = row ? (JSON.parse(row.value) as typeof data) : {};
  } catch {
    data = {};
  }
  const count = data.day === day ? Number(data.count ?? 0) : 0;
  if (now - Number(data.last ?? 0) < 5 * 60_000) return false;
  if (count >= 5) return false;
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: JSON.stringify({ day, count: count + 1, last: now }) },
    update: { value: JSON.stringify({ day, count: count + 1, last: now }) },
  });
  return true;
}

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const SetPasswordBody = z.object({
  password: z.string().min(1),
});

authRouter.post(
  "/auth/login",
  rateLimit({ name: "login", windowMs: 15 * 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const body = LoginBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    // Email TIDAK unik global — bisa sama di banyak tenant. findFirst sembarangan
    // akan memilih tenant secara arbitrer (→ bocor antar-tenant). Bila email
    // terdaftar di >1 perusahaan, tolak dan minta login via Accurate (OAuth)
    // supaya tenant dipilih berdasarkan kredensial provider, bukan tebakan.
    const candidates = await prisma.user.findMany({
      where: { email: body.data.email.toLowerCase(), passwordHash: { not: "" } },
      select: { id: true, email: true, name: true, passwordHash: true, tenantId: true },
    });
    if (candidates.length > 1) {
      return res.status(409).json({ error: "email_terdaftar_di_banyak_perusahaan" });
    }
    const user = candidates[0];
    if (!user || !verifyPassword(body.data.password, user.passwordHash)) {
      return res.status(401).json({ error: "email_atau_password_salah" });
    }
    if (await isTenantSuspended(user.tenantId)) {
      return res.status(403).json({ error: "tenant_ditangguhkan" });
    }
    const two = await getTwoFactor(user.id);
    if (two.enabled) {
      const challenge = await createToken("2fa_challenge", { userId: user.id, platform: false }, 5 * 60_000);
      return res.json({ ok: false, twoFactorRequired: true, challenge });
    }
    if (await isEmailOtpEnabled(user.id)) {
      try {
        const challenge = await createEmailOtpChallenge({
          userId: user.id,
          platform: false,
          email: user.email,
          name: user.name,
        });
        return res.json({ ok: false, emailOtpRequired: true, challenge });
      } catch {
        return res.status(502).json({ error: "email_otp_gagal" });
      }
    }
    await issueCompanySession(res, user.id);
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
  rateLimit({ name: "platform-login", windowMs: 15 * 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const body = PlatformLoginBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const u = await prisma.platformUser.findUnique({ where: { email: body.data.email.toLowerCase() } });
    if (!u || !u.passwordHash || !verifyPassword(body.data.password, u.passwordHash)) {
      return res.status(401).json({ error: "email_atau_password_salah" });
    }
    const two = await getTwoFactor(u.id);
    if (two.enabled) {
      const challenge = await createToken("2fa_challenge", { userId: u.id, platform: true }, 5 * 60_000);
      return res.json({ ok: false, twoFactorRequired: true, challenge });
    }
    if (await isEmailOtpEnabled(u.id)) {
      try {
        const challenge = await createEmailOtpChallenge({
          userId: u.id,
          platform: true,
          email: u.email,
          name: u.name,
        });
        return res.json({ ok: false, emailOtpRequired: true, challenge });
      } catch {
        return res.status(502).json({ error: "email_otp_gagal" });
      }
    }
    await issuePlatformSession(res, u.id);
    res.json({ ok: true });
  })
);

authRouter.post(
  "/platform/logout",
  asyncHandler(async (req, res) => {
    const psid = readPlatformId(req);
    if (psid) await prisma.platformSession.deleteMany({ where: { id: psid } });
    clearPlatformCookie(res);
    res.json({ ok: true });
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
    // Sesi lama (termasuk sesi attacker saat akun masih passwordless) dicabut.
    const currentSid = readSessionId(req);
    await prisma.session.deleteMany({
      where: { userId: user.id, ...(currentSid ? { id: { not: currentSid } } : {}) },
    });
    await writeAudit(user.tenantId, user.id, "auth.set_password", {});
    void sendVerificationEmail(user).catch(() => null);
    res.json({ ok: true });
  })
);

/* ── Lupa / reset password ───────────────────────────────────────────────── */

authRouter.post(
  "/auth/forgot-password",
  rateLimit({ name: "forgot-password", windowMs: 15 * 60_000, max: 5 }),
  asyncHandler(async (req, res) => {
    const body = z.object({ email: z.string().email() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const email = body.data.email.toLowerCase();
    const users = await prisma.user.findMany({
      where: { email },
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        tenant: { select: { name: true } },
      },
    });
    if (!users.length) return res.json({ ok: true });
    if (!(await allowResetEmail(email))) {
      // Cooldown / kuota harian — jawab sama tanpa mengirim email.
      return res.json({ ok: true });
    }
    const links: Array<{ url: string; tenant: string }> = [];
    for (const u of users) {
      const token = await createToken("reset", { userId: u.id, tenantId: u.tenantId }, 30 * 60_000);
      links.push({
        url: `${env.APP_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`,
        tenant: u.tenant.name,
      });
    }
    if (links.length) {
      const text =
        `Kami menerima permintaan reset password untuk akun ini.\n\n` +
        links.map((l, i) => (links.length > 1 ? `${i + 1}. ${l.tenant}\n${l.url}` : l.url)).join("\n\n") +
        `\n\nTautan berlaku 30 menit. Abaikan email ini jika Anda tidak memintanya.`;
      const cards = links
        .map(
          (l, i) =>
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e7e5e4;border-radius:12px;background:#fafaf9;margin:0 0 12px">` +
            `<tr><td style="padding:16px 18px">` +
            (links.length > 1
              ? `<p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#78716c">AKUN ${i + 1}</p>`
              : "") +
            `<p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#1c1917">${escapeHtml(l.tenant)}</p>` +
            `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#ea580c" style="border-radius:8px">` +
            `<a href="${l.url}" style="display:inline-block;padding:11px 18px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13.5px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">Reset password</a>` +
            `</td></tr></table>` +
            `</td></tr></table>`
        )
        .join("");
      const html = renderMailLayout({
        heading: "Reset password",
        preheader: "Tautan reset password — berlaku 30 menit",
        intro: "Kami menerima permintaan reset password untuk akun Anda.",
        bodyHtml: cards,
        note: "Tautan berlaku 30 menit. Abaikan email ini jika Anda tidak memintanya. Jika Anda tidak merasa melakukan permintaan ini, abaikan saja — tidak ada perubahan pada akun Anda.",
      });
      void sendMail({ to: email, subject: "Reset password AI Asisten", text, html });
    }
    // Selalu jawab sama agar tidak bisa dipakai menebak email terdaftar.
    res.json({ ok: true });
  })
);

authRouter.post(
  "/auth/reset-password",
  rateLimit({ name: "reset-password", windowMs: 15 * 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const body = z
      .object({ token: z.string().min(10), password: z.string().min(1) })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const strength = validatePasswordStrength(body.data.password);
    if (strength) return res.status(400).json({ error: strength });
    const data = await consumeToken("reset", body.data.token);
    if (!data) return res.status(400).json({ error: "token_tidak_valid" });
    const userId = String(data.userId ?? "");
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(400).json({ error: "token_tidak_valid" });
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(body.data.password), email: user.email.toLowerCase() },
    });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    if (!(await isEmailVerified(user.id))) void sendVerificationEmail(user).catch(() => null);
    await writeAudit(user.tenantId, user.id, "auth.reset_password", {});
    res.json({ ok: true });
  })
);

authRouter.get(
  "/auth/verify-email",
  rateLimit({ name: "verify-email", windowMs: 15 * 60_000, max: 30 }),
  asyncHandler(async (req, res) => {
    const token = String(req.query.token ?? "");
    const data = await consumeToken("verify", token);
    if (!data) return res.status(400).json({ error: "token_tidak_valid" });
    const userId = String(data.userId ?? "");
    await markEmailVerified(userId);
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { tenantId: true } });
    if (u) await writeAudit(u.tenantId, userId, "auth.email_verified", {});
    res.redirect(`${env.APP_ORIGIN}/?verified=1`);
  })
);

authRouter.post(
  "/auth/resend-verification",
  requireUser,
  rateLimit({ name: "resend-verification", windowMs: 15 * 60_000, max: 5 }),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ error: "user_tidak_ditemukan" });
    if (await isEmailVerified(user.id)) return res.status(409).json({ error: "sudah_verifikasi" });
    await sendVerificationEmail(user);
    await writeAudit(user.tenantId, user.id, "auth.verification_resent", {});
    res.json({ ok: true });
  })
);

/* ── 2FA / TOTP ──────────────────────────────────────────────────────────── */

authRouter.post(
  "/auth/2fa",
  rateLimit({ name: "2fa", windowMs: 15 * 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const body = z
      .object({ challenge: z.string().min(10), code: z.string().min(6).max(12) })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const data = await consumeToken("2fa_challenge", body.data.challenge);
    if (!data) return res.status(401).json({ error: "challenge_tidak_valid" });
    const userId = String(data.userId ?? "");
    const platform = data.platform === true;
    const two = await getTwoFactor(userId);
    const totpOk = !!two.secret && verifyTotp(two.secret, body.data.code);
    const backupOk = !totpOk && (await consumeBackupCode(userId, body.data.code));
    if (!two.enabled || (!totpOk && !backupOk)) {
      return res.status(401).json({ error: "kode_salah" });
    }
    if (platform) {
      const u = await prisma.platformUser.findUnique({ where: { id: userId } });
      if (!u) return res.status(401).json({ error: "akun_tidak_ditemukan" });
      await issuePlatformSession(res, userId);
      res.json({ ok: true, platform: true });
      return;
    }
    const u = await prisma.user.findUnique({ where: { id: userId } });
    if (!u) return res.status(401).json({ error: "akun_tidak_ditemukan" });
    await issueCompanySession(res, userId);
    await writeAudit(u.tenantId, u.id, "auth.login", { via: totpOk ? "2fa" : "backup_code" });
    res.json({ ok: true, platform: false, needsPassword: !u.passwordHash });
  })
);

authRouter.post(
  "/auth/otp/info",
  rateLimit({ name: "email-otp-info", windowMs: 15 * 60_000, max: 60 }),
  asyncHandler(async (req, res) => {
    const body = z.object({ challenge: z.string().min(10) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const info = await getEmailOtpInfo(body.data.challenge);
    if (!info) return res.status(404).json({ error: "challenge_tidak_valid" });
    res.json(info);
  })
);

authRouter.post(
  "/auth/otp",
  rateLimit({ name: "email-otp", windowMs: 15 * 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const body = z
      .object({ challenge: z.string().min(10), code: z.string().min(6).max(6) })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const data = await verifyEmailOtp(body.data.challenge, body.data.code);
    if (!data) return res.status(401).json({ error: "kode_salah" });
    if (data.platform) {
      const u = await prisma.platformUser.findUnique({ where: { id: data.userId } });
      if (!u) return res.status(401).json({ error: "akun_tidak_ditemukan" });
      await issuePlatformSession(res, u.id);
      res.json({ ok: true, platform: true });
      return;
    }
    const u = await prisma.user.findUnique({ where: { id: data.userId } });
    if (!u) return res.status(401).json({ error: "akun_tidak_ditemukan" });
    await issueCompanySession(res, u.id);
    await writeAudit(u.tenantId, u.id, "auth.login", { via: "email_otp" });
    res.json({ ok: true, platform: false, needsPassword: !u.passwordHash });
  })
);

authRouter.post(
  "/auth/otp/resend",
  rateLimit({ name: "email-otp-resend", windowMs: 15 * 60_000, max: 5 }),
  asyncHandler(async (req, res) => {
    const body = z.object({ challenge: z.string().min(10) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    try {
      const challenge = await resendEmailOtp(body.data.challenge);
      if (!challenge) return res.status(400).json({ error: "challenge_tidak_valid" });
      res.json({ ok: true, challenge, resendAfter: Date.now() + 60_000 });
    } catch (e) {
      if (e instanceof Error && e.message === "otp_cooldown") {
        return res.status(429).json({ error: "tunggu_sebentar", retryAfter: 60 });
      }
      res.status(502).json({ error: "email_otp_gagal" });
    }
  })
);

authRouter.post(
  "/auth/2fa/setup",
  requireUserOrPlatform,
  asyncHandler(async (req, res) => {
    const id = req.user?.id ?? req.platform?.id;
    const email = req.user?.email ?? req.platform?.email ?? id ?? "";
    if (!id) return res.status(401).json({ error: "belum_login" });
    const existing = await getTwoFactor(id);
    if (existing.enabled) return res.status(409).json({ error: "sudah_aktif" });
    const secret = generateTotpSecret();
    await saveTwoFactorSecret(id, secret, false);
    const uri = totpUri(secret, email);
    const qrDataUrl = await QRCode.toDataURL(uri, {
      margin: 1,
      width: 220,
      color: { dark: "#17150f", light: "#ffffff" },
    });
    res.json({ secret, uri, qrDataUrl });
  })
);

authRouter.post(
  "/auth/2fa/enable",
  requireUserOrPlatform,
  asyncHandler(async (req, res) => {
    const id = req.user?.id ?? req.platform?.id;
    if (!id) return res.status(401).json({ error: "belum_login" });
    const body = z.object({ code: z.string().min(6).max(6) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const two = await getTwoFactor(id);
    if (!two.secret) return res.status(400).json({ error: "setup_dulu" });
    if (!verifyTotp(two.secret, body.data.code)) return res.status(400).json({ error: "kode_salah" });
    await saveTwoFactorSecret(id, two.secret, true);
    const backupCodes = await generateBackupCodes(id);
    if (req.user) await writeAudit(req.user.tenant.id, req.user.id, "auth.2fa_enable", {});
    res.json({ ok: true, backupCodes });
  })
);

authRouter.post(
  "/auth/2fa/backup-codes",
  requireUserOrPlatform,
  asyncHandler(async (req, res) => {
    const id = req.user?.id ?? req.platform?.id;
    if (!id) return res.status(401).json({ error: "belum_login" });
    const body = z
      .object({ password: z.string().min(1), code: z.string().min(6).max(12) })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const account = req.platform
      ? await prisma.platformUser.findUnique({ where: { id } })
      : await prisma.user.findUnique({ where: { id } });
    if (!account || !verifyPassword(body.data.password, account.passwordHash)) {
      return res.status(401).json({ error: "password_salah" });
    }
    const two = await getTwoFactor(id);
    if (!two.enabled || !two.secret || !verifyTotp(two.secret, body.data.code)) {
      return res.status(400).json({ error: "kode_salah" });
    }
    const backupCodes = await generateBackupCodes(id);
    if (req.user) await writeAudit(req.user.tenant.id, req.user.id, "auth.2fa_backup_regenerate", {});
    res.json({ ok: true, backupCodes });
  })
);

authRouter.post(
  "/auth/2fa/disable",
  requireUserOrPlatform,
  asyncHandler(async (req, res) => {
    const id = req.user?.id ?? req.platform?.id;
    if (!id) return res.status(401).json({ error: "belum_login" });
    const body = z
      .object({ password: z.string().min(1), code: z.string().min(6).max(6) })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const account = req.platform
      ? await prisma.platformUser.findUnique({ where: { id } })
      : await prisma.user.findUnique({ where: { id } });
    if (!account || !verifyPassword(body.data.password, account.passwordHash)) {
      return res.status(401).json({ error: "password_salah" });
    }
    const two = await getTwoFactor(id);
    if (!two.enabled || !two.secret || !verifyTotp(two.secret, body.data.code)) {
      return res.status(400).json({ error: "kode_salah" });
    }
    await disableTwoFactor(id);
    await deleteBackupCodes(id);
    if (req.user) await writeAudit(req.user.tenant.id, req.user.id, "auth.2fa_disable", {});
    res.json({ ok: true });
  })
);

authRouter.put(
  "/me/email-otp",
  requireUserOrPlatform,
  asyncHandler(async (req, res) => {
    const id = req.user?.id ?? req.platform?.id;
    if (!id) return res.status(401).json({ error: "belum_login" });
    const body = z
      .object({ enabled: z.boolean(), password: z.string().min(1) })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const account = req.platform
      ? await prisma.platformUser.findUnique({ where: { id } })
      : await prisma.user.findUnique({ where: { id } });
    if (!account || !verifyPassword(body.data.password, account.passwordHash)) {
      return res.status(401).json({ error: "password_salah" });
    }
    await setEmailOtpEnabled(id, body.data.enabled);
    if (req.user) {
      await writeAudit(req.user.tenant.id, req.user.id, "auth.email_otp_update", {
        enabled: body.data.enabled,
      });
    }
    res.json({ ok: true, enabled: body.data.enabled });
  })
);

/* ── Manajemen sesi perangkat ────────────────────────────────────────────── */

authRouter.get(
  "/me/sessions",
  requireUserOrPlatform,
  asyncHandler(async (req, res) => {
    if (req.platform) {
      const rows = await prisma.platformSession.findMany({
        where: { platformUserId: req.platform.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      res.json(
        rows.map((s) => ({
          id: s.id,
          current: readPlatformId(req) === s.id,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
        }))
      );
      return;
    }
    const rows = await prisma.session.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(
      rows.map((s) => ({
        id: s.id,
        current: readSessionId(req) === s.id,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      }))
    );
  })
);

authRouter.delete(
  "/me/sessions/:id",
  requireUserOrPlatform,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? "");
    if (req.platform) {
      await prisma.platformSession.deleteMany({ where: { id, platformUserId: req.platform.id } });
      if (readPlatformId(req) === id) clearPlatformCookie(res);
    } else {
      await prisma.session.deleteMany({ where: { id, userId: req.user!.id } });
      if (readSessionId(req) === id) clearSessionCookie(res);
    }
    res.json({ ok: true });
  })
);
