import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1, "DATABASE_URL wajib diisi"),
  TOKEN_ENC_KEY: z.string().regex(/^[0-9a-f]{64}$/, "TOKEN_ENC_KEY = 64 hex (32 byte)"),
  ACCURATE_CLIENT_ID: z.string().min(1),
  ACCURATE_CLIENT_SECRET: z.string().min(1),
  ACCURATE_API_BASE: z.string().default("https://account.accurate.id"),
  MOCK_ACCURATE_URL: z.string().default(""),
  APP_ORIGIN: z.string().default("http://localhost:5173"),
  GOOGLE_OAUTH_CLIENT_ID: z.string().default(""),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
  GEMINI_TTS_MODEL: z.string().default("gemini-3.8-flash-tts"),
  GEMINI_TRANSCRIBE_MODEL: z.string().default("gemini-3.5-transcribe"),
});
function parseEnv() {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    console.error("Env tidak valid:");
    for (const issue of parsed.error.issues) {
      console.error(` - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}
export const env = parseEnv();
