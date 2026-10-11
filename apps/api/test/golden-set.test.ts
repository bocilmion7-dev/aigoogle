import { describe, expect, it } from "vitest";
import { runToolLoop } from "../src/ai/tool-loop.js";
import { FakeGeminiClient } from "../src/ai/fake-gemini.js";
import { classifyText, classifyFileName } from "../src/drive/classify.js";
import type { ToolSpec } from "../src/providers/accounting/types.js";

const TOOLS: ToolSpec[] = [
  { name: "customer.list", description: "Daftar pelanggan", jsonSchema: { type: "object", properties: {} }, requiredPermission: "accurate:customer.view", label: "Mengambil data pelanggan…" },
  { name: "salesEntry.list", description: "Daftar penjualan", jsonSchema: { type: "object", properties: {} }, requiredPermission: "accurate:sales-entry.view", label: "Mengambil data penjualan…" },
];

describe("golden set: tool-loop (Gemini stub)", () => {
  const cases: Array<{ prompt: string; tool: string; permissions: string[] }> = [
    { prompt: "tampilkan daftar pelanggan", tool: "customer.list", permissions: ["accurate:customer.view", "accurate:sales-entry.view"] },
    { prompt: "siapa saja pelanggan saya?", tool: "customer.list", permissions: ["accurate:customer.view", "accurate:sales-entry.view"] },
    { prompt: "faktur penjualan bulan ini", tool: "salesEntry.list", permissions: ["accurate:customer.view", "accurate:sales-entry.view"] },
    { prompt: "berapa total penjualan?", tool: "salesEntry.list", permissions: ["accurate:customer.view", "accurate:sales-entry.view"] },
    { prompt: "daftar penjualan untuk analisa", tool: "salesEntry.list", permissions: ["accurate:customer.view", "accurate:sales-entry.view"] },
  ];
  for (const c of cases) {
    it(`"${c.prompt}" → ${c.tool}`, async () => {
      const fake = new FakeGeminiClient([
        { parts: [{ functionCall: { name: c.tool, args: {}, id: "g1" } }] },
        { parts: [{ text: "Berikut datanya." }] },
      ]);
      const calls: string[] = [];
      const out = await runToolLoop({
        gemini: fake,
        providerExecute: async (tool: string) => {
          calls.push(tool);
          return { items: [] };
        },
        permissions: new Set(c.permissions),
        tools: TOOLS,
        userMessage: c.prompt,
        onEvent: () => {},
      } as Parameters<typeof runToolLoop>[0]);
      expect(calls).toEqual([c.tool]);
      expect(out.trace[0]).toMatchObject({ tool: c.tool, ok: true });
    });
  }

  it("permission kurang → tool ditolak tanpa menyentuh provider", async () => {
    const fake = new FakeGeminiClient([
      { parts: [{ functionCall: { name: "salesEntry.list", args: {}, id: "g1" } }] },
      { parts: [{ text: "Anda tidak punya akses." }] },
    ]);
    const out = await runToolLoop({
      gemini: fake,
      providerExecute: async () => {
        throw new Error("tidak boleh");
      },
      permissions: new Set(["accurate:customer.view"]),
      tools: TOOLS,
      userMessage: "faktur penjualan",
      onEvent: () => {},
    } as Parameters<typeof runToolLoop>[0]);
    expect(out.trace[0]).toMatchObject({ tool: "salesEntry.list", ok: false, reason: "no_permission" });
  });
});

describe("golden set: klasifikasi dokumen (fixture)", () => {
  const fixtures: Array<{ input: string; expected: string; kind: "text" | "file" }> = [
    { kind: "text", input: "Faktur Penjualan No 001 tanggal 12 Januari 2026, PT Maju Jaya", expected: "Faktur" },
    { kind: "text", input: "Kuitansi pembayaran sewa gudang periode Januari", expected: "Kuitansi" },
    { kind: "text", input: "Nota pembelian bahan baku dari CV Sentosa", expected: "Nota" },
    { kind: "text", input: "Surat Jalan pengiriman barang No 45 tujuan Bandung", expected: "Surat Jalan" },
    { kind: "text", input: "Hasil rapat panitia tahunan dan daftar hadir", expected: "Lainnya" },
    { kind: "file", input: "faktur-2026-001.pdf", expected: "Faktur" },
    { kind: "file", input: "kuitansi-listrik-desember.pdf", expected: "Kuitansi" },
    { kind: "file", input: "nota-katering-acara.pdf", expected: "Nota" },
    { kind: "file", input: "surat-jalan-0902.pdf", expected: "Surat Jalan" },
    { kind: "file", input: "dokumen-acak-123.pdf", expected: "Lainnya" },
  ];
  let benar = 0;
  for (const f of fixtures) {
    it(`${f.kind}: "${f.input}" → ${f.expected}`, () => {
      const got = f.kind === "text" ? classifyText(f.input) : classifyFileName(f.input);
      if (got === f.expected) benar++;
      expect(got).toBe(f.expected);
    });
  }
  it("ambang akurasi ≥ 90%", () => {
    expect(benar / fixtures.length).toBeGreaterThanOrEqual(0.9);
  });
});
