import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyWithGemini } from "../src/drive/classify.js";

afterEach(() => vi.unstubAllGlobals());

function stubGemini(textPart: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: textPart }] } }] }), {
          status: 200,
        })
    )
  );
}

describe("classifyWithGemini", () => {
  it("pakai jawaban model bila valid", async () => {
    stubGemini("Faktur");
    expect(await classifyWithGemini("isi", "application/pdf", "key-x")).toBe("Faktur");
  });
  it("jawaban model tak dikenal → fallback nama file", async () => {
    stubGemini("apapun");
    expect(await classifyWithGemini("isi", "application/pdf", "key-x", "kuitansi-sewa.pdf")).toBe("Kuitansi");
  });
  it("tanpa api key → fallback nama file", async () => {
    expect(await classifyWithGemini("isi", "application/pdf", "", "faktur-1.pdf")).toBe("Faktur");
  });
  it("fetch gagal → fallback nama file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("net");
      })
    );
    expect(await classifyWithGemini("isi", "application/pdf", "key-x", "nota.pdf")).toBe("Nota");
  });
});
