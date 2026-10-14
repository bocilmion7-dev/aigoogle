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
  /** email (pisahkan koma) yang berhak jadi Admin Platform — bukan sekadar admin Accurate */
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
  GOOGLE_OAUTH_CLIENT_ID: z.string().default(""),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
  /** NVIDIA NIM (OpenAI-compatible) — opsional, utk failover provider kedua */
  NVIDIA_API_KEY: z.string().default(""),
  /** Router OpenAI-compatible (mis. router.bangunweb.com) — provider tunggal chat bila diisi; menonaktifkan Gemini & NVIDIA */
  ROUTER_API_KEY: z.string().default(""),
  ROUTER_BASE_URL: z.string().default("http://localhost:20128/v1"),
  ROUTER_MODEL: z.string().default("ocfree/mimo-v2.6-flash-free,ocfree/space-bunny-free,ocfree/big-pickle,ocfree/fledge-alpha-free,ocfree/ling-3.1-flash-free,ocfree/longcat-2.5-preview-free,ocfree/muse-spark-1.2-contributor-free,ocfree/muse-spark-1.3-contributor-free,ocfree/nemotron-3-ultra-free,ocfree/nemotron-3.5-lightning-free,ocfree/step-5-preview-free"),
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
  BILLING_ENABLED: z.string().default("0"),
  MIDTRANS_SERVER_KEY: z.string().default(""),
  MIDTRANS_CLIENT_KEY: z.string().default(""),
  META_APP_ID: z.string().default(""),
  META_APP_SECRET: z.string().default(""),
  META_WABA_ID: z.string().default(""),
  META_EMBEDDED_CONFIG_ID: z.string().default(""),
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
