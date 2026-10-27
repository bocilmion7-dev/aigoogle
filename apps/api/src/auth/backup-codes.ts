import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../db.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const COUNT = 10;
const keyOf = (userId: string) => `auth:2fa_backup:${userId}`;

function normalize(code: string): string {
  return String(code).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function hashCode(code: string): string {
  return createHash("sha256").update(normalize(code)).digest("hex");
}

function randomCode(): string {
  const bytes = randomBytes(8);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

async function saveHashes(userId: string, hashes: string[]): Promise<void> {
  const key = keyOf(userId);
  const value = JSON.stringify({ codes: hashes, updatedAt: new Date().toISOString() });
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

/** Buat 10 backup code baru. Plain code HANYA dikembalikan sekali. */
export async function generateBackupCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: COUNT }, randomCode);
  await saveHashes(userId, codes.map(hashCode));
  return codes;
}

export async function consumeBackupCode(userId: string, code: string): Promise<boolean> {
  const normalized = normalize(code);
  if (normalized.length !== 8) return false;
  const key = keyOf(userId);
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row) return false;
  let hashes: string[] = [];
  try {
    hashes = (JSON.parse(row.value) as { codes?: string[] }).codes ?? [];
  } catch {
    return false;
  }
  const target = Buffer.from(hashCode(normalized), "hex");
  const idx = hashes.findIndex((h) => {
    const buf = Buffer.from(h, "hex");
    return buf.length === target.length && timingSafeEqual(buf, target);
  });
  if (idx < 0) return false;
  const next = hashes.filter((_, i) => i !== idx);
  await saveHashes(userId, next);
  return true;
}

export async function backupCodesRemaining(userId: string): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: keyOf(userId) } });
  if (!row) return 0;
  try {
    return ((JSON.parse(row.value) as { codes?: string[] }).codes ?? []).length;
  } catch {
    return 0;
  }
}

export async function deleteBackupCodes(userId: string): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: keyOf(userId) } });
}
