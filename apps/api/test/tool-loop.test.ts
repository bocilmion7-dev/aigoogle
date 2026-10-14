import { describe, expect, it } from "vitest";
import { runToolLoop } from "../src/ai/tool-loop.js";
import { FakeLLMClient } from "../src/ai/fake-llm.js";
import type { ToolSpec } from "../src/providers/accounting/types.js";

const TOOLS: ToolSpec[] = [
  { name: "customer.list", description: "Daftar pelanggan", jsonSchema: { type: "object", properties: {} }, requiredPermission: "accurate:customer.view", label: "Mengambil data pelanggan…" },
  { name: "salesInvoice.list", description: "Daftar faktur penjualan", jsonSchema: { type: "object", properties: {} }, requiredPermission: "accurate:sales-invoice.view", label: "Mengambil data faktur penjualan…" },
];

function deps(overrides: Partial<Parameters<typeof runToolLoop>[0]> = {}) {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    opts: {
      client: new FakeLLMClient([]),
      providerExecute: async (tool: string) => ({ data: `isi-${tool}` }),
      permissions: new Set<string>(["accurate:customer.view", "accurate:sales-invoice.view"]),
      tools: TOOLS,
      userMessage: "tanya",
      onEvent: (e: Record<string, unknown>) => events.push(e),
      ...overrides,
    } as Parameters<typeof runToolLoop>[0],
  };
}

describe("runToolLoop (fake LLM)", () => {
  it("teks polos tanpa tool → jawaban + satu text_delta", async () => {
    const fake = new FakeLLMClient([{ parts: [{ text: "Halo!" }] }]);
    const { opts, events } = deps({ client: fake });
    const out = await runToolLoop(opts);
    expect(out.text).toBe("Halo!");
    expect(events.filter((e) => e.type === "text_delta")).toHaveLength(1);
  });

  it("bagian thought (model thinking) tidak ditampilkan & tidak ikut tersimpan", async () => {
    const fake = new FakeLLMClient([
      {
        parts: [
          { text: "Pengguna bertanya soal penjualan… (penalaran internal)", thought: true },
          { functionCall: { name: "customer.list", args: {}, id: "c1" } },
        ],
      },
      {
        parts: [
          { text: "Saya cek datanya dulu…", thought: true },
          { text: "Jawaban akhir: ada 2 pelanggan." },
        ],
      },
    ]);
    const { opts, events } = deps({ client: fake });
    const out = await runToolLoop(opts);
    expect(out.text).toBe("Jawaban akhir: ada 2 pelanggan.");
    const deltas = events.filter((e) => e.type === "text_delta").map((e) => e.delta).join("");
    expect(deltas).not.toContain("penalaran internal");
    expect(deltas).not.toContain("Saya cek datanya");
    // riwayat percakapan ke model juga bersih dari thought
    expect(JSON.stringify(fake.calls[1].contents)).not.toContain("penalaran internal");
  });

  it("tool dipanggil → event badge + providerExecute + functionResponse lanjut teks", async () => {
    const fake = new FakeLLMClient([
      { parts: [{ functionCall: { name: "customer.list", args: {}, id: "c1" } }] },
      { parts: [{ text: "Ada 2 pelanggan." }] },
    ]);
    const calls: string[] = [];
    const { opts, events } = deps({
      client: fake,
      providerExecute: async (tool: string) => {
        calls.push(tool);
        return { items: ["Budi", "Siti"] };
      },
    });
    const out = await runToolLoop(opts);
    expect(calls).toEqual(["customer.list"]);
    expect(out.text).toBe("Ada 2 pelanggan.");
    expect(out.trace).toEqual([{ tool: "customer.list", args: {}, ok: true }]);
    expect(events.some((e) => e.type === "tool_call" && e.tool === "customer.list")).toBe(true);
    const second = fake.calls[1];
    expect(JSON.stringify(second.contents)).toContain("functionResponse");
  });

  it("permission ditolak → tidak panggil provider; AI diminta menjawab tidak punya akses", async () => {
    const fake = new FakeLLMClient([
      { parts: [{ functionCall: { name: "salesInvoice.list", args: {}, id: "c1" } }] },
      { parts: [{ text: "Anda tidak punya akses modul penjualan." }] },
    ]);
    const { opts } = deps({
      client: fake,
      permissions: new Set(["accurate:customer.view"]),
      providerExecute: async () => {
        throw new Error("tidak boleh dipanggil");
      },
    });
    const out = await runToolLoop(opts);
    expect(out.trace[0]).toMatchObject({ tool: "salesInvoice.list", ok: false, reason: "no_permission" });
    expect(out.text).toContain("tidak punya akses");
  });

  it("melebihi 8 langkah → berhenti dengan pesan meminta persempit", async () => {
    const turns = Array.from({ length: 9 }, () => ({
      parts: [{ functionCall: { name: "customer.list", args: {}, id: "x" } }],
    }));
    const fake = new FakeLLMClient(turns);
    const { opts } = deps({ client: fake });
    const out = await runToolLoop(opts);
    expect(out.text).toContain("persempit");
    expect(fake.calls.length).toBeLessThanOrEqual(8);
  });

  it("deadline 120 dtk terlampaui → pesan butuh waktu", async () => {
    const fake = new FakeLLMClient([{ parts: [{ text: "ok" }] }]);
    const { opts } = deps({ client: fake, now: (() => { let t = 0; return () => (t += 121_000); })() });
    const out = await runToolLoop(opts);
    expect(out.text).toContain("waktu");
  });
});
