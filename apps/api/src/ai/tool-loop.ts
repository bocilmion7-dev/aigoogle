import type { LLMClient } from "./llm-client.js";
import type { LLMContent, LLMPart } from "./llm-types.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import type { ToolSpec } from "../providers/accounting/types.js";
import { AGGREGATION_NAMES } from "../providers/accounting/aggregation.js";

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
  /**
   * Kirim seluruh buffer SEKALIGUS & matikan timer — dipakai utk narasi transisi
   * sebelum tool call: jangan tahan eksekusi tool menunggu efek "mengetik" selesai
   * (dulu ~10-20 dtk terbuang percuma tiap putaran).
   */
  flushAll(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.buffer) { this.emit(this.buffer); this.buffer = ""; }
  }
}

/** JSON dgn key urut — agar argumen identik (beda urut key) menghasilkan key cache sama. */
function stableArgsKey(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(stableArgsKey).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + stableArgsKey(o[k])).join(",") + "}";
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
  // cache hasil tool (key stabil: nama + args urut) — model kadang memanggil tool
  // identik berkali-kali dlm 1 sesi; hasilnya sama, tak perlu panggil Accurate lagi
  const resultCache = new Map<string, unknown>();

  // --- nudge anti "verifikasi ulang" ---
  // Model gemar memeriksa ulang hasil agregasi dgn nama mirip (lastOrderByName("Budi")
  // setelah "Budi Santoso") atau customer.list keywords nama yg sama. Setiap putaran
  // = +1 panggilan LLM (0,5-15 dtk) → jawab dari data yg sudah ada tanpa eksekusi ulang.
  // CATATAN: functionResponse harus berisi DATA MURNI hasil eksekusi — menambah teks
  // catatan ke dalamnya membuat gateway LLM (Gonka) menandai "tampered — re-run" dan
  // model justru MENGULANG tool (kebalikan dr tujuan). Instruksi anti-ulang diserahkan
  // ke system prompt.
  const aggNameHits: Array<{
    tool: string;
    name: string;
    customer: Record<string, unknown> | null;
    vendor: Record<string, unknown> | null;
    result: unknown;
  }> = [];
  const normName = (v: unknown) => String(v ?? "").trim().toLowerCase();
  const nameCovered = (a: string, b: string) => a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a));

  // throttled emitter: buffer teks lalu keluarkan bertahap supaya terasa mengetik
  // (15ms × 3 char ≈ 200 char/s — masih terasa mengetik, tapi tak menambah latensi berarti)
  const streamInterval = opts.streamIntervalMs ?? 15;
  const streamChunk = opts.streamChunkSize ?? 3;
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
    // streaming: buffer teks via throttled emitter; kumpulkan parts utk tool call.
    // signal membatasi waktu stream per step sisa deadline — call yg menggantung
    // (Gonka/LLM lambat) dipotong tepat waktu, bukan menggantung tanpa batas.
    const parts: LLMPart[] = [];
    const stepSignal = AbortSignal.timeout(Math.max(500, deadline - now()));
    try {
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
        signal: stepSignal,
      })) {
        if (part.text && !part.thought) {
          text += part.text;
          emitter.push(part.text);
        }
        parts.push(part);
      }
    } catch (e) {
      // stream dibatalkan krn lewat batas waktu → pesan deadline (teks sebagian tetap tampil)
      if (stepSignal.aborted) {
        await emitter.end();
        const msg = "Butuh waktu lebih lama dari biasanya — coba persempit pertanyaan Anda.";
        opts.onEvent({ type: "text_delta", delta: msg });
        return { text: text + msg, trace };
      }
      throw e;
    }
    // stream selesai → tentukan dulu apakah ada tool call pada step ini
    const calls = parts.filter((p) => p.functionCall && p.functionCall.name);
    if (calls.length > 0) {
      // narasi transisi SEBELUM tool call → flush sekaligus: eksekusi tool jangan
      // tertahan menunggu efek mengetik (dulu ~10-20 dtk terbuang tiap putaran)
      emitter.flushAll();
    } else {
      // jawaban final → selesaikan efek mengetik agar terasa natural
      await emitter.end();
    }
    // bagian `thought` = penalaran internal model thinking — jangan tampilkan/simpan
    const visible = parts.filter((p) => !p.thought);
    if (calls.length === 0) return { text, trace };

    contents.push({ role: "model", parts: visible });

    // --- Adapter agregasi: klasifikasi semua tool call lalu eksekusi paralel ---
    // Setiap call divalidasi & diklasifikasi dulu; call yg butuh panggilan Accurate
    // (tidak cache, argumen valid, punya izin) dijalankan BERSAMAAN via Promise.all
    // alih-alih satu per satu — mempercepat jawaban saat model memanggil banyak tool.
    interface PendingCall {
      call: (typeof calls)[number];
      spec: ToolSpec;
      cacheKey: string;
      /** call identik dlm putaran SAMA — dijawab dgn hasil yang sama (eksekusi sekali) */
      dups: Array<(typeof calls)[number]>;
    }
    const pending: PendingCall[] = [];
    const pushResponse = (
      name: string,
      id: string | undefined,
      response: unknown
    ): void => {
      contents.push({
        role: "user",
        parts: [{ functionResponse: { name, response, id } }],
      });
    };

    for (const call of calls) {
      const spec = opts.tools.find((t) => t.name === call.functionCall!.name);
      if (!spec) {
        trace.push({ tool: call.functionCall!.name, args: call.functionCall!.args, ok: false, reason: "unknown_tool" });
        pushResponse(call.functionCall!.name, call.functionCall!.id, { error: "tool tidak dikenal" });
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
        pushResponse(spec.name, call.functionCall!.id, { error: errMsg });
        continue;
      }
      // minimal satu field pilihan wajib terisi (skema `required` tak bisa menyatakan "atau")
      const oneOf = spec.oneOfRequired ?? [];
      if (oneOf.length > 0 && !oneOf.some((k) => args[k] !== undefined && args[k] !== null && args[k] !== "")) {
        const errMsg = `args wajib diisi — isi salah satu dari: ${oneOf.join(" / ")}`;
        console.error(`[tool-loop] ${spec.name} invalid:`, errMsg);
        trace.push({ tool: spec.name, args, ok: false, reason: "missing_args_oneof" });
        opts.onEvent({ type: "tool_result", tool: spec.name, ok: false });
        pushResponse(spec.name, call.functionCall!.id, { error: errMsg });
        continue;
      }
      if (!opts.permissions.has(spec.requiredPermission)) {
        trace.push({ tool: spec.name, args: call.functionCall!.args, ok: false, reason: "no_permission" });
        opts.onEvent({ type: "tool_result", tool: spec.name, ok: false });
        pushResponse(spec.name, call.functionCall!.id, {
          error: `Anda tidak punya akses modul ${spec.requiredPermission}`,
        });
        continue;
      }
      // tool+args identik pernah sukses → pakai hasil cache (hemat panggilan Accurate)
      const cacheKey = `${spec.name}:${stableArgsKey(call.functionCall!.args ?? {})}`;
      if (resultCache.has(cacheKey)) {
        trace.push({ tool: spec.name, args: call.functionCall!.args, ok: true, cached: true });
        opts.onEvent({ type: "tool_result", tool: spec.name, ok: true });
        const result = resultCache.get(cacheKey);
        const wrapped =
          Array.isArray(result) ? { items: result } : result && typeof result === "object" ? result : { result };
        pushResponse(spec.name, call.functionCall!.id, wrapped);
        continue;
      }
      // agregasi by-name dgn nama "tercakup" hasil sebelumnya (mis. "Budi" → "Budi Santoso")
      // → jawab dgn data yg sudah ada tanpa putaran eksekusi
      if (AGGREGATION_NAMES.has(spec.name) && args.name !== undefined && args.name !== null && args.name !== "") {
        const nm = normName(args.name);
        const prior = aggNameHits.find((h) => h.tool === spec.name && nameCovered(h.name, nm));
        if (prior && typeof prior.result === "object" && prior.result) {
          trace.push({ tool: spec.name, args, ok: true, nudged: true });
          opts.onEvent({ type: "tool_result", tool: spec.name, ok: true });
          pushResponse(spec.name, call.functionCall!.id, prior.result);
          continue;
        }
      }
      // customer.list dgn keywords nama yg SUDAH di-agregasi → cross-check; balas dgn
      // baris pelanggan dari hasil agregasi (tanpa putaran eksekusi)
      if (spec.name === "customer.list" && args.keywords !== undefined && args.keywords !== null && args.keywords !== "") {
        const kw = normName(args.keywords);
        const prior = kw ? aggNameHits.find((h) => h.customer && nameCovered(h.name, kw)) : undefined;
        if (prior?.customer) {
          trace.push({ tool: spec.name, args, ok: true, nudged: true });
          opts.onEvent({ type: "tool_result", tool: spec.name, ok: true });
          pushResponse(spec.name, call.functionCall!.id, { items: [prior.customer] });
          continue;
        }
      }
      // vendor.list dgn keywords nama yg SUDAH di-agregasi (trio vendor) → balas
      // dari data agregasi (mirror customer.list di atas)
      if (spec.name === "vendor.list" && args.keywords !== undefined && args.keywords !== null && args.keywords !== "") {
        const kw = normName(args.keywords);
        const prior = kw ? aggNameHits.find((h) => h.vendor && nameCovered(h.name, kw)) : undefined;
        if (prior?.vendor) {
          trace.push({ tool: spec.name, args, ok: true, nudged: true });
          opts.onEvent({ type: "tool_result", tool: spec.name, ok: true });
          pushResponse(spec.name, call.functionCall!.id, { items: [prior.vendor] });
          continue;
        }
      }
      // duplikat persis dlm putaran sama → eksekusi sekali, hasil dipakai semua id
      const dupPending = pending.find((p) => p.cacheKey === cacheKey);
      if (dupPending) {
        dupPending.dups.push(call);
        trace.push({ tool: spec.name, args: call.functionCall!.args, ok: true, dup: true });
        opts.onEvent({ type: "tool_result", tool: spec.name, ok: true });
        continue;
      }
      pending.push({ call, spec, cacheKey, dups: [] });
    }

    // eksekusi paralel: hasil disimpan per indeks, lalu di-push sesuai urutan asli
    if (pending.length > 0) {
      const results = await Promise.all(
        pending.map(async ({ call, spec, cacheKey, dups }) => {
          try {
            const result = await opts.providerExecute(spec.name, call.functionCall!.args);
            resultCache.set(cacheKey, result);
            return { spec, call, dups, ok: true as const, result };
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : "gagal";
            console.error(`[tool-loop] ${spec.name} gagal:`, errMsg, "| args:", JSON.stringify(call.functionCall!.args).slice(0, 200));
            return { spec, call, dups, ok: false as const, errMsg };
          }
        })
      );

      for (const r of results) {
        if (r.ok) {
          trace.push({ tool: r.spec.name, args: r.call.functionCall!.args, ok: true });
          opts.onEvent({ type: "tool_result", tool: r.spec.name, ok: true });
          const wrapped =
            Array.isArray(r.result)
              ? { items: r.result }
              : r.result && typeof r.result === "object"
                ? r.result
                : { result: r.result };
          pushResponse(r.spec.name, r.call.functionCall!.id, wrapped);
          // simpan hasil agregasi by-name → bekal nudge anti-verifikasi-ulang
          if (AGGREGATION_NAMES.has(r.spec.name)) {
            const nm = normName((r.call.functionCall!.args ?? {}).name);
            const res = r.result as { customer?: Record<string, unknown>; vendor?: Record<string, unknown> } | null;
            aggNameHits.push({
              tool: r.spec.name,
              name: nm,
              customer: res?.customer ?? null,
              vendor: res?.vendor ?? null,
              result: r.result,
            });
          }
          // duplikat persis dlm putaran → balas dgn hasil yg sama (tanpa eksekusi ulang)
          for (const d of r.dups) {
            pushResponse(r.spec.name, d.functionCall!.id, wrapped);
          }
        } else {
          trace.push({ tool: r.spec.name, args: r.call.functionCall!.args, ok: false, reason: "execute_error" });
          opts.onEvent({ type: "tool_result", tool: r.spec.name, ok: false });
          pushResponse(r.spec.name, r.call.functionCall!.id, { error: r.errMsg });
          for (const d of r.dups) pushResponse(r.spec.name, d.functionCall!.id, { error: r.errMsg });
          // error koneksi (Accurate terputus/sibuk) → langsung jelaskan, jangan serahkan ke model (bisa salah tebak)
          if (/koneksi|hubungi|terputus|belum aktif|fetch failed|ECONNREFUSED|ENOTFOUND|sibuk|timeout/i.test(r.errMsg)) {
            const msg = `Saya tidak dapat mengambil data karena ${r.errMsg.replace(/^tidak dapat menghubungi /, "")}. Silakan periksa koneksi Anda lalu coba lagi.`;
            opts.onEvent({ type: "text_delta", delta: msg });
            return { text: msg, trace };
          }
          // tool yg sama gagal berkali-kali → hentikan agar tak loop membingungkan
          const n = (failCount.get(r.spec.name) ?? 0) + 1;
          failCount.set(r.spec.name, n);
          if (n >= FAIL_CAP) {
            opts.onEvent({ type: "text_delta", delta: "Data belum bisa diambil saat ini — coba lagi beberapa saat lagi." });
            return { text: "Data belum bisa diambil saat ini — coba lagi beberapa saat lagi.", trace };
          }
        }
      }
    }
  }
  const msg = "Terlalu banyak langkah — coba persempit pertanyaan Anda.";
  opts.onEvent({ type: "text_delta", delta: msg });
  return { text: msg, trace };
}
