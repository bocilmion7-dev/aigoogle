import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyFile } from "../src/drive/classify.js";
import { prisma } from "../src/db.js";

beforeEach(async () => {
  await prisma.aiProviderModel.deleteMany({});
  await prisma.aiProvider.deleteMany({});
  await prisma.aiProvider.create({
    data: {
      name: "uji",
      baseUrl: "http://localhost:9/v1",
      apiKey: "kunci-uji-panjang-sekali",
      isActive: true,
      models: { createMany: { data: [{ name: "model-uji", rank: 0 }] } },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

function stubRouter(content: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), {
          status: 200,
        })
    )
  );
}

describe("classifyFile", () => {
  it("pakai jawaban model bila valid", async () => {
    stubRouter("Faktur");
    expect(await classifyFile("isi", "application/pdf", "")).toBe("Faktur");
  });
  it("jawaban model tak dikenal → fallback nama file", async () => {
    stubRouter("apapun");
    expect(await classifyFile("isi", "application/pdf", "kuitansi-sewa.pdf")).toBe("Kuitansi");
  });
  it("mime bukan pdf/gambar → fallback nama file tanpa panggil AI", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("seharusnya tidak dipanggil");
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await classifyFile("isi", "text/plain", "faktur-1.pdf")).toBe("Faktur");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("fetch gagal → fallback nama file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("net");
      })
    );
    expect(await classifyFile("isi", "application/pdf", "nota.pdf")).toBe("Nota");
  });
  it("media base64 (gambar) → kirim image_url multimodal, bukan teks", async () => {
    const fetchMock = vi.fn(
      async (_url: unknown, init?: RequestInit) => {
        const body = String(init?.body ?? "");
        expect(body).toContain("image_url");
        expect(body).toContain("image/jpeg");
        expect(body).toContain(Buffer.from("PICTURE").toString("base64"));
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Kuitansi" } }] }));
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await classifyFile("", "image/jpeg", "bukti-transfer.jpg", Buffer.from("PICTURE").toString("base64"))
    ).toBe("Kuitansi");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
