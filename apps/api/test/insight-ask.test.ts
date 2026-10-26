import { describe, expect, it } from "vitest";
import { cleanAnswer } from "../src/wawasan/ask.js";

describe("format jawaban insight", () => {
  it("buang markdown & daftar sumber duplikat", () => {
    const raw = "**Kabar iPhone:**\n\n- Harga naik [1].\n\nSumber: kontan.co.id, Medcom.id";
    const out = cleanAnswer(raw);
    expect(out).toContain("Kabar iPhone:");
    expect(out).toContain("- Harga naik [1].");
    expect(out).not.toContain("**");
    expect(out.toLowerCase()).not.toContain("sumber:");
  });
});
