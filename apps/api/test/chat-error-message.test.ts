import { describe, expect, it } from "vitest";
import { friendlyChatErrorMessage } from "../src/ai/chat-error-message.js";
import { LlmHttpError } from "../src/ai/llm-error.js";

const TPD =
  'Rate limit reached for model `openai/gpt-oss-20b` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 196437, Requested 5501. Please try again in 13m57.216s. Need more tokens? Upgrade to Dev Tier today.';

describe("pesan error banner chat", () => {
  it("429 TPD → kuota harian + estimasi menit dari pesan provider", () => {
    const msg = friendlyChatErrorMessage(new LlmHttpError(429, TPD));
    expect(msg).toContain("Kuota AI harian habis");
    expect(msg).toContain("13 menit");
  });

  it("429 TPD tanpa estimasi → fallback 'beberapa menit'", () => {
    const msg = friendlyChatErrorMessage(new LlmHttpError(429, "tokens per day (TPD): exceeded"));
    expect(msg).toBe("Kuota AI harian habis — coba lagi beberapa menit lagi.");
  });

  it("503 / model tidak ada → layanan tidak tersedia (pengaturan provider)", () => {
    expect(friendlyChatErrorMessage(new LlmHttpError(503, "tidak ada provider AI aktif"))).toContain(
      "Layanan AI sedang tidak tersedia",
    );
    expect(friendlyChatErrorMessage(new Error("tidak ada model AI tersedia"))).toContain(
      "Layanan AI sedang tidak tersedia",
    );
  });

  it("429 TPM (per-menit) → jeda singkat dari pesan provider", () => {
    const TPM =
      "Rate limit reached for model `openai/gpt-oss-20b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 6278, Requested 3503. Please try again in 13.3575s.";
    const msg = friendlyChatErrorMessage(new LlmHttpError(429, TPM));
    expect(msg).toContain("Permintaan AI sedang ramai");
    expect(msg).toContain("14 detik");
  });

  it("koneksi terputus di tengah (ECONNRESET/terminated) → pesan koneksi", () => {
    const terminated = "TypeError: terminated\n[cause]: Error: read ECONNRESET\n code: 'ECONNRESET'";
    expect(friendlyChatErrorMessage(new Error(terminated))).toContain("Koneksi ke layanan AI terputus");
    expect(friendlyChatErrorMessage(new Error("read ECONNRESET"))).toContain("Koneksi ke layanan AI terputus");
  });

  it("error lain → gangguan generik", () => {
    expect(friendlyChatErrorMessage(new Error("kesalahan tak dikenal"))).toBe("Terjadi gangguan — coba lagi.");
    expect(friendlyChatErrorMessage("string")).toBe("Terjadi gangguan — coba lagi.");
  });
});
