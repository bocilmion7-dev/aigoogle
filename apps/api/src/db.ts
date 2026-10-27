import { PrismaClient } from "@prisma/client";

// Defense-in-depth: saat berjalan sebagai test (NODE_ENV=test) prisma hanya
// boleh menunjuk database *_test — melindungi dari test runner di luar vitest.
if (process.env.NODE_ENV === "test") {
  const url = process.env.DATABASE_URL ?? "";
  const dbName = decodeURIComponent((url.split("/").pop() ?? "").split("?")[0]);
  const allowAny = process.env.AIGOOGLE_TEST_ALLOW_ANY_DB === "1";
  if (!dbName) {
    throw new Error("NODE_ENV=test tetapi DATABASE_URL kosong/tanpa nama database");
  }
  if (!allowAny && !dbName.endsWith("_test")) {
    throw new Error(
      `Tolak koneksi DB production dari test: dbname "${dbName}" harus berakhiran _test`,
    );
  }
}

/** Tambahkan default pool yang aman untuk trafik produksi tanpa menimpa override eksplisit. */
function tunedDatabaseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (!u.searchParams.has("connection_limit")) {
      u.searchParams.set("connection_limit", process.env.PRISMA_CONNECTION_LIMIT ?? "20");
    }
    if (!u.searchParams.has("pool_timeout")) {
      u.searchParams.set("pool_timeout", process.env.PRISMA_POOL_TIMEOUT ?? "20");
    }
    return u.toString();
  } catch {
    return raw;
  }
}

export const prisma = new PrismaClient({
  datasources: { db: { url: tunedDatabaseUrl(process.env.DATABASE_URL ?? "") } },
});
