import { describe, expect, it } from "vitest";
import { runToolLoop } from "../src/ai/tool-loop.js";
import { FakeGeminiClient } from "../src/ai/fake-gemini.js";
import type { ToolSpec } from "../src/providers/accounting/types.js";

const TOOLS: ToolSpec[] = [
  { name: "customer.list", description: "Daftar pelanggan", jsonSchema: { type: "object", properties: {} }, requiredPermission: "accurate:customer.view", label: "Mengambil data pelanggan…" },
  { name: "salesEntry.list", description: "Daftar penjualan", jsonSchema: { type: "object", properties: {} }, requiredPermission: "accurate:sales-entry.view", label: "Mengambil data penjualan…" },
];

function deps(overrides: Partial<Parameters<typeof runToolLoop>[0]> = {}) {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    opts: {
      gemini: new FakeGeminiClient([]),
      providerExecute: async (tool: string) => ({ data: `isi-${tool}` }),
      permissions: new Set<string>(["accurate:customer.view", "accurate:sales-entry.view"]),
      tools: TOOLS,
      userMessage: "tanya",
      onEvent: (e: Record<string, unknown>) => events.push(e),
      ...overrides,
    } as Parameters<typeof runToolLoop>[0],
  };
}

describe("runToolLoop (fake gemini)", () => {
  it("teks polos tanpa tool → jawaban + satu text_delta", async () => {
    const fake = new FakeGeminiClient([{ parts: [{ text: "Halo!" }] }]);
    const { opts, events } = deps({ gemini: fake });
    const out = await runToolLoop(opts);
    expect(out.text).toBe("Halo!");
    expect(events.filter((e) => e.type === "text_delta")).toHaveLength(1);
  });

  it("tool dipanggil → event badge + providerExecute + functionResponse lanjut teks", async () => {
    const fake = new FakeGeminiClient([
      { parts: [{ functionCall: { name: "customer.list", args: {}, id: "c1" } }] },
      { parts: [{ text: "Ada 2 pelanggan." }] },
    ]);
    const calls: string[] = [];
    const { opts, events } = deps({
      gemini: fake,
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
    const fake = new FakeGeminiClient([
      { parts: [{ functionCall: { name: "salesEntry.list", args: {}, id: "c1" } }] },
      { parts: [{ text: "Anda tidak punya akses modul penjualan." }] },
    ]);
    const { opts } = deps({
      gemini: fake,
      permissions: new Set(["accurate:customer.view"]),
      providerExecute: async () => {
        throw new Error("tidak boleh dipanggil");
      },
    });
    const out = await runToolLoop(opts);
    expect(out.trace[0]).toMatchObject({ tool: "salesEntry.list", ok: false, reason: "no_permission" });
    expect(out.text).toContain("tidak punya akses");
  });

  it("melebihi 8 langkah → berhenti dengan pesan meminta persempit", async () => {
    const turns = Array.from({ length: 9 }, () => ({
      parts: [{ functionCall: { name: "customer.list", args: {}, id: "x" } }],
    }));
    const fake = new FakeGeminiClient(turns);
    const { opts } = deps({ gemini: fake });
    const out = await runToolLoop(opts);
    expect(out.text).toContain("persempit");
    expect(fake.calls.length).toBeLessThanOrEqual(8);
  });

  it("deadline 60 dtk terlampaui → pesan butuh waktu", async () => {
    const fake = new FakeGeminiClient([{ parts: [{ text: "ok" }] }]);
    const { opts } = deps({ gemini: fake, now: (() => { let t = 0; return () => (t += 61_000); })() });
    const out = await runToolLoop(opts);
    expect(out.text).toContain("waktu");
  });
});
