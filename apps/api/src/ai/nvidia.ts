import { LlmHttpError } from "./llm-error.js";
import { sanitizeToolSchema } from "./schema-sanitize.js";
import type { GenerateOpts, LLMContent, LLMPart, ToolDecl } from "./llm-types.js";

/**
 * Klien NVIDIA NIM (OpenAI-compatible /v1/chat/completions) sbg provider failover.
 *
 * Perbedaan format isi (contents) dgn endpoint OpenAI yg harus dijembatani:
 * - Nama function harus [A-Za-z0-9_] — titik tool kita (mis. salesInvoice.list)
 *   dipetakan ke underscore, lalu dipetakan balik saat membaca response.
 * - Konten system = pesan `system` pertama (bukan systemInstruction terpisah).
 * - Riwayat: model → `assistant`, functionResponse → `tool` dgn tool_call_id.
 * - Balasan tool-calls ada di `choices[0].message.tool_calls` (bukan parts).
 */
const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";

/** "salesInvoice.list" → "salesInvoice_list"; kunci balik utk mengembalikan nama asli. */
export function toNvidiaToolName(name: string): string {
  return (name ?? "").replace(/[^A-Za-z0-9_]/g, "_");
}

interface OpenAIToolCall {
  id?: string;
  type?: string;
  function: { name: string; arguments: string };
}
interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null | Array<Record<string, unknown>>;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

/** GenerateOpts (format isi) → pesan OpenAI. */
function toOpenAIMessages(opts: GenerateOpts): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  if (opts.system) out.push({ role: "system", content: opts.system });
  for (const c of opts.contents) {
    if (c.role === "model") {
      // SATU pesan assistant per turn: gabungkan teks + tool_calls (format OpenAI benar)
      let text: string | null = null;
      const toolCalls: OpenAIToolCall[] = [];
      for (const p of c.parts) {
        if (p.functionCall) {
          // skip functionCall tanpa nama (model kadang balas kosong)
          if (!p.functionCall.name) continue;
          let args = "{}";
          try {
            args = JSON.stringify(p.functionCall.args ?? {});
          } catch {
            args = "{}";
          }
          toolCalls.push({
            id: p.functionCall.id ?? toNvidiaToolName(p.functionCall.name),
            type: "function",
            function: { name: toNvidiaToolName(p.functionCall.name), arguments: args },
          });
        } else if (p.text) {
          text = (text ?? "") + p.text;
        }
      }
      if (toolCalls.length) out.push({ role: "assistant", content: text, tool_calls: toolCalls });
      else if (text) out.push({ role: "assistant", content: text });
    } else {
      // peran user: teks biasa, gambar (inlineData → image_url multimodal), ATAU functionResponse (→ pesan tool)
      if (c.parts.some((p) => p.inlineData)) {
        // pesan multimodal: semua gambar + teks dalam SATU pesan user
        const content: Array<Record<string, unknown>> = [];
        for (const p of c.parts) {
          if (p.inlineData) {
            content.push({ type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } });
          } else if (p.text) {
            content.push({ type: "text", text: p.text });
          }
        }
        out.push({ role: "user", content });
      } else {
        for (const p of c.parts) {
          if (p.functionResponse) {
            const raw = p.functionResponse.response;
            let resp: string;
            if (typeof raw === "string") resp = raw;
            else {
              try {
                resp = JSON.stringify(raw) ?? "";
              } catch {
                resp = "";
              }
            }
            out.push({ role: "tool", content: resp, tool_call_id: p.functionResponse.id ?? toNvidiaToolName(p.functionResponse.name) });
          } else if (p.text) {
            out.push({ role: "user", content: p.text });
          }
        }
      }
    }
  }
  return out;
}

/** ToolDecl (format functionDeclarations) → tools OpenAI (nama disanitasi utk validasi NIM). */
function toOpenAITools(tools: ToolDecl[] | undefined): Array<Record<string, unknown>> | undefined {
  if (!tools?.length) return undefined;
  const decls = tools.flatMap((t) => t.functionDeclarations ?? []);
  if (!decls.length) return undefined;
  return decls.map((d) => ({
    type: "function",
    function: {
      name: toNvidiaToolName(d.name),
      description: d.description,
      parameters: sanitizeToolSchema(d.parameters ?? { type: "object", properties: {} }),
    },
  }));
}

/** Response OpenAI → parts isi (nama tool dipetakan balik ke titik). */
function partsFromOpenAI(json: {
  choices?: Array<{ message?: OpenAIMessage }>;
}): LLMPart[] {
  const msg = json.choices?.[0]?.message;
  if (!msg) return [];
  const parts: LLMPart[] = [];
  if (msg.tool_calls?.length) {
    for (const tc of msg.tool_calls) {
      // skip tool_call tanpa nama (model kadang balas functionCall kosong)
      if (!tc.function?.name) continue;
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(tc.function.arguments || "{}");
        if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
      } catch {
        args = {};
      }
      parts.push({
        functionCall: {
          name: tc.function.name,
          args,
          id: tc.id,
        },
      });
    }
  }
  if (typeof msg.content === "string" && msg.content) parts.push({ text: msg.content });
  return parts;
}

export interface NvidiaClient {
  listModels(): Promise<string[]>;
  generate(opts: GenerateOpts): Promise<{ parts: LLMPart[] }>;
  generateStream(opts: GenerateOpts): AsyncGenerator<LLMPart>;
}

/**
 * effort penalaran model thinking. Tanpa param ini, GLM-5.3 menalar 30-90 detik
 * per putaran (terverifikasi: default 33 dtk ke teks pertama vs "low" 4,1 dtk);
 * provider menerima "minimal"/"low"/"medium"/"high". Set
 * AIGOOGLE_REASONING_EFFORT=off utk kirim tanpa param (perilaku lama).
 */
function reasoningEffort(): string | undefined {
  const v = (process.env.AIGOOGLE_REASONING_EFFORT ?? "low").trim().toLowerCase();
  if (!v || v === "off" || v === "none") return undefined;
  return v;
}

/**
 * Qwen3 di DashScope "menalar" dulu (lambat ±2-5 dtk/putaran). Set
 * AIGOOGLE_ENABLE_THINKING=false untuk mematikan reasoning model Qwen — hanya
 * dikirim bila env diisi, supaya provider lain (NVIDIA/9Router) tidak menolak.
 */
function enableThinking(): boolean | undefined {
  const v = (process.env.AIGOOGLE_ENABLE_THINKING ?? "").trim().toLowerCase();
  if (v === "false" || v === "0" || v === "off") return false;
  if (v === "true" || v === "1" || v === "on") return true;
  return undefined;
}

/** Parse JSON respons OpenAI-compatible yg mungkin diakhiri trailing non-JSON (mis. "data: [DONE]" dari 9Router). */
function parseOpenAIJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const end = text.lastIndexOf("}");
    if (end !== -1) {
      try {
        return JSON.parse(text.slice(0, end + 1));
      } catch {
        /* lanjut ke bawah */
      }
    }
    throw new LlmHttpError(502, "respons provider AI tidak valid");
  }
}

export class RealNvidiaClient implements NvidiaClient {
  constructor(private apiKey: string, private baseUrl: string = NVIDIA_BASE) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" };
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers() });
    if (!res.ok) throw new LlmHttpError(res.status, await res.text().catch(() => ""));
    const j = parseOpenAIJson(await res.text()) as { data?: Array<{ id?: string }> };
    return (j.data ?? []).map((m) => m.id).filter((x): x is string => !!x);
  }

  async generate(opts: GenerateOpts): Promise<{ parts: LLMPart[] }> {
    const tools = toOpenAITools(opts.tools);
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: toOpenAIMessages(opts),
    };
    const effort = reasoningEffort();
    if (effort) body.reasoning_effort = effort;
    const thinking = enableThinking();
    if (thinking !== undefined) body.enable_thinking = thinking;
    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (!res.ok) throw new LlmHttpError(res.status, await res.text().catch(() => ""));
    const parts = partsFromOpenAI(parseOpenAIJson(await res.text()) as Parameters<typeof partsFromOpenAI>[0]);
    // petakan balik nama tool: "salesInvoice_list" → "salesInvoice.list" (cocok katalog)
    const known = (opts.tools ?? []).flatMap((t) => t.functionDeclarations ?? []).map((d) => d.name);
    for (const p of parts) {
      if (p.functionCall) p.functionCall.name = mapBackToolName(p.functionCall.name, known);
    }
    return { parts };
  }

  /** Streaming SSE — yield text delta segera; tool call diyield setelah lengkap. */
  async *generateStream(opts: GenerateOpts): AsyncGenerator<LLMPart> {
    const tools = toOpenAITools(opts.tools);
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: toOpenAIMessages(opts),
      stream: true,
    };
    const effort = reasoningEffort();
    if (effort) body.reasoning_effort = effort;
    const thinking = enableThinking();
    if (thinking !== undefined) body.enable_thinking = thinking;
    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (!res.ok) throw new LlmHttpError(res.status, await res.text().catch(() => ""));
    if (!res.body) throw new LlmHttpError(502, "stream kosong");

    const known = (opts.tools ?? []).flatMap((t) => t.functionDeclarations ?? []).map((d) => d.name);
    const decoder = new TextDecoder();
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let buffer = "";
    let textEmitted = false;
    let finishReason: string | null = null;
    let reasoningChars = 0;

    const reader = res.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // proses baris "data: ..." per baris
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // simpan sisa buffer
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;

          let chunk: {
            choices?: Array<{
              delta?: {
                content?: string;
                reasoning_content?: string;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string | null;
            }>;
          };
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue;
          }

          const choice = chunk.choices?.[0];
          const delta = choice?.delta;
          if (!delta) continue;
          if (choice?.finish_reason) finishReason = choice.finish_reason;

          // penalaran internal → yield sbg bagian thought (tampilan/simpanan di-skip tool-loop)
          if (delta.reasoning_content) {
            reasoningChars += delta.reasoning_content.length;
            yield { text: delta.reasoning_content, thought: true };
          }

          // teks → yield langsung (streaming ke user)
          if (delta.content) {
            textEmitted = true;
            yield { text: delta.content };
          }

          // tool calls → akumulasi (perlu JSON args lengkap)
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const acc = toolAcc.get(idx) ?? { id: "", name: "", args: "" };
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name = tc.function.name;
              if (tc.function?.arguments) acc.args += tc.function.arguments;
              toolAcc.set(idx, acc);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // yield tool calls setelah stream selesai (args sudah lengkap)
    for (const [, acc] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
      if (!acc.name) continue;
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(acc.args || "{}");
        if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
      } catch {
        args = {};
      }
      yield {
        functionCall: {
          name: mapBackToolName(acc.name, known),
          args,
          id: acc.id || undefined,
        },
      };
    }
    // jika tak ada teks & tak ada tool call → putaran kosong (biasanya model hanya
    // menalar lalu berhenti / kena potong) — catat utk diagnosis jawaban-kosong
    if (!textEmitted && toolAcc.size === 0) {
      console.warn(`[nvidia] stream kosong (finish=${finishReason ?? "?"}, reasoning=${reasoningChars} kar)`);
    }
  }
}

/** Petakan nama tool NVIDIA (underscore) → nama tool asli (titik) bila ada di katalog. */
export function mapBackToolName(nvidiaName: string, knownTools: string[]): string {
  if (knownTools.includes(nvidiaName)) return nvidiaName;
  const underscored = knownTools.map((k) => [k, toNvidiaToolName(k)] as const);
  const hit = underscored.find(([, n]) => n === nvidiaName);
  return hit ? hit[0] : nvidiaName;
}
