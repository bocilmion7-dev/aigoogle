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

export const prisma = new PrismaClient();
