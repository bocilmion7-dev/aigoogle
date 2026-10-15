import { LlmHttpError } from "./llm-error.js";
import { withModelFailover, getDefaultModel, type ModelCandidate } from "./model-pool.js";
import type { GenerateOpts, LLMPart } from "./llm-types.js";

export { LlmHttpError };

export interface LLMClient {
  generate(opts: GenerateOpts): Promise<{ parts: LLMPart[] }>;
  generateStream(opts: GenerateOpts): AsyncGenerator<LLMPart>;
}

export class RealLLMClient implements LLMClient {
  async generate(opts: GenerateOpts): Promise<{ parts: LLMPart[] }> {
    return withModelFailover(
      "generate",
      async (c: ModelCandidate) => {
        const { parts } = await c.client.generate({ ...opts, model: c.model });
        return { parts };
      },
      opts.model || (await getDefaultModel())
    );
  }

  async *generateStream(opts: GenerateOpts): AsyncGenerator<LLMPart> {
    // streaming sungguhan — yield text delta segera, tool call setelah lengkap
    const gen = await withModelFailover(
      "generate",
      async (c: ModelCandidate): Promise<AsyncGenerator<LLMPart>> => {
        return c.client.generateStream({ ...opts, model: c.model });
      },
      opts.model || (await getDefaultModel())
    );
    yield* gen;
  }
}

let testFactory: (() => LLMClient) | null = null;
export function setLLMForTest(f: (() => LLMClient) | null) {
  testFactory = f;
}
export function llmClient(): LLMClient {
  if (testFactory) return testFactory();
  return new RealLLMClient();
}
