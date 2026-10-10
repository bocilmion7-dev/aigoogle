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

  it("payload bukan 3 segmen → throw", () => {
    expect(() => decryptToken("aqQ=".repeat(8))).toThrow();
    expect(() => decryptToken("a.b.c.d")).toThrow();
  });

  it("auth tag / ciphertext dimanipulasi → throw (GCM auth)", () => {
    const [n, t, c] = encryptToken("rahasia").split(".");
    const flip = (s: string) => {
      const b = Buffer.from(s, "base64");
      b[0] ^= 1;
      return b.toString("base64");
    };
    expect(() => decryptToken([n, flip(t), c].join("."))).toThrow();
    expect(() => decryptToken([n, t, flip(c)].join("."))).toThrow();
  });

  it("unicode round-trip", () => {
    const plain = "tokén-🚀";
    expect(decryptToken(encryptToken(plain))).toBe(plain);
  });
});
