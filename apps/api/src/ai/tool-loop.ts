import type { GeminiClient } from "./gemini-client.js";
import type { GeminiContent, GeminiPart } from "./gemini-types.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import type { ToolSpec } from "../providers/accounting/types.js";

export interface ToolLoopEvent {
  type: "start" | "tool_call" | "tool_result" | "text_delta" | "done" | "error";
  tool?: string;
  label?: string;
  ok?: boolean;
  delta?: string;
  message?: string;
  [key: string]: unknown;
}

export interface ToolLoopOpts {
  gemini: GeminiClient;
  providerExecute: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
  permissions: Set<string>;
  tools: ToolSpec[];
  userMessage: string;
  history?: GeminiContent[];
  onEvent: (e: ToolLoopEvent) => void;
  model?: string;
  maxSteps?: number;
  now?: () => number;
}

export async function runToolLoop(
  opts: ToolLoopOpts
): Promise<{ text: string; trace: Array<Record<string, unknown>> }> {
  const maxSteps = opts.maxSteps ?? 8;
  const now = opts.now ?? Date.now;
  const deadline = now() + 60_000;
  const trace: Array<Record<string, unknown>> = [];
  const contents: GeminiContent[] = [
    ...(opts.history ?? []),
    { role: "user", parts: [{ text: opts.userMessage }] },
  ];
  opts.onEvent({ type: "start" });
  let text = "";

  for (let step = 0; step < maxSteps; step++) {
    if (now() > deadline) {
      const msg = "Butuh waktu lebih lama dari biasanya — coba persempit pertanyaan Anda.";
      opts.onEvent({ type: "text_delta", delta: msg });
      return { text: msg, trace };
    }
    const res = await opts.gemini.generate({
      contents,
      tools: [
        {
          functionDeclarations: opts.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.jsonSchema,
          })),
        },
      ],
      system: SYSTEM_PROMPT,
      model: opts.model,
    });
    const calls = res.parts.filter((p) => p.functionCall);
    const texts = res.parts.filter((p) => p.text).map((p) => p.text!);
    for (const t of texts) {
      text += t;
      opts.onEvent({ type: "text_delta", delta: t });
    }
    if (calls.length === 0) return { text, trace };

    contents.push({ role: "model", parts: res.parts });
    for (const call of calls) {
      const spec = opts.tools.find((t) => t.name === call.functionCall!.name);
      if (!spec) {
        trace.push({ tool: call.functionCall!.name, args: call.functionCall!.args, ok: false, reason: "unknown_tool" });
        contents.push({
          role: "user",
          parts: [
            { functionResponse: { name: call.functionCall!.name, response: { error: "tool tidak dikenal" }, id: call.functionCall!.id } },
          ],
        });
        continue;
      }
      opts.onEvent({ type: "tool_call", tool: spec.name, label: spec.label });
      if (!opts.permissions.has(spec.requiredPermission)) {
        trace.push({ tool: spec.name, args: call.functionCall!.args, ok: false, reason: "no_permission" });
        opts.onEvent({ type: "tool_result", tool: spec.name, ok: false });
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: spec.name,
                response: { error: `Anda tidak punya akses modul ${spec.requiredPermission}` },
                id: call.functionCall!.id,
              },
            },
          ],
        });
        continue;
      }
      try {
        const result = await opts.providerExecute(spec.name, call.functionCall!.args);
        trace.push({ tool: spec.name, args: call.functionCall!.args, ok: true });
        opts.onEvent({ type: "tool_result", tool: spec.name, ok: true });
        const wrapped =
          Array.isArray(result) ? { items: result } : result && typeof result === "object" ? result : { result };
        contents.push({
          role: "user",
          parts: [{ functionResponse: { name: spec.name, response: wrapped, id: call.functionCall!.id } }],
        });
      } catch (e) {
        trace.push({ tool: spec.name, args: call.functionCall!.args, ok: false, reason: "execute_error" });
        opts.onEvent({ type: "tool_result", tool: spec.name, ok: false });
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: { name: spec.name, response: { error: e instanceof Error ? e.message : "gagal" }, id: call.functionCall!.id },
            },
          ],
        });
      }
    }
  }
  const msg = "Terlalu banyak langkah — coba persempit pertanyaan Anda.";
  opts.onEvent({ type: "text_delta", delta: msg });
  return { text: msg, trace };
}
