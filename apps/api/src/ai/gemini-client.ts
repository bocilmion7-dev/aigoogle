import { env } from "../env.js";
import { GeminiHttpError } from "./gemini-error.js";
import { sanitizeToolSchema } from "./schema-sanitize.js";
import { withModelFailover, type ModelCandidate } from "./model-pool.js";
import { RealNvidiaClient } from "./nvidia.js";
import type { GenerateOpts, GeminiPart } from "./gemini-types.js";

export { GeminiHttpError };

export interface GeminiClient {
  generate(opts: GenerateOpts): Promise<{ parts: GeminiPart[] }>;
  generateStream(opts: GenerateOpts): AsyncGenerator<GeminiPart>;
}

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export class RealGeminiClient implements GeminiClient {
  constructor(private apiKey: string) {}

  private body(opts: GenerateOpts): string {
    return JSON.stringify({
      contents: opts.contents,
      // Gemini menolak `additionalProperties` & kawan — bersihkan di boundary
      ...(opts.tools
        ? {
            tools: opts.tools.map((t) => ({
              ...t,
              functionDeclarations: t.functionDeclarations?.map((d) => ({
                ...d,
                ...(d.parameters ? { parameters: sanitizeToolSchema(d.parameters) } : {}),
              })),
            })),
          }
        : {}),
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      ...(opts.responseModalities ? { generationConfig: { responseModalities: opts.responseModalities } } : {}),
    });
  }

  /** Panggil Gemini utk satu model → Response (path: generateContent / streamGenerateContent). */
  private async geminiPost(model: string, path: string, opts: GenerateOpts): Promise<Response> {
    const res = await fetch(`${BASE}/models/${model}:${path}`, {
      method: "POST",
      headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" },
      body: this.body(opts),
    });
    if (!res.ok) throw new GeminiHttpError(res.status, await res.text().catch(() => ""));
    return res;
  }

  private partsFrom(json: { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> }): GeminiPart[] {
    return json.candidates?.[0]?.content?.parts ?? [];
  }

  async generate(opts: GenerateOpts): Promise<{ parts: GeminiPart[] }> {
    return withModelFailover(
      opts.action ?? "generate",
      async (c: ModelCandidate) => {
        if (c.provider === "router") {
          const dt = new RealNvidiaClient(env.ROUTER_API_KEY, env.ROUTER_BASE_URL);
          return dt.generate({ ...opts, model: c.model });
        }
        if (c.provider === "nvidia") {
          const nv = new RealNvidiaClient(env.NVIDIA_API_KEY);
          return nv.generate({ ...opts, model: c.model });
        }
        const res = await this.geminiPost(c.model, "generateContent", opts);
        return { parts: this.partsFrom(await res.json()) };
      },
      opts.model ?? (env.ROUTER_MODEL.split(",")[0]?.trim() || env.GEMINI_MODEL)
    );
  }

  async *generateStream(opts: GenerateOpts): AsyncGenerator<GeminiPart> {
    // failover menghasilkan generator per-provider: Router/NVIDIA via generate utuh lalu
    // di-yield (keduanya OpenAI-compatible); Gemini via SSE stream.
    const gen = await withModelFailover(
      opts.action ?? "generate",
      async (c: ModelCandidate): Promise<AsyncGenerator<GeminiPart>> => {
        if (c.provider === "router" || c.provider === "nvidia") {
          const client =
            c.provider === "router"
              ? new RealNvidiaClient(env.ROUTER_API_KEY, env.ROUTER_BASE_URL)
              : new RealNvidiaClient(env.NVIDIA_API_KEY);
          const { parts } = await client.generate({ ...opts, model: c.model });
          return (async function* () {
            for (const p of parts) yield p;
          })();
        }
        const res = await this.geminiPost(c.model, "streamGenerateContent?alt=sse", opts);
        return this.sseParts(res);
      },
      opts.model ?? (env.ROUTER_MODEL.split(",")[0]?.trim() || env.GEMINI_MODEL)
    );
    yield* gen;
  }

  /** Baca response SSE Gemini → parts. */
  private async *sseParts(res: Response): AsyncGenerator<GeminiPart> {
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
