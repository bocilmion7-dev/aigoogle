import { describe, expect, it } from "vitest";
import { RealGeminiClient } from "../src/ai/gemini-client.js";

const keyOk = (process.env.GEMINI_API_KEY?.length ?? 0) > 10;

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw last;
}

describe.skipIf(!keyOk)("Gemini asli (live)", () => {
  const gemini = new RealGeminiClient(process.env.GEMINI_API_KEY!);

  it("generateContent teks polos → balasan teks", async () => {
    const res = await withRetry(() => gemini.generate({ contents: [{ role: "user", parts: [{ text: "Balas satu kata saja: halo" }] }] }));
    expect(res.parts.some((p) => p.text && p.text.length > 0)).toBe(true);
  }, 60000);

  it("generateContent dengan tools → functionCall", async () => {
    const res = await withRetry(() =>
      gemini.generate({
        contents: [{ role: "user", parts: [{ text: "Cek daftar pelanggan sekarang." }] }],
        tools: [
          {
            functionDeclarations: [
              { name: "listCustomers", description: "Ambil daftar pelanggan", parameters: { type: "object", properties: {} } },
            ],
          },
        ],
      })
    );
    expect(res.parts.some((p) => p.functionCall?.name === "listCustomers")).toBe(true);
  }, 60000);
});
