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
    expect(p).toContain("report.list");
    // larangan menampilkan proses berpikir
    expect(p).toContain("Jangan tampilkan proses berpikir");
  });
});
