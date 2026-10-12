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
  it("media base64 (gambar) → kirim inlineData, bukan teks", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        expect(body).toContain("inlineData");
        expect(body).toContain("image/jpeg");
        expect(body).toContain(Buffer.from("PICTURE").toString("base64"));
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Kuitansi" }] } }] }));
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await classifyWithGemini("", "image/jpeg", "key-x", "bukti-transfer.jpg", Buffer.from("PICTURE").toString("base64"))
    ).toBe("Kuitansi");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
