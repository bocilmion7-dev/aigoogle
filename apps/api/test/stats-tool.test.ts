import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { executeStatsTool, STATS_TREND } from "../src/ai/stats-tools.js";
import { formatAggregationResult } from "../src/ai/transformer.js";

const TENANT = "tenant-uji-stats";

afterAll(async () => {
  await prisma.dailyMetric.deleteMany({ where: { tenantId: TENANT } });
});

describe("stats.dailyTrend", () => {
  it("membaca snapshot harian → tabel + total", async () => {
    await prisma.dailyMetric.deleteMany({ where: { tenantId: TENANT } });
    await prisma.dailyMetric.createMany({
      data: [
        { tenantId: TENANT, date: "2017-01-05", salesTotal: 1000000, salesCount: 2, purchaseTotal: 250000, purchaseCount: 1 },
        { tenantId: TENANT, date: "2017-01-06", salesTotal: 500000, salesCount: 1, purchaseTotal: 0, purchaseCount: 0 },
      ],
    });
    const out = await executeStatsTool(TENANT, STATS_TREND, { fromDate: "01/01/2017", toDate: "31/01/2017" });
    const text = formatAggregationResult(STATS_TREND, out)!;
    expect(text).toContain("| Tanggal | Penjualan | Faktur | Pembelian | Faktur |");
    expect(text).toContain("| 06/01/2017 | Rp500.000 | 1 | Rp0 | 0 |");
    expect(text).toContain("penjualan Rp1.500.000 (3 faktur)");
  });

  it("tanpa data → arahan sinkronisasi (bukan tabel kosong)", async () => {
    const out = await executeStatsTool(TENANT, STATS_TREND, { fromDate: "01/01/2001", toDate: "31/01/2001" });
    expect(formatAggregationResult(STATS_TREND, out)).toMatch(/Belum ada data tren/);
  });
});
