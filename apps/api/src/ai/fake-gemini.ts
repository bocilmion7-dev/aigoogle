import type { GeminiClient } from "./gemini-client.js";
import type { GenerateOpts, GeminiPart } from "./gemini-types.js";

export class FakeGeminiClient implements GeminiClient {
  readonly calls: GenerateOpts[] = [];
  constructor(private queue: Array<{ parts: GeminiPart[] }>) {}

  async generate(opts: GenerateOpts): Promise<{ parts: GeminiPart[] }> {
    this.calls.push(opts);
    const next = this.queue.shift() ?? { parts: [{ text: "(fake habis)" }] };
    return { parts: next.parts };
  }

  async *generateStream(opts: GenerateOpts): AsyncGenerator<GeminiPart> {
    const { parts } = await this.generate(opts);
    for (const p of parts) yield p;
  }
}
