import { describe, expect, it } from "vitest";
import { formatAggregationResult } from "../src/ai/transformer.js";

const base = {
  period: { fromDate: "01/01/2017", toDate: "31/12/2017" },
  summary: {
    revenue: 3513959200,
    costOfGoodsSold: 2339035933,
    grossProfit: 1174923267,
    operatingExpense: 345993752,
    otherIncome: 0,
    otherExpense: 0,
    netProfit: 1368358244,
  },
};

describe("format gl.plSummary", () => {
  it("ringkasan tahunan → tabel GFM (bukan bullet)", () => {
    const text = formatAggregationResult("gl.plSummary", base)!;
    expect(text).toContain("| Komponen | Jumlah |");
    expect(text).toContain("| Laba bersih | Rp1.368.358.244 |");
    expect(text).not.toContain("•");
  });

  it("monthly → kalimat berapa bulan rugi + tabel per bulan", () => {
    const monthly = Array.from({ length: 12 }, (_, i) => ({
      label: `${["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"][i]} 2017`,
      netProfit: i < 2 ? -500000 : 200000,
    }));
    const text = formatAggregationResult("gl.plSummary", { ...base, monthly })!;
    expect(text).toContain("rugi pada 2 dari 12 bulan");
    expect(text).toContain("Januari 2017 (Rp-500.000)");
    expect(text).toContain("| Bulan | Laba Bersih |");
    expect(text).toContain("| Desember 2017 | Rp200.000 |");
  });

  it("monthly semua laba → kalimat 'tidak ada bulan yang rugi'", () => {
    const monthly = Array.from({ length: 12 }, (_, i) => ({ label: `Bulan ${i + 1}`, netProfit: 1000 }));
    const text = formatAggregationResult("gl.plSummary", { ...base, monthly })!;
    expect(text).toContain("tidak ada bulan yang rugi");
  });
});
