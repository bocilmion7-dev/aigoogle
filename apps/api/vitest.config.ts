import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { resolve } from "node:path";

/**
 * Guard: suite test WAJIB memakai database *_test, tidak boleh menyentuh
 * production. DATABASE_URL diturunkan dari .env root lalu dipaksa ke
 * <dbname>_test; override DATABASE_URL_TEST hanya boleh database *_test
 * (kecuali AIGOOGLE_TEST_ALLOW_ANY_DB=1).
 */
function toTestDatabaseUrl(raw: string, allowAny: boolean): string {
  const url = new URL(raw);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!dbName) throw new Error("DATABASE_URL tidak punya nama database");
  const target = dbName.endsWith("_test") ? dbName : `${dbName}_test`;
  if (!allowAny && !target.endsWith("_test")) {
    throw new Error(
      `DATABASE test ditolak: "${target}" harus berakhiran _test (AIGOOGLE_TEST_ALLOW_ANY_DB=1 untuk memaksa)`,
    );
  }
  url.pathname = `/${encodeURIComponent(target)}`;
  return url.toString();
}

export default defineConfig(() => {
  const env = loadEnv("", resolve(process.cwd(), "../.."), "");
  const base =
    env.DATABASE_URL_TEST ||
    env.DATABASE_URL ||
    process.env.DATABASE_URL_TEST ||
    process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL tidak ditemukan di .env root maupun environment");
  const allowAny = (env.AIGOOGLE_TEST_ALLOW_ANY_DB || process.env.AIGOOGLE_TEST_ALLOW_ANY_DB) === "1";
  const databaseUrl = toTestDatabaseUrl(base, allowAny);
  return {
    test: {
      environment: "node",
      fileParallelism: false,
      testTimeout: 60000,
      // Test berjalan lewat HTTP (supertest) → cookie Secure/__Host- tidak
      // akan disimpan. Paksa origin non-HTTPS agar nama cookie tetap sid/psid.
      env: { ...env, DATABASE_URL: databaseUrl, APP_ORIGIN: "http://localhost:5173" },
    },
  };
});
