import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env.js";

const KEY = Buffer.from(env.TOKEN_ENC_KEY, "hex");

export function encryptToken(plain: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, nonce);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [nonce, tag, enc].map((b) => b.toString("base64")).join(".");
}

export function decryptToken(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 3) throw new Error("token tidak valid");
  const [nonce, tag, enc] = parts.map((s) => Buffer.from(s, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", KEY, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
