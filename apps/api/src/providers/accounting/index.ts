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

export const OAUTH_REDIRECT_URI = "http://localhost:3001/api/oauth/accurate/callback";
