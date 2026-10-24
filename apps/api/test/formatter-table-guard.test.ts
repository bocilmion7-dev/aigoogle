import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Penjaga: jawaban data dari formatter WAJIB tabel GFM —
 * dilarang bullet "•" / daftar bernomor di dalam blok FORMATTERS.
 */
describe("formatter: tidak ada jawaban data berbentuk bullet", () => {
  const src = readFileSync(new URL("../src/ai/transformer.ts", import.meta.url), "utf8");
  const start = src.indexOf("const FORMATTERS: Record<string, Fmt> = {");
  const end = src.indexOf("export function formatAggregationResult");
  const body = src.slice(start, end);

  it("blok FORMATTERS tanpa karakter bullet", () => {
    expect(body).not.toContain("•");
  });

  it("semua formatter yg menyebut mdTable memang ada tabel", () => {
    expect(body).toContain("mdTable(");
  });
});
