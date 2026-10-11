import { describe, expect, it } from "vitest";
import { creditsFromRupiah, WA_TOPUP_RUPIAH_PER_CREDIT } from "../src/wa/service.js";

describe("wa topup credits", () => {
  it("rupiah → kredit (200/kirim)", () => {
    expect(WA_TOPUP_RUPIAH_PER_CREDIT).toBe(200);
    expect(creditsFromRupiah(2000)).toBe(10);
    expect(creditsFromRupiah(200)).toBe(1);
    expect(creditsFromRupiah(199)).toBe(0);
  });
});
