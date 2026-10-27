import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { decryptToken, encryptToken } from "../crypto.js";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type TokenKind = "reset" | "verify" | "2fa_challenge" | "email_otp";

export async function createToken(
  kind: TokenKind,
  payload: Record<string, unknown>,
  ttlMs: number
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const key = `auth:${kind}:${hashToken(token)}`;
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: JSON.stringify({ ...payload, exp: Date.now() + ttlMs }) },
    update: { value: JSON.stringify({ ...payload, exp: Date.now() + ttlMs }) },
  });
  return token;
}

export async function peekToken(
  kind: TokenKind,
  token: string
): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  const key = `auth:${kind}:${hashToken(token)}`;
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row) return null;
  try {
    const data = JSON.parse(row.value) as Record<string, unknown>;
    if (Number(data.exp ?? 0) < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

/** Ambil token secara atomik (delete-return). Untuk OTP: kode salah bisa direstore. */
export async function takeToken(
  kind: TokenKind,
  token: string
): Promise<{ data: Record<string, unknown>; raw: string } | null> {
  if (!token) return null;
  const key = `auth:${kind}:${hashToken(token)}`;
  const row = await prisma.appSetting.delete({ where: { key } }).catch(() => null);
  if (!row) return null;
  try {
    const data = JSON.parse(row.value) as Record<string, unknown>;
    if (Number(data.exp ?? 0) < Date.now()) return null;
    return { data, raw: row.value };
  } catch {
    return null;
  }
}

export async function restoreToken(kind: TokenKind, token: string, raw: string): Promise<void> {
  const key = `auth:${kind}:${hashToken(token)}`;
  await prisma.appSetting.create({ data: { key, value: raw } }).catch(() => null);
}

export async function consumeToken(
  kind: TokenKind,
  token: string
): Promise<Record<string, unknown> | null> {
  const taken = await takeToken(kind, token);
  return taken?.data ?? null;
}

const twoFactorKey = (userId: string) => `auth:2fa:${userId}`;

export async function getTwoFactor(userId: string): Promise<{
  enabled: boolean;
  secret: string | null;
}> {
  const row = await prisma.appSetting.findUnique({ where: { key: twoFactorKey(userId) } });
  if (!row) return { enabled: false, secret: null };
  try {
    const data = JSON.parse(row.value) as { enabled?: boolean; secretEnc?: string };
    return {
      enabled: !!data.enabled,
      secret: data.secretEnc ? decryptToken(data.secretEnc) : null,
    };
  } catch {
    return { enabled: false, secret: null };
  }
}

export async function saveTwoFactorSecret(userId: string, secret: string, enabled: boolean): Promise<void> {
  const key = twoFactorKey(userId);
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: JSON.stringify({ enabled, secretEnc: encryptToken(secret) }) },
    update: { value: JSON.stringify({ enabled, secretEnc: encryptToken(secret) }) },
  });
}

export async function disableTwoFactor(userId: string): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: twoFactorKey(userId) } });
}

export async function isEmailVerified(userId: string): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: `auth:email_verified:${userId}` } });
  return row?.value === "1";
}

export async function markEmailVerified(userId: string): Promise<void> {
  const key = `auth:email_verified:${userId}`;
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: "1" },
    update: { value: "1" },
  });
}
