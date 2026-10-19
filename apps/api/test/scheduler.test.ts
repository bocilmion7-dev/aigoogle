import { describe, expect, it, vi, beforeEach } from "vitest";
import { wibNow, buildDailyReport } from "../src/wa/scheduler.js";

vi.mock("../src/providers/accounting/connection.js", () => ({
  accurateCtxFor: vi.fn(),
}));
vi.mock("../src/providers/accounting/index.js", () => ({
  accurateProvider: vi.fn(),
}));
vi.mock("../src/db.js", () => ({
  prisma: { waMessageLog: { count: vi.fn() } },
}));

import { accurateCtxFor } from "../src/providers/accounting/connection.js";
import { accurateProvider } from "../src/providers/accounting/index.js";
import { prisma } from "../src/db.js";

const ctx = { tenantId: "t1", host: "h", session: "s", accessToken: "a" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("wibNow — zona waktu Asia/Jakarta", () => {
  it("tanggal & jam mengikuti WIB, bukan UTC server", () => {
    // 2026-10-18 23:30 UTC = 2026-10-19 06:30 WIB (UTC+7)
    const w = wibNow(new Date("2026-10-18T23:30:00Z"));
    expect(w.date).toBe("2026-10-19");
    expect(w.hour).toBe(6);
  });

  it("jam 8 pagi WIB = 01:00 UTC", () => {
    const w = wibNow(new Date("2026-10-18T01:00:00Z"));
    expect(w.hour).toBe(8);
  });

  it("dayLabel berbahasa Indonesia", () => {
    const w = wibNow(new Date("2026-10-18T23:30:00Z"));
    expect(w.dayLabel).toContain("Senin");
    expect(w.dayLabel).toContain("19/10/2026");
  });
});

describe("buildDailyReport", () => {
  it("menyusun laporan dari ringkasan Accurate + hitungan WA", async () => {
    (accurateCtxFor as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
    const execute = vi.fn().mockImplementation(async (tool: string) => {
      if (tool === "salesInvoice.summary")
        return { summary: { invoiceCount: 3, totalSales: 1500000 } };
      if (tool === "receivables.summary")
        return { summary: { totalReceivables: 45000000, customerCount: 7 } };
      if (tool === "payables.summary")
        return { summary: { totalPayables: 12000000, vendorCount: 4 } };
      throw new Error(`tool tak dikenal: ${tool}`);
    });
    (accurateProvider as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ execute });
    (prisma.waMessageLog.count as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(12);

    const body = await buildDailyReport(
      { id: "t1", name: "PT Maju Jaya" },
      { date: "2026-10-19", dayLabel: "Senin, 19/10/2026" }
    );
    expect(body).toContain("Laporan harian PT Maju Jaya — Senin, 19/10/2026");
    expect(body).toContain("Penjualan hari ini: Rp1.500.000 (3 faktur)");
    expect(body).toContain("Piutang belum dibayar: Rp45.000.000 (7 pelanggan)");
    expect(body).toContain("Utang belum dibayar: Rp12.000.000 (4 pemasok)");
    expect(body).toContain("WhatsApp terkirim 24 jam terakhir: 12 pesan");
  });

  it("tanpa koneksi Accurate → penjualan 'tidak tersedia', tetap kirim hitungan WA", async () => {
    (accurateCtxFor as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.waMessageLog.count as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(3);

    const body = await buildDailyReport(
      { id: "t1", name: "PT Maju Jaya" },
      { date: "2026-10-19", dayLabel: "Senin, 19/10/2026" }
    );
    expect(body).toContain("Penjualan hari ini: tidak tersedia");
    expect(body).toContain("WhatsApp terkirim 24 jam terakhir: 3 pesan");
  });
});
