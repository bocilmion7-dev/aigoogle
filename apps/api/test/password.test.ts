import { describe, expect, it } from "vitest";
import { hashPassword, validatePasswordStrength, verifyPassword } from "../src/password.js";

describe("password", () => {
  it("hash + verify cocok", () => {
    const h = hashPassword("rahasia123");
    expect(h.startsWith("scrypt:")).toBe(true);
    expect(verifyPassword("rahasia123", h)).toBe(true);
    expect(verifyPassword("rahasia124", h)).toBe(false);
  });
  it("hash berbeda untuk salt sama beda input", () => {
    expect(hashPassword("abc12345")).not.toBe(hashPassword("abc12345"));
  });
  it("verify format rusak → false", () => {
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "bcrypt:aa:bb")).toBe(false);
  });
  it("validasi strength", () => {
    expect(validatePasswordStrength("short1")).toBe("minimal_8");
    expect(validatePasswordStrength("abcdefgh")).toBe("butuh_angka");
    expect(validatePasswordStrength("abcdefgh1")).toBeNull();
  });
});
