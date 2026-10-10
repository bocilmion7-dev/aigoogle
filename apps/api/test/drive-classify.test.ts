import { describe, expect, it } from "vitest";
import { classifyText, categoryFolderName } from "../src/drive/classify.js";

describe("classifyText (rule-based fallback)", () => {
  it("deteksi Faktur", () => {
    expect(classifyText("Faktur Penjualan No. 001 Atas nama Budi")).toBe("Faktur");
  });
  it("deteksi Kuitansi", () => {
    expect(classifyText("Kuitansi pembayaran sewa bulanan")).toBe("Kuitansi");
  });
  it("deteksi Nota", () => {
    expect(classifyText("Nota Kontan penjualan tunai")).toBe("Nota");
  });
  it("deteksi Surat Jalan", () => {
    expect(classifyText("Surat Jalan pengiriman barang")).toBe("Surat Jalan");
  });
  it("default Lainnya", () => {
    expect(classifyText("dokumen acak tanpa kata kunci")).toBe("Lainnya");
  });
});

describe("categoryFolderName", () => {
  it("nama folder = kategori", () => {
    expect(categoryFolderName("Faktur")).toBe("Faktur");
    expect(categoryFolderName("Surat Jalan")).toBe("Surat Jalan");
  });
});
