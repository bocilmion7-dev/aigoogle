import { describe, expect, it, vi } from "vitest";
import { transformToRoute } from "../src/ai/transformer.js";
import type { LLMClient } from "../src/ai/llm-client.js";

function fake(reply: string): { client: LLMClient; calls: () => number } {
  let n = 0;
  return {
    client: {
      generate: async () => {
        n += 1;
        return { parts: [{ text: reply }] };
      },
      generateStream: async function* () {
        yield { text: reply };
      },
    },
    calls: () => n,
  };
}

const run = (f: { client: LLMClient }, message: string) =>
  transformToRoute({ userMessage: message, history: [], client: f.client, model: "uji" });

describe("transformToRoute", () => {
  it("tool agregasi dikenal → route", async () => {
    const f = fake('{"tool":"gl.plSummary","args":{"fromDate":"01/01/2017","toDate":"31/12/2017"}}');
    const r = await run(f, "berapa laba tahun 2017 (uji route agregasi)");
    expect(r).toEqual({ tool: "gl.plSummary", args: { fromDate: "01/01/2017", toDate: "31/12/2017" } });
  });

  it("tool Drive diterima (bukan hanya katalog Accurate)", async () => {
    const f = fake('{"tool":"drive.findInvoices","args":{"keywords":"faktur"}}');
    const r = await run(f, "cari faktur di google drive (uji route drive)");
    expect(r?.tool).toBe("drive.findInvoices");
  });

  it("tool tak dikenal → null", async () => {
    const f = fake('{"tool":"tidak.ada","args":{}}');
    expect(await run(f, "pertanyaan aneh (uji route tak dikenal)")).toBeNull();
  });

  it("argumen wajib kosong → null", async () => {
    const f = fake('{"tool":"drive.findInvoices","args":{}}');
    expect(await run(f, "cari file (uji route argumen kosong)")).toBeNull();
  });

  it("pesan sama → cache (LLM dipanggil sekali)", async () => {
    const f = fake('{"tool":"item.topSelling","args":{"fromDate":"01/01/2017","toDate":"31/12/2017"}}');
    const msg = "barang terlaris tahun 2017 (uji cache router)";
    const a = await run(f, msg);
    const b = await run(f, msg);
    expect(a?.tool).toBe("item.topSelling");
    expect(b?.tool).toBe("item.topSelling");
    expect(f.calls()).toBe(1);
  });

  it("cache kedaluwarsa setelah 5 menit (LLM dipanggil lagi)", async () => {
    const f = fake('{"tool":"item.topSelling","args":{"fromDate":"01/01/2017","toDate":"31/12/2017"}}');
    const msg = "barang terlaris tahun 2017 (uji ttl cache 5 menit)";
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-25T10:00:00Z"));
      expect((await run(f, msg))?.tool).toBe("item.topSelling");
      expect(f.calls()).toBe(1);

      // < 5 menit → masih cache
      vi.setSystemTime(new Date("2026-10-25T10:04:59Z"));
      expect((await run(f, msg))?.tool).toBe("item.topSelling");
      expect(f.calls()).toBe(1);

      // > 5 menit → kedaluwarsa, router memanggil LLM lagi
      vi.setSystemTime(new Date("2026-10-25T10:05:01Z"));
      expect((await run(f, msg))?.tool).toBe("item.topSelling");
      expect(f.calls()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
