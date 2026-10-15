import type { LLMClient } from "./llm-client.js";
import type { LLMContent, LLMPart } from "./llm-types.js";
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
  client: LLMClient;
  providerExecute: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
  permissions: Set<string>;
  tools: ToolSpec[];
  userMessage: string;
  history?: LLMContent[];
  onEvent: (e: ToolLoopEvent) => void;
  system?: string;
  model?: string;
  maxSteps?: number;
  now?: () => number;
  /** kecepatan streaming teks: ms antar chunk (0 = tanpa throttle, langsung semua) */
  streamIntervalMs?: number;
  /** jumlah karakter per chunk saat streaming */
  streamChunkSize?: number;
}

/**
 * Throttled text emitter — buffer teks lalu keluarkan bertahap
 * supaya kemunculan huruf terasa seperti mengetik (bukan tiba-tiba semua).
 */
class ThrottledEmitter {
  private buffer = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly interval: number;
  private readonly chunkSize: number;
  private ended = false;
  constructor(
    private emit: (delta: string) => void,
    intervalMs: number,
    chunkSize: number
  ) {
    this.interval = intervalMs;
    this.chunkSize = chunkSize;
  }
  push(text: string): void {
    this.buffer += text;
    if (!this.timer) {
      this.flushChunk();
      this.timer = setInterval(() => this.flushChunk(), this.interval);
    }
  }
  private flushChunk(): void {
    if (!this.buffer) {
      // buffer kosong
      if (this.ended) {
        // stream selesai & buffer habis → hentikan timer
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
      }
      // jika belum ended, biarkan timer jalan (siap terima teks berikutnya)
      return;
    }
    const chunk = this.buffer.slice(0, this.chunkSize);
    this.buffer = this.buffer.slice(this.chunkSize);
    this.emit(chunk);
  }
  /**
   * Tandai stream selesai — buffer akan terus dikosongkan oleh timer
   * sampai habis (JANGAN dump sekaligus). Return Promise yang resolve
   * saat buffer kosong & timer berhenti.
   */
  end(): Promise<void> {
    this.ended = true;
    if (!this.buffer && !this.timer) return Promise.resolve();
    // jika timer belum jalan (tak ada teks sama sekali), selesai
    if (!this.timer) {
      // buffer ada tapi timer mati → nyalakan
      if (this.buffer) {
        this.timer = setInterval(() => this.flushChunk(), this.interval);
      } else {
        return Promise.resolve();
      }
    }
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (!this.buffer && !this.timer) {
          clearInterval(check);
          resolve();
        }
      }, 20);
    });
  }
}

export async function runToolLoop(
  opts: ToolLoopOpts
): Promise<{ text: string; trace: Array<Record<string, unknown>> }> {
  const maxSteps = opts.maxSteps ?? 8;
  const now = opts.now ?? Date.now;
  const deadline = now() + 120_000;
  const trace: Array<Record<string, unknown>> = [];
  const contents: LLMContent[] = [
    ...(opts.history ?? []),
    { role: "user", parts: [{ text: opts.userMessage }] },
  ];
  opts.onEvent({ type: "start" });
  let text = "";
  // hitung gagal per tool — bila1 tool gagal berulang (mis. koneksi mati),
  // berhenti & jelaskan alih-alih loop "Daftar…" yg sama berkali-kali
  const failCount = new Map<string, number>();
  const FAIL_CAP = 2;

  // throttled emitter: buffer teks lalu keluarkan bertahap supaya terasa mengetik
  const streamInterval = opts.streamIntervalMs ?? 60;
  const streamChunk = opts.streamChunkSize ?? 2;
  const emitter = new ThrottledEmitter(
    (delta) => opts.onEvent({ type: "text_delta", delta }),
    streamInterval,
    streamChunk
  );

  for (let step = 0; step < maxSteps; step++) {
    if (now() > deadline) {
      const msg = "Butuh waktu lebih lama dari biasanya — coba persempit pertanyaan Anda.";
      opts.onEvent({ type: "text_delta", delta: msg });
      return { text: msg, trace };
    }
    // streaming: buffer teks via throttled emitter; kumpulkan parts utk tool call
    const parts: LLMPart[] = [];
    for await (const part of opts.client.generateStream({
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
      system: opts.system ?? SYSTEM_PROMPT,
      model: opts.model,
    })) {
      if (part.text && !part.thought) {
        text += part.text;
        emitter.push(part.text);
      }
      parts.push(part);
    }
    // stream selesai → tunggu buffer kosong (jangan dump sekaligus)
    await emitter.end();
    const calls = parts.filter((p) => p.functionCall && p.functionCall.name);
    // bagian `thought` = penalaran internal model thinking — jangan tampilkan/simpan
    const visible = parts.filter((p) => !p.thought);
    if (calls.length === 0) return { text, trace };

    contents.push({ role: "model", parts: visible });
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
      // validasi argumen wajib sebelum eksekusi (model kadang lupa isi required args)
      const schema = spec.jsonSchema as { required?: string[]; properties?: Record<string, unknown> };
      const required = schema.required ?? [];
      const args = call.functionCall!.args ?? {};
      const missing = required.filter((k) => args[k] === undefined || args[k] === null || args[k] === "");
      if (missing.length > 0) {
        const errMsg = `args wajib belum diisi: ${missing.join(", ")}`;
        console.error(`[tool-loop] ${spec.name} invalid:`, errMsg);
        trace.push({ tool: spec.name, args, ok: false, reason: "missing_args" });
        opts.onEvent({ type: "tool_result", tool: spec.name, ok: false });
        contents.push({
          role: "user",
          parts: [{ functionResponse: { name: spec.name, response: { error: errMsg }, id: call.functionCall!.id } }],
        });
        continue;
      }
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
        const errMsg = e instanceof Error ? e.message : "gagal";
        console.error(`[tool-loop] ${spec.name} gagal:`, errMsg, "| args:", JSON.stringify(call.functionCall!.args).slice(0, 200));
        trace.push({ tool: spec.name, args: call.functionCall!.args, ok: false, reason: "execute_error" });
        opts.onEvent({ type: "tool_result", tool: spec.name, ok: false });
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: { name: spec.name, response: { error: errMsg }, id: call.functionCall!.id },
            },
          ],
        });
        // error koneksi (Accurate terputus/sibuk) → langsung jelaskan, jangan serahkan ke model (bisa salah tebak)
        if (/koneksi|hubungi|terputus|belum aktif|fetch failed|ECONNREFUSED|ENOTFOUND|sibuk|timeout/i.test(errMsg)) {
          const msg = `Saya tidak dapat mengambil data karena ${errMsg.replace(/^tidak dapat menghubungi /, "")}. Silakan periksa koneksi Anda lalu coba lagi.`;
          opts.onEvent({ type: "text_delta", delta: msg });
          return { text: msg, trace };
        }
        // tool yg sama gagal berkali-kali → hentikan agar tak loop membingungkan
        const n = (failCount.get(spec.name) ?? 0) + 1;
        failCount.set(spec.name, n);
        if (n >= FAIL_CAP) {
          opts.onEvent({ type: "text_delta", delta: "Data belum bisa diambil saat ini — coba lagi beberapa saat lagi." });
          return { text: "Data belum bisa diambil saat ini — coba lagi beberapa saat lagi.", trace };
        }
      }
    }
  }
  const msg = "Terlalu banyak langkah — coba persempit pertanyaan Anda.";
  opts.onEvent({ type: "text_delta", delta: msg });
  return { text: msg, trace };
}
