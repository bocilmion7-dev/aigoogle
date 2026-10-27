import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { sendMail, escapeHtml } from "../mail.js";
import { createToken, peekToken, restoreToken, takeToken } from "./tokens.js";

/**
 * OTP via email — faktor kedua default untuk semua akun.
 * TOTP (authenticator) tetap lebih utama bila user mengaktifkannya.
 */
export async function isEmailOtpEnabled(userId: string): Promise<boolean> {
  const global = await prisma.appSetting.findUnique({ where: { key: "auth:require_email_otp" } });
  if (global?.value === "0") {
    const row = await prisma.appSetting.findUnique({ where: { key: `auth:email_otp:${userId}` } });
    return row?.value === "1";
  }
  const row = await prisma.appSetting.findUnique({ where: { key: `auth:email_otp:${userId}` } });
  if (row?.value === "0") return false;
  if (row?.value === "1") return true;
  // Default aman: aktif bila email transaksional dikonfigurasi. Saat test
  // nonaktif agar suite tidak meminta OTP; bisa dipaksa via AppSetting.
  return !!env.RESEND_API_KEY && process.env.NODE_ENV !== "test";
}

export async function setEmailOtpEnabled(userId: string, enabled: boolean): Promise<void> {
  const key = `auth:email_otp:${userId}`;
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: enabled ? "1" : "0" },
    update: { value: enabled ? "1" : "0" },
  });
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export async function createEmailOtpChallenge(opts: {
  userId: string;
  platform: boolean;
  email: string;
  name: string;
}): Promise<string> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const challenge = await createToken(
    "email_otp",
    {
      userId: opts.userId,
      platform: opts.platform,
      email: opts.email,
      codeHash: hashCode(code),
      sentAt: Date.now(),
    },
    10 * 60_000
  );
  const safeName = escapeHtml(opts.name || "Pengguna");
  const sent = await sendMail({
    to: opts.email,
    subject: `Kode OTP AI Asisten: ${code}`,
    text:
      `Halo ${opts.name || "Pengguna"},\n\n` +
      `Kode OTP login Anda adalah: ${code}\n\n` +
      `Kode berlaku 10 menit. Jangan bagikan kode ini kepada siapa pun.\n` +
      `Jika Anda tidak mencoba login, abaikan email ini.`,
    html:
      `<p>Halo <strong>${safeName}</strong>,</p>` +
      `<p>Kode OTP login Anda:</p>` +
      `<p style="font-size:28px;letter-spacing:6px;font-weight:700;margin:16px 0">${code}</p>` +
      `<p>Kode berlaku <strong>10 menit</strong>. Jangan bagikan kode ini kepada siapa pun.</p>` +
      `<p style="color:#666">Jika Anda tidak mencoba login, abaikan email ini.</p>`,
  });
  if (!sent) {
    // Jangan tinggalkan challenge yang tidak bisa dipakai.
    await takeToken("email_otp", challenge).catch(() => null);
    throw new Error("email_otp_gagal");
  }
  return challenge;
}

export async function verifyEmailOtp(
  challenge: string,
  code: string
): Promise<{ userId: string; platform: boolean } | null> {
  const taken = await takeToken("email_otp", challenge);
  if (!taken) return null;
  const { data, raw } = taken;
  const cleanCode = String(code).replace(/\D/g, "");
  const bypass =
    !!env.TEST_OTP_BYPASS_EMAIL &&
    !!env.TEST_OTP_BYPASS_CODE &&
    String(data.email ?? "").toLowerCase() === env.TEST_OTP_BYPASS_EMAIL.toLowerCase() &&
    cleanCode === env.TEST_OTP_BYPASS_CODE;
  const expected = Buffer.from(String(data.codeHash ?? ""), "hex");
  const actual = Buffer.from(hashCode(cleanCode), "hex");
  const ok = bypass || (expected.length === actual.length && timingSafeEqual(expected, actual));
  if (!ok) {
    // Kode salah bukan berarti challenge mati — kembalikan agar user bisa retry.
    await restoreToken("email_otp", challenge, raw);
    return null;
  }
  return { userId: String(data.userId ?? ""), platform: data.platform === true };
}

export async function getEmailOtpInfo(challenge: string): Promise<{
  emailMasked: string;
  resendAfter: number;
  expiresAt: number;
} | null> {
  const data = await peekToken("email_otp", challenge);
  if (!data) return null;
  const email = String(data.email ?? "");
  const [name, domain] = email.split("@");
  const masked = name && domain ? `${name.slice(0, 1)}${"*".repeat(Math.max(2, name.length - 1))}@${domain}` : "email Anda";
  const sentAt = Number(data.sentAt ?? 0);
  const exp = Number(data.exp ?? 0);
  return {
    emailMasked: masked,
    resendAfter: sentAt ? sentAt + 60_000 : Date.now() + 60_000,
    expiresAt: exp,
  };
}

export async function resendEmailOtp(challenge: string): Promise<string | null> {
  const taken = await takeToken("email_otp", challenge);
  if (!taken) return null;
  const { data, raw } = taken;
  const sentAt = Number(data.sentAt ?? 0);
  if (sentAt && Date.now() - sentAt < 60_000) {
    await restoreToken("email_otp", challenge, raw);
    throw new Error("otp_cooldown");
  }
  const userId = String(data.userId ?? "");
  const platform = data.platform === true;
  if (platform) {
    const u = await prisma.platformUser.findUnique({ where: { id: userId } });
    if (!u) return null;
    return createEmailOtpChallenge({ userId: u.id, platform: true, email: u.email, name: u.name });
  }
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u) return null;
  return createEmailOtpChallenge({ userId: u.id, platform: false, email: u.email, name: u.name });
}
