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
  it("teks polos tanpa tool → jawaban; teks di-stream bertahap (throttle) lalu menyatu utuh", async () => {
    const fake = new FakeLLMClient([{ parts: [{ text: "Halo!" }] }]);
    const { opts, events } = deps({ client: fake });
    const out = await runToolLoop(opts);
    expect(out.text).toBe("Halo!");
    const deltas = events.filter((e) => e.type === "text_delta").map((e) => e.delta as string);
    expect(deltas.join("")).toBe("Halo!");
    expect(deltas.length).toBeGreaterThan(1);
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

  it("adapter agregasi — beberapa tool call independen dieksekusi PARALEL (overlap waktu), bukan satu per satu", async () => {
    const fake = new FakeLLMClient([
      {
        parts: [
          { functionCall: { name: "customer.list", args: {}, id: "c1" } },
          { functionCall: { name: "salesInvoice.list", args: {}, id: "c2" } },
        ],
      },
      { parts: [{ text: "Ada 2 pelanggan & 3 faktur." }] },
    ]);
    const timeline: Array<{ tool: string; phase: "start" | "end" }> = [];
    const { opts } = deps({
      client: fake,
      providerExecute: async (tool: string) => {
        timeline.push({ tool, phase: "start" });
        await new Promise((r) => setTimeout(r, 50));
        timeline.push({ tool, phase: "end" });
        return tool === "customer.list" ? { items: ["Budi", "Siti"] } : { items: ["INV-1", "INV-2", "INV-3"] };
      },
    });
    const out = await runToolLoop(opts);
    expect(out.text).toBe("Ada 2 pelanggan & 3 faktur.");
    // kedua tool harus mulai SEBELUM salah satu selesai → terbukti paralel
    const starts = timeline.filter((t) => t.phase === "start").map((t) => t.tool);
    expect(starts).toEqual(["customer.list", "salesInvoice.list"]);
    // hasil tetap di-push ke model sesuai urutan tool call asli (c1 lalu c2)
    const second = fake.calls[1];
    const resp = JSON.stringify(second.contents);
    expect(resp.indexOf("customer.list")).toBeLessThan(resp.indexOf("salesInvoice.list"));
    expect(out.trace).toEqual([
      { tool: "customer.list", args: {}, ok: true },
      { tool: "salesInvoice.list", args: {}, ok: true },
    ]);
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

  const DETAIL: ToolSpec = {
    name: "customer.detail",
    description: "Detail pelanggan",
    jsonSchema: { type: "object", properties: { id: { type: "number" }, customerNo: { type: "string" } } },
    requiredPermission: "accurate:customer.view",
    label: "Membuka detail pelanggan…",
    oneOfRequired: ["id", "customerNo"],
  };

  it("oneOfRequired — panggilan tanpa id maupun kode ditolak SEBELUM ke provider", async () => {
    const fake = new FakeLLMClient([
      { parts: [{ functionCall: { name: "customer.detail", args: {}, id: "c1" } }] },
      { parts: [{ text: "Data tidak ditemukan." }] },
    ]);
    const { opts } = deps({
      client: fake,
      tools: [...TOOLS, DETAIL],
      providerExecute: async () => {
        throw new Error("tidak boleh dipanggil");
      },
    });
    const out = await runToolLoop(opts);
    expect(out.trace[0]).toMatchObject({ tool: "customer.detail", ok: false, reason: "missing_args_oneof" });
    expect(JSON.stringify(fake.calls[1].contents)).toContain("isi salah satu");
  });

  it("oneOfRequired — cukup salah satu field (kode) → provider dipanggil normal", async () => {
    const fake = new FakeLLMClient([
      { parts: [{ functionCall: { name: "customer.detail", args: { customerNo: "CSBY-0005" }, id: "c1" } }] },
      { parts: [{ text: "Pelanggan Abadi Phone Center." }] },
    ]);
    const calls: Array<Record<string, unknown>> = [];
    const { opts } = deps({
      client: fake,
      tools: [...TOOLS, DETAIL],
      providerExecute: async (tool, args) => {
        calls.push({ tool, args });
        return { name: "Abadi Phone Center" };
      },
    });
    const out = await runToolLoop(opts);
    expect(calls).toEqual([{ tool: "customer.detail", args: { customerNo: "CSBY-0005" } }]);
    expect(out.trace[0]).toMatchObject({ tool: "customer.detail", ok: true });
    expect(out.text).toBe("Pelanggan Abadi Phone Center.");
  });
});

describe("nudge anti-verifikasi-ulang & dedup (hemat putaran LLM)", () => {
  const AGG: ToolSpec = {
    name: "customer.lastOrderByName",
    description: "Pesanan terakhir pelanggan by nama",
    jsonSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    requiredPermission: "accurate:customer.view",
    label: "Mencari pesanan terakhir…",
  };
  const AGG_VENDOR: ToolSpec = {
    name: "vendor.unpaidByName",
    description: "Utang belum dibayar pemasok by nama",
    jsonSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    requiredPermission: "accurate:vendor.view",
    label: "Menghitung utang pemasok…",
  };
  const VENDOR_LIST: ToolSpec = {
    name: "vendor.list",
    description: "Daftar pemasok",
    jsonSchema: { type: "object", properties: {} },
    requiredPermission: "accurate:vendor.view",
    label: "Mengambil data pemasok…",
  };

  it("duplikat persis dlm 1 putaran → provider dieksekusi sekali, hasil dipakai semua id", async () => {
    let n = 0;
    const fake = new FakeLLMClient([
      {
        parts: [
          { functionCall: { name: "customer.list", args: {}, id: "c1" } },
          { functionCall: { name: "customer.list", args: {}, id: "c2" } },
        ],
      },
      { parts: [{ text: "Selesai." }] },
    ]);
    const { opts } = deps({
      client: fake,
      providerExecute: async () => { n++; return { data: "x" }; },
    });
    const out = await runToolLoop(opts);
    expect(n).toBe(1);
    expect(out.text).toBe("Selesai.");
    expect(out.trace.filter((t) => t.tool === "customer.list").length).toBe(2);
  });

  it("customer.list dgn keywords nama yg SUDAH di-agregasi → dijawab dari data agregasi (tanpa eksekusi)", async () => {
    const executed: string[] = [];
    const fake = new FakeLLMClient([
      { parts: [{ functionCall: { name: "customer.lastOrderByName", args: { name: "Budi Santoso" }, id: "a1" } }] },
      { parts: [{ functionCall: { name: "customer.list", args: { keywords: "Budi" }, id: "c1" } }] },
      { parts: [{ text: "Budi punya 1 faktur." }] },
    ]);
    const { opts } = deps({
      client: fake,
      tools: [...TOOLS, AGG],
      providerExecute: async (tool) => {
        executed.push(tool);
        return { customer: { customerNo: "CSBY-0001", name: "Budi Santoso" }, lastOrder: { number: "SI.1" } };
      },
    });
    const out = await runToolLoop(opts);
    expect(executed).toEqual(["customer.lastOrderByName"]);
    expect(out.trace.find((t) => t.tool === "customer.list")).toMatchObject({ ok: true, nudged: true });
    expect(out.text).toBe("Budi punya 1 faktur.");
  });

  it("vendor.list dgn keywords nama yg SUDAH di-agregasi (trio vendor) → dijawab dari data agregasi (tanpa eksekusi)", async () => {
    const executed: string[] = [];
    const fake = new FakeLLMClient([
      { parts: [{ functionCall: { name: "vendor.unpaidByName", args: { name: "CV Sentosa Mandiri" }, id: "a1" } }] },
      { parts: [{ functionCall: { name: "vendor.list", args: { keywords: "CV Sentosa" }, id: "v1" } }] },
      { parts: [{ text: "Utang CV Sentosa 800000." }] },
    ]);
    const { opts } = deps({
      client: fake,
      tools: [...TOOLS, AGG_VENDOR, VENDOR_LIST],
      permissions: new Set(["accurate:customer.view", "accurate:sales-invoice.view", "accurate:vendor.view"]),
      providerExecute: async (tool) => {
        executed.push(tool);
        return { vendor: { vendorNo: "VJKT-0001", name: "CV Sentosa Mandiri" }, totalUnpaid: 800000, countUnpaid: 1 };
      },
    });
    const out = await runToolLoop(opts);
    expect(executed).toEqual(["vendor.unpaidByName"]);
    expect(out.trace.find((t) => t.tool === "vendor.list")).toMatchObject({ ok: true, nudged: true });
    expect(out.text).toBe("Utang CV Sentosa 800000.");
  });

  it("agregasi dgn nama tercakup ('Budi' setelah 'Budi Santoso') → tak eksekusi ulang, data dari hasil pertama", async () => {
    let n = 0;
    const fake = new FakeLLMClient([
      { parts: [{ functionCall: { name: "customer.lastOrderByName", args: { name: "Budi Santoso" }, id: "a1" } }] },
      { parts: [{ functionCall: { name: "customer.lastOrderByName", args: { name: "Budi" }, id: "a2" } }] },
      { parts: [{ text: "Pesanan terakhir Budi." }] },
    ]);
    const { opts } = deps({
      client: fake,
      tools: [...TOOLS, AGG],
      providerExecute: async () => { n++; return { customer: { customerNo: "CSBY-0001", name: "Budi Santoso" }, lastOrder: { number: "SI.1" } }; },
    });
    const out = await runToolLoop(opts);
    expect(n).toBe(1);
    expect(out.trace.filter((t) => t.tool === "customer.lastOrderByName")).toMatchObject([
      { ok: true },
      { ok: true, nudged: true },
    ]);
  });

  it("cache-hit antar putaran → hasil dari cache tanpa eksekusi ulang & tanpa modifikasi response", async () => {
    const fake = new FakeLLMClient([
      { parts: [{ functionCall: { name: "customer.list", args: { keywords: "Siti" }, id: "c1" } }] },
      { parts: [{ functionCall: { name: "customer.list", args: { keywords: "Siti" }, id: "c2" } }] },
      { parts: [{ text: "Ada Siti." }] },
    ]);
    let n = 0;
    const { opts } = deps({
      client: fake,
      providerExecute: async () => { n++; return { items: [{ name: "Siti" }] }; },
    });
    const out = await runToolLoop(opts);
    expect(n).toBe(1);
    // response kedua = data cache apa adanya (menambah catatan membuat gateway LLM
    // menandai "tampered — re-run" → model justru mengulang tool)
    const second = JSON.stringify(fake.calls[2].contents);
    expect(second).toContain("Siti");
    expect(second).not.toContain("catatan");
    expect(out.trace[1]).toMatchObject({ tool: "customer.list", cached: true });
  });
});
