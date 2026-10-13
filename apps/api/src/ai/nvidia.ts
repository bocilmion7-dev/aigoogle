import { GeminiHttpError } from "./gemini-error.js";
import { sanitizeToolSchema } from "./schema-sanitize.js";
import type { GenerateOpts, GeminiContent, GeminiPart, ToolDecl } from "./gemini-types.js";

/**
 * Klien NVIDIA NIM (OpenAI-compatible /v1/chat/completions) sbg provider failover.
 *
 * Perbedaan format dgn Gemini yg harus dijembatani:
 * - Nama function harus [A-Za-z0-9_] — titik tool kita (mis. salesInvoice.list)
 *   dipetakan ke underscore, lalu dipetakan balik saat membaca response.
 * - Konten system = pesan `system` pertama (bukan systemInstruction terpisah).
 * - Riwayat: model → `assistant`, functionResponse → `tool` dgn tool_call_id.
 * - Balasan tool-calls ada di `choices[0].message.tool_calls` (bukan parts).
 */
const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";

/** "salesInvoice.list" → "salesInvoice_list"; kunci balik utk mengembalikan nama asli. */
export function toNvidiaToolName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

interface OpenAIToolCall {
  id?: string;
  type?: string;
  function: { name: string; arguments: string };
}
interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

/** GenerateOpts (format Gemini) → pesan OpenAI. */
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
      // peran user: teks biasa ATAU functionResponse (→ pesan tool)
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
  return out;
}

/** ToolDecl (format Gemini) → tools OpenAI (nama disanitasi utk validasi NIM). */
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

/** Response OpenAI → parts Gemini (nama tool dipetakan balik ke titik). */
function partsFromOpenAI(json: {
  choices?: Array<{ message?: OpenAIMessage }>;
}): GeminiPart[] {
  const msg = json.choices?.[0]?.message;
  if (!msg) return [];
  const parts: GeminiPart[] = [];
  if (msg.tool_calls?.length) {
    for (const tc of msg.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(tc.function.arguments || "{}");
        if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
      } catch {
        args = {};
      }
      parts.push({
        functionCall: {
          // kembalikan titik: "salesInvoice_list" → "salesInvoice.list" bila cocok dgn katalog
          name: tc.function.name,
          args,
          id: tc.id,
        },
      });
    }
  }
  if (msg.content) parts.push({ text: msg.content });
  return parts;
}

export interface NvidiaClient {
  listModels(): Promise<string[]>;
  generate(opts: GenerateOpts): Promise<{ parts: GeminiPart[] }>;
}

export class RealNvidiaClient implements NvidiaClient {
  constructor(private apiKey: string, private baseUrl: string = NVIDIA_BASE) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" };
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers() });
    if (!res.ok) throw new GeminiHttpError(res.status, await res.text().catch(() => ""));
    const j = (await res.json()) as { data?: Array<{ id?: string }> };
    return (j.data ?? []).map((m) => m.id).filter((x): x is string => !!x);
  }

  async generate(opts: GenerateOpts): Promise<{ parts: GeminiPart[] }> {
    const tools = toOpenAITools(opts.tools);
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: toOpenAIMessages(opts),
    };
    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new GeminiHttpError(res.status, await res.text().catch(() => ""));
    const parts = partsFromOpenAI(await res.json());
    // petakan balik nama tool: "salesInvoice_list" → "salesInvoice.list" (cocok katalog)
    const known = (opts.tools ?? []).flatMap((t) => t.functionDeclarations ?? []).map((d) => d.name);
    for (const p of parts) {
      if (p.functionCall) p.functionCall.name = mapBackToolName(p.functionCall.name, known);
    }
    return { parts };
  }
}

/** Petakan nama tool NVIDIA (underscore) → nama tool asli (titik) bila ada di katalog. */
export function mapBackToolName(nvidiaName: string, knownTools: string[]): string {
  if (knownTools.includes(nvidiaName)) return nvidiaName;
  const underscored = knownTools.map((k) => [k, toNvidiaToolName(k)] as const);
  const hit = underscored.find(([, n]) => n === nvidiaName);
  return hit ? hit[0] : nvidiaName;
}
