import { describe, expect, it } from "vitest";
import { matchIndustries } from "../src/wawasan/industries.js";

describe("deteksi industri dari katalog Accurate", () => {
  it("aksesoris HP → aksesoris_gadget dominan", () => {
    const out = matchIndustries([
      { name: "Anti Gores Iphone 5", revenue: 100_000 },
      { name: "Charger Iphone 5/5S", revenue: 200_000 },
      { name: "Casing Samsung", revenue: 50_000 },
    ]);
    expect(out[0]?.key).toBe("aksesoris_gadget");
    expect(out[0]!.weight).toBeGreaterThan(0.8);
  });

  it("multi-label: gadget + elektronik rumah tangga", () => {
    const out = matchIndustries([
      { name: "Charger Iphone", revenue: 100_000 },
      { name: "Kulkas 2 Pintu", revenue: 300_000 },
      { name: "Mesin Cuci", revenue: 200_000 },
    ]);
    const keys = out.map((o) => o.key);
    expect(keys).toContain("aksesoris_gadget");
    expect(keys).toContain("elektronik");
  });

  it("tidak ada kata kunci cocok → retail umum (bukan salah tebak)", () => {
    const out = matchIndustries([{ name: "Barang Aneh XYZ", revenue: 1000 }]);
    expect(out).toEqual([{ key: "retail_umum", label: "Retail Umum", weight: 1, matched: [] }]);
  });

  it("tanpa item → jasa umum", () => {
    expect(matchIndustries([])[0]?.key).toBe("jasa_umum");
  });

  it("kata pendek tidak salah cocok (hp vs harga)", () => {
    const out = matchIndustries([{ name: "Daftar Harga Grosir", revenue: 1000 }]);
    expect(out.some((o) => o.key === "aksesoris_gadget")).toBe(false);
  });
});
