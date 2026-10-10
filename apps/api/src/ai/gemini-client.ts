import { env } from "../env.js";
import type { GenerateOpts, GeminiPart } from "./gemini-types.js";

export interface GeminiClient {
  generate(opts: GenerateOpts): Promise<{ parts: GeminiPart[] }>;
  generateStream(opts: GenerateOpts): AsyncGenerator<GeminiPart>;
}

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "GeminiHttpError";
  }
}

export class RealGeminiClient implements GeminiClient {
  constructor(private apiKey: string) {}

  private body(opts: GenerateOpts): string {
    return JSON.stringify({
      contents: opts.contents,
      ...(opts.tools ? { tools: opts.tools } : {}),
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      ...(opts.responseModalities ? { generationConfig: { responseModalities: opts.responseModalities } } : {}),
    });
  }

  private async post(path: string, opts: GenerateOpts): Promise<Response> {
    const doFetch = () =>
      fetch(`${BASE}/models/${opts.model}:${path}`, {
        method: "POST",
        headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" },
        body: this.body(opts),
      });
    let lastRes: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await doFetch();
      if (res.ok) return res;
      lastRes = res;
      if (res.status !== 429 && res.status !== 503) break;
      await res.body?.cancel().catch(() => {});
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    }
    throw new GeminiHttpError(lastRes!.status, await lastRes!.text());
  }

  private partsFrom(json: { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> }): GeminiPart[] {
    return json.candidates?.[0]?.content?.parts ?? [];
  }

  async generate(opts: GenerateOpts): Promise<{ parts: GeminiPart[] }> {
    const res = await this.post("generateContent", { ...opts, model: opts.model ?? env.GEMINI_MODEL });
    return { parts: this.partsFrom(await res.json()) };
  }

  async *generateStream(opts: GenerateOpts): AsyncGenerator<GeminiPart> {
    const res = await this.post("streamGenerateContent?alt=sse", {
      ...opts,
      model: opts.model ?? env.GEMINI_MODEL,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const json = JSON.parse(line.slice(6));
          for (const p of this.partsFrom(json)) yield p;
        } catch {
          /* potongan SSE belum utuh */
        }
      }
    }
  }
}

let testFactory: (() => GeminiClient) | null = null;
export function setGeminiForTest(f: (() => GeminiClient) | null) {
  testFactory = f;
}
export function geminiClient(): GeminiClient {
  if (testFactory) return testFactory();
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.length < 10) {
    throw new GeminiHttpError(503, "GEMINI_API_KEY belum diisi/tidak valid");
  }
  return new RealGeminiClient(process.env.GEMINI_API_KEY);
}
