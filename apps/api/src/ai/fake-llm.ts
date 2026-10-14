import type { LLMClient } from "./llm-client.js";
import type { GenerateOpts, LLMPart } from "./llm-types.js";

export class FakeLLMClient implements LLMClient {
  readonly calls: GenerateOpts[] = [];
  constructor(private queue: Array<{ parts: LLMPart[] }>) {}

  async generate(opts: GenerateOpts): Promise<{ parts: LLMPart[] }> {
    this.calls.push(opts);
    const next = this.queue.shift() ?? { parts: [{ text: "(fake habis)" }] };
    return { parts: next.parts };
  }

  async *generateStream(opts: GenerateOpts): AsyncGenerator<LLMPart> {
    const { parts } = await this.generate(opts);
    for (const p of parts) yield p;
  }
}
