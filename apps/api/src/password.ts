import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEYLEN).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored.startsWith("scrypt:")) return false;
  const [, salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, KEYLEN);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Minimal: ≥12 karakter, huruf besar/kecil, angka, dan simbol. */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 12) return "minimal_12";
  if (!/[a-z]/.test(password)) return "butuh_huruf_kecil";
  if (!/[A-Z]/.test(password)) return "butuh_huruf_besar";
  if (!/\d/.test(password)) return "butuh_angka";
  if (!/[^A-Za-z0-9]/.test(password)) return "butuh_simbol";
  return null;
}
