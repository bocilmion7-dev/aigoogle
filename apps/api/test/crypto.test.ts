import { describe, expect, it } from "vitest";
import { encryptToken, decryptToken } from "../src/crypto.js";

describe("crypto token", () => {
  it("enkripsi → dekripsi bulat; teks asli tidak muncul di ciphertext", () => {
    const plain = "tok-RAHASIA-123";
    const enc = encryptToken(plain);
    expect(enc).not.toContain("RAHASIA");
    expect(decryptToken(enc)).toBe(plain);
  });

  it("nonce berbeda tiap panggilan (ciphertext berbeda untuk plaintext sama)", () => {
    expect(encryptToken("sama")).not.toBe(encryptToken("sama"));
  });

  it("ciphertext rusak → throw", () => {
    expect(() => decryptToken("aqQ=".repeat(8))).toThrow();
  });
});
