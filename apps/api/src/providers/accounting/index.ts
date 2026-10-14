import { env } from "../../env.js";
import { AccurateAdapter } from "./accurate.js";
import type { AccountingProvider } from "./types.js";

export function accurateProvider(): AccountingProvider {
  return new AccurateAdapter({
    clientId: env.ACCURATE_CLIENT_ID,
    clientSecret: env.ACCURATE_CLIENT_SECRET,
    apiBase: process.env.MOCK_ACCURATE_URL || env.ACCURATE_API_BASE,
  });
}

/** Origin publik aplikasi — SATU sumber kebenaran (APP_ORIGIN di .env). */
const origin = env.APP_ORIGIN.replace(/\/$/, "");

export const OAUTH_REDIRECT_URI = `${origin}/api/oauth/accurate/callback`;

/** redirect_uri CTA OAuth (harus terdaftar di Area Developer Accurate — derive dari APP_ORIGIN). */
export const ACCURATE_REDIRECT_URI = `${origin}/api/callback/accurate`;

/** Provider ke Accurate ASLI (memakai ACCURATE_API_BASE, abaikan mock) — untuk callback CTA. */
export function realAccurateProvider(): AccountingProvider {
  return new AccurateAdapter({
    clientId: env.ACCURATE_CLIENT_ID,
    clientSecret: env.ACCURATE_CLIENT_SECRET,
    apiBase: env.ACCURATE_API_BASE,
  });
}
