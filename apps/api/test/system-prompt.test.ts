import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/ai/system-prompt.js";

describe("buildSystemPrompt", () => {
  it("menyertakan tanggal hari ini & nama perusahaan", () => {
    const p = buildSystemPrompt({ tenantName: "PT Maju Jaya", now: new Date("2026-10-13T10:00:00Z") });
    expect(p).toContain("PT Maju Jaya");
    expect(p).toContain("13"); // tanggal
    expect(p).toContain("2026");
    expect(p).toContain("Bulan ini");
  });

  it("punya panduan intent (penjualan, laba/rugi, saldo)", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("salesInvoice.list");
    expect(p).toContain("glaccount.get-pl-account-amount");
    expect(p).toContain("glaccount.get-balance");
    // larangan menampilkan proses berpikir
    expect(p).toContain("Jangan tampilkan proses berpikir");
  });

  it("tidak menyarankan tool yang tak ada di API Accurate asli", () => {
    const p = buildSystemPrompt();
    // report.list / report.detail hanya ada di dokumentasi — memakainya = putaran LLM terbuang
    expect(p).not.toContain("report.list");
    expect(p).not.toContain("report.detail");
  });

  it("memaksa argumen wajib & menghemat putaran tool", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("fromDate");
    expect(p).toContain("required");
    expect(p).toContain("JANGAN memanggil tool yang sama dua kali");
  });

  it("melarang mengarang nomor transaksi & memberi cara filter tanggal yang benar", () => {
    const p = buildSystemPrompt();
    // kasus nyata: model menampilkan "INV-2050" dari id 2050 (nomor asli SI.2017.01.00010)
    expect(p.toLowerCase()).toContain("jangan mengarang nomor");
    expect(p).toContain("number");
    // field tanggal valid adalah transDate (bukan date) + bentuk op yang benar
    expect(p).toContain("transDate");
    expect(p).toContain("BETWEEN");
    // customerNo tidak bisa difilter → cari via keywords
    expect(p).toContain("keywords");
  });
});
