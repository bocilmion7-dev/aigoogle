# Fase 2 — AI Chat + Voice (Gemini Tool Loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tanya-jawab data akuntansi (teks & suara) berjalan — Gemini tool loop memanggil Accurate (mock/live) dengan penegakan permission per-role, streaming + badge tool di UI, riwayat chat, STT/TTS dua engine.

**Architecture:** `GeminiClient` (real: REST v1beta, fake: unit test) → `runToolLoop` (maks 8 langkah, deadline 60 dtk, permission gate per tool) → `AccountingProvider.execute` (scoped tenant: host + X-Session-ID + Bearer, follow 308) → NDJSON stream ke web. Model data bertambah: ChatSession/ChatMessage/AuditLog + kolom `Connection.session`.

**Tech Stack:** Gemini REST (`gemini-3.8-flash` teks/tool, `gemini-3.8-flash-tts` audio/wav, `gemini-3.5-transcribe` STT — terverifikasi live 2026-10-10), Express NDJSON, Prisma/Neon, React fetch-stream, Web Speech API.

**Fakta API Gemini terverifikasi (jangan diulang spike-nya):**
- Base: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, header `x-goog-api-key`.
- `generateContent` mengembalikan `candidates[0].content.parts[]` — `text` dan/atau `functionCall {name, args, id}` (+ `thoughtSignature`, diabaikan).
- Streaming: `:streamGenerateContent?alt=sse` → baris `data: {json}\n\n`.
- TTS: `responseModalities:["AUDIO"]` → `inlineData {mimeType:"audio/wav", data:base64}`. JANGAN kirim `speechConfig` (field `prebuiltVoiceCode`/`voiceName` ditolak API saat ini — pakai default voice).
- STT: model `gemini-3.5-transcribe`, kirim `inlineData` audio → teks. Model flash multimodal mengarang transkrip di audio senyap — jangan dipakai untuk STT.
- Sering 503 "high demand" sementara → klien retry 1× (backoff ~1.5 dtk); integration test retry ≤3 lalu skip (bukan gagal).
- `gemini-2.5-flash` ditolak untuk key baru (404) — pakai `gemini-3.8-flash`.

**Env baru (opsional, ada default):** `GEMINI_MODEL=gemini-3.8-flash`, `GEMINI_TTS_MODEL=gemini-3.8-flash-tts`, `GEMINI_TRANSCRIBE_MODEL=gemini-3.5-transcribe`.

---

## File Structure

```
apps/api/prisma/schema.prisma          # + ChatSession, ChatMessage, AuditLog; Connection + session
apps/api/src/env.ts                    # + GEMINI_MODEL/TTS/TRANSCRIBE (default)
apps/api/src/ai/gemini-types.ts        # GeminiPart, ToolDecl, GenerateOpts
apps/api/src/ai/gemini-client.ts       # interface GeminiClient + RealGeminiClient (retry, SSE)
apps/api/src/ai/fake-gemini.ts         # FakeGeminiClient (queue script) — test only
apps/api/src/ai/system-prompt.ts       # prompt BI + format angka
apps/api/src/ai/tool-loop.ts           # runToolLoop: permission gate, max 8, deadline 60dtk, onEvent
apps/api/src/permissions.ts            # loadPermissionSet(user), hasPermission
apps/api/src/audit.ts                  # writeAudit(prisma, ...)
apps/api/src/providers/accounting/types.ts   # + ToolSpec, ProviderCtx; interface + capabilityCatalog/execute/refreshIfNeeded/privilegeCatalog
apps/api/src/providers/accounting/accurate.ts # implementasi execute/refresh/privilege (module API)
apps/api/src/providers/accounting/catalog.ts  # tool catalog accurate (customer.list, salesEntry.list)
apps/api/src/routes/chat.ts            # sessions list/create, messages, POST /api/chat/stream (NDJSON)
apps/api/src/routes/audio.ts           # POST /api/stt, POST /api/tts (503 bila key invalid)
apps/api/src/routes/launch.ts          # ubah: simpan host+session; seed permission modul (admin=all, staff=privilege API)
apps/api/src/app.ts                    # mount chatRouter, audioRouter
apps/api/test/gemini-real.test.ts      # smoke real Gemini (skipIf key invalid; retry 3)
apps/api/test/tool-loop.test.ts        # fake gemini: loop, permission tolak, max steps
apps/api/test/accurate-execute.test.ts # execute vs mock in-process (+refresh, +308?)
apps/api/test/chat-stream.test.ts      # e2e API: NDJSON + audit + persistence (fake gemini + mock accurate)
apps/api/test/chat-isolation.test.ts   # 2 tenant: tool & riwayat tidak bocor
apps/api/test/audio-real.test.ts       # STT wav senyap → "" ; TTS → audio/wav (skipIf/ retry)
apps/web/src/pages/Shell.tsx           # ganti: shell + panel Chat
apps/web/src/pages/Chat.tsx            # streaming NDJSON, badge tool, riwayat, error state
apps/web/src/voice.ts                  # web-speech STT/TTS + gemini /api/stt /api/tts
```

## Konvensi (ikuti pola Fase 1)

- ESM NodeNext: relatif pakai akhiran `.js`. Rute async dibungkus `asyncHandler`.
- TDD: test gagal dulu → implement → pass → commit per task.
- `pnpm test` di `apps/api/`; typecheck `pnpm typecheck`; verifikasi akhir root.
- Streaming: NDJSON (`res.write(JSON.stringify(ev)+"\n")`), event: `{"type":"start"|"tool_call"|"tool_result"|"text_delta"|"done"|"error", ...}`.
- Isolasi tenant: SEMUA query Prisma where `tenantId` dari `req.user`; uji wajib bocor = gagal.
- Permission key modul: `accurate:customer.view`, `accurate:sales-entry.view` (sesuai catalog). Admin role di-seed semua key modul saat launch.

---

## Tasks (outline — kode diisi per task)

1. **Migrasi data chat** — skema + migrate Neon.
2. **GeminiClient + smoke real** — interface, RealGeminiClient, env; test teks asli (retry, skipIf).
3. **FakeGemini + system prompt + runToolLoop** — TDD murni (loop, permission tolak, batas 8 langkah, deadline).
4. **Provider: catalog + execute + refresh + privilege** — TDD vs mock in-process.
5. **Launch upgrade** — simpan host+session; seed permission modul per role (perluas test oauth-launch).
6. **Chat persistence + stream endpoint** — TDD supertest (NDJSON, audit, riwayat) dengan fake gemini.
7. **Isolasi multi-tenant** — dua tenant, wajib gagal bila bocor.
8. **Integration Gemini asli + mock Accurate** — pertanyaan BI → tool dipanggil → jawaban (skip/retry saat outage).
9. **Endpoint STT + TTS** — transcribe wav senyap, TTS wav bytes (skip/retry).
10. **UI Chat** — Shell + Chat.tsx streaming, badge, riwayat, sapaan+suggested, error state.
11. **Voice wiring** — web-speech (browser) + gemini-native (/api/stt, /api/tts auto-play) sesuai setting.
12. **Smoke e2e lokal + README + verifikasi akhir** — skrip 3 proses, chat asli via proxy, dokumen hasil.

---

### Task 1: Migrasi data chat

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Tambah model + kolom**

Edit `apps/api/prisma/schema.prisma`:

a) Di model `Connection`, tambah kolom session (setelah `host`):
```prisma
  session       String     @default("")
```
b) Tambah 3 model di akhir file:
```prisma
model ChatSession {
  id        String        @id @default(cuid())
  tenant    Tenant        @relation(fields: [tenantId], references: [id])
  tenantId  String
  user      User          @relation(fields: [userId], references: [id])
  userId    String
  title     String        @default("Percakapan baru")
  createdAt DateTime      @default(now())
  messages  ChatMessage[]
}

model ChatMessage {
  id        String      @id @default(cuid())
  session   ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  sessionId String
  role      String // "user" | "ai"
  content   String
  toolTrace String      @default("[]") // JSON array {tool, args, ok}
  createdAt DateTime    @default(now())
}

model AuditLog {
  id        String   @id @default(cuid())
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  tenantId  String
  userId    String
  action    String
  detail    String   @default("{}") // JSON
  createdAt DateTime @default(now())
}
```
c) Di model `Tenant` tambah relasi: `chatSessions ChatSession[]` dan `auditLogs AuditLog[]`. Di model `User` tambah: `chatSessions ChatSession[]`.

- [ ] **Step 2: Migrate**

```bash
cd apps/api && export DATABASE_URL="$(grep '^DATABASE_URL=' ../../.env | cut -d= -f2-)" && pnpm exec prisma migrate dev --name chat-audit
```
Expected: applied; client regenerated.

- [ ] **Step 3: Verify**

`pnpm test` (apps/api) → 22/22 PASS; `pnpm typecheck` → 0.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase2): skema ChatSession/ChatMessage/AuditLog + Connection.session"
```

---

### Task 2: GeminiClient (real) + env + smoke test asli

**Files:**
- Modify: `apps/api/src/env.ts`
- Create: `apps/api/src/ai/gemini-types.ts`, `apps/api/src/ai/gemini-client.ts`, `apps/api/test/gemini-real.test.ts`

- [ ] **Step 1: env — model opsional**

Edit `apps/api/src/env.ts`, tambah ke `Env`:
```ts
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  GEMINI_TTS_MODEL: z.string().default("gemini-3.8-flash-tts"),
  GEMINI_TRANSCRIBE_MODEL: z.string().default("gemini-3.5-transcribe"),
```

- [ ] **Step 2: tipe**

Create `apps/api/src/ai/gemini-types.ts`:
```ts
export interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}
export interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: { name: string; response: unknown; id?: string };
  inlineData?: { mimeType: string; data: string };
}
export interface ToolDecl {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}
export interface GenerateOpts {
  contents: GeminiPart[];
  tools?: ToolDecl[];
  system?: string;
  model?: string;
  responseModalities?: string[];
}
```

- [ ] **Step 3: failing test smoke real**

Create `apps/api/test/gemini-real.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { RealGeminiClient } from "../src/ai/gemini-client.js";

const keyOk = process.env.GEMINI_API_KEY?.startsWith("AQ.") || process.env.GEMINI_API_KEY?.startsWith("AIza");

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw last;
}

describe.skipIf(!keyOk)("Gemini asli (live)", () => {
  const gemini = new RealGeminiClient(process.env.GEMINI_API_KEY!);

  it("generateContent teks polos → balasan teks", async () => {
    const res = await withRetry(() =>
      gemini.generate({ contents: [{ text: "Balas satu kata saja: halo" }], })
    );
    expect(res.parts.some((p) => p.text && p.text.length > 0)).toBe(true);
  }, 60000);

  it("generateContent dengan tools → functionCall", async () => {
    const res = await withRetry(() =>
      gemini.generate({
        contents: [{ text: "Cek daftar pelanggan sekarang." }],
        tools: [{ functionDeclarations: [{ name: "listCustomers", description: "Ambil daftar pelanggan", parameters: { type: "object", properties: {} } }] }],
      })
    );
    expect(res.parts.some((p) => p.functionCall?.name === "listCustomers")).toBe(true);
  }, 60000);
});
```

- [ ] **Step 4: jalankan — FAIL (kelas belum ada)**

Run: `pnpm test gemini-real` (apps/api). Expected: FAIL import.

- [ ] **Step 5: implement RealGeminiClient**

Create `apps/api/src/ai/gemini-client.ts`:
```ts
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
      contents: [{ parts: opts.contents }],
      ...(opts.tools ? { tools: opts.tools } : {}),
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      ...(opts.responseModalities ? { generationConfig: { responseModalities: opts.responseModalities } } : {}),
    });
  }

  private async post(path: string, opts: GenerateOpts): Promise<Response> {
    const res = await fetch(`${BASE}/models/${opts.model}:${path}`, {
      method: "POST",
      headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" },
      body: this.body(opts),
    });
    if (res.status === 429 || res.status === 503) {
      await new Promise((r) => setTimeout(r, 1500));
      const again = await fetch(`${BASE}/models/${opts.model}:${path}`, {
        method: "POST",
        headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" },
        body: this.body(opts),
      });
      if (!again.ok) throw new GeminiHttpError(again.status, await again.text());
      return again;
    }
    if (!res.ok) throw new GeminiHttpError(res.status, await res.text());
    return res;
  }

  private partsFrom(json: { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> }): GeminiPart[] {
    return json.candidates?.[0]?.content?.parts ?? [];
  }

  async generate(opts: GenerateOpts): Promise<{ parts: GeminiPart[] }> {
    const res = await this.post("generateContent", { ...opts, model: opts.model ?? envModel() });
    return { parts: this.partsFrom(await res.json()) };
  }

  async *generateStream(opts: GenerateOpts): AsyncGenerator<GeminiPart> {
    const model = opts.model ?? envModel();
    const res = await this.post(`streamGenerateContent?alt=sse`, { ...opts, model });
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
          /* potongan SSE belum utuh — abaikan */
        }
      }
    }
  }
}

function envModel(): string {
  // dibaca per panggilan agar fleksibel di test
  return process.env.GEMINI_MODEL || "gemini-3.8-flash";
}
```

- [ ] **Step 6: PASS + commit**

Run: `pnpm test gemini-real` → PASS (atau ter-skip bila key tidak ada); `pnpm typecheck` → 0.
```bash
git add apps/api/src/env.ts apps/api/src/ai apps/api/test/gemini-real.test.ts
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase2): GeminiClient real (retry 429/503, SSE) + smoke test asli"
```

_(Task 3+ menyusul)_

---

### Task 3: FakeGemini + system prompt + runToolLoop (TDD murni)

**Files:**
- Create: `apps/api/src/ai/fake-gemini.ts`, `apps/api/src/ai/system-prompt.ts`, `apps/api/src/ai/tool-loop.ts`, `apps/api/test/tool-loop.test.ts`

- [ ] **Step 1: failing test**

Create `apps/api/test/tool-loop.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { runToolLoop } from "../src/ai/tool-loop.js";
import { FakeGeminiClient } from "../src/ai/fake-gemini.js";
import type { ToolSpec } from "../src/providers/accounting/types.js";

const TOOLS: ToolSpec[] = [
  { name: "customer.list", description: "Daftar pelanggan", jsonSchema: { type: "object", properties: {} }, requiredPermission: "accurate:customer.view", label: "Mengambil data pelanggan…" },
  { name: "salesEntry.list", description: "Daftar penjualan", jsonSchema: { type: "object", properties: {} }, requiredPermission: "accurate:sales-entry.view", label: "Mengambil data penjualan…" },
];

function deps(overrides: Partial<Parameters<typeof runToolLoop>[0]> = {}) {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    opts: {
      gemini: new FakeGeminiClient([]),
      providerExecute: async (tool: string) => ({ data: `isi-${tool}` }),
      permissions: new Set<string>(["accurate:customer.view", "accurate:sales-entry.view"]),
      tools: TOOLS,
      userMessage: "tanya",
      onEvent: (e: Record<string, unknown>) => events.push(e),
      ...overrides,
    } as Parameters<typeof runToolLoop>[0],
  };
}

describe("runToolLoop (fake gemini)", () => {
  it("teks polos tanpa tool → jawaban + satu text_delta", async () => {
    const fake = new FakeGeminiClient([{ parts: [{ text: "Halo!" }] }]);
    const { opts, events } = deps({ gemini: fake });
    const out = await runToolLoop(opts);
    expect(out.text).toBe("Halo!");
    expect(events.filter((e) => e.type === "text_delta")).toHaveLength(1);
  });

  it("tool dipanggil → event badge + providerExecute + functionResponse lanjut teks", async () => {
    const fake = new FakeGeminiClient([
      { parts: [{ functionCall: { name: "customer.list", args: {}, id: "c1" } }] },
      { parts: [{ text: "Ada 2 pelanggan." }] },
    ]);
    const calls: string[] = [];
    const { opts, events } = deps({
      gemini: fake,
      providerExecute: async (tool: string) => {
        calls.push(tool);
        return { items: ["Budi", "Siti"] };
      },
    });
    const out = await runToolLoop(opts);
    expect(calls).toEqual(["customer.list"]);
    expect(out.text).toBe("Ada 2 pelanggan.");
    expect(out.trace).toEqual([{ tool: "customer.list", args: {}, ok: true }]);
    expect(events.some((e) => e.type === "tool_call" && e.tool === "customer.list")).toBe(true);
    // permintaan kedua ke gemini berisi functionResponse
    const second = fake.calls[1];
    expect(JSON.stringify(second.contents)).toContain("functionResponse");
  });

  it("permission ditolak → tidak panggil provider; AI diminta menjawab tidak punya akses", async () => {
    const fake = new FakeGeminiClient([
      { parts: [{ functionCall: { name: "salesEntry.list", args: {}, id: "c1" } }] },
      { parts: [{ text: "Anda tidak punya akses modul penjualan." }] },
    ]);
    const { opts } = deps({
      gemini: fake,
      permissions: new Set(["accurate:customer.view"]),
      providerExecute: async () => {
        throw new Error("tidak boleh dipanggil");
      },
    });
    const out = await runToolLoop(opts);
    expect(out.trace[0]).toMatchObject({ tool: "salesEntry.list", ok: false, reason: "no_permission" });
    expect(out.text).toContain("tidak punya akses");
  });

  it("melebihi 8 langkah → berhenti dengan pesan meminta persempit", async () => {
    const turns = Array.from({ length: 9 }, () => ({
      parts: [{ functionCall: { name: "customer.list", args: {}, id: "x" } }],
    }));
    const fake = new FakeGeminiClient(turns);
    const { opts } = deps({ gemini: fake });
    const out = await runToolLoop(opts);
    expect(out.text).toContain("persempit");
    expect(fake.calls.length).toBeLessThanOrEqual(8);
  });

  it("deadline 60 dtk terlampaui → pesan butuh waktu", async () => {
    const fake = new FakeGeminiClient([{ parts: [{ text: "ok" }] }]);
    const { opts } = deps({ gemini: fake, now: (() => { let t = 0; return () => (t += 61_000); })() });
    const out = await runToolLoop(opts);
    expect(out.text).toContain("waktu");
  });
});
```

- [ ] **Step 2: jalankan — FAIL (modul belum ada)**

Run: `pnpm test tool-loop`. Expected: FAIL.

- [ ] **Step 3: implement fake + prompt + loop**

Create `apps/api/src/ai/fake-gemini.ts`:
```ts
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
```

Create `apps/api/src/ai/system-prompt.ts`:
```ts
export const SYSTEM_PROMPT = `Anda adalah asisten akuntansi untuk Accurate Online.
Jawab HANYA berdasarkan hasil tool yang Anda panggil — jangan mengarang angka.
Format angka: Rupiah "Rp1.234.567" (titik ribuan), desimal koma.
Bila tool ditolak karena hak akses, jawab singkat: Anda tidak punya akses modul terkait.
Bahasa percakapan: Bahasa Indonesia, ringkas, ramah.
Bila diminta menjumlahkan/menghitung, panggil tool dulu untuk data mentah, lalu hitung dari hasilnya.`;
```

Create `apps/api/src/ai/tool-loop.ts`:
```ts
import type { GeminiClient } from "./gemini-client.js";
import type { GeminiPart } from "./gemini-types.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import type { ToolSpec } from "../providers/accounting/types.js";

export interface ToolLoopEvent {
  type: "start" | "tool_call" | "tool_result" | "text_delta" | "done" | "error";
  tool?: string;
  label?: string;
  ok?: boolean;
  delta?: string;
  message?: string;
}

export interface ToolLoopOpts {
  gemini: GeminiClient;
  providerExecute: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
  permissions: Set<string>;
  tools: ToolSpec[];
  userMessage: string;
  history?: GeminiPart[];
  onEvent: (e: ToolLoopEvent) => void;
  model?: string;
  maxSteps?: number;
  now?: () => number;
}

export async function runToolLoop(opts: ToolLoopOpts): Promise<{ text: string; trace: Array<Record<string, unknown>> }> {
  const maxSteps = opts.maxSteps ?? 8;
  const now = opts.now ?? Date.now;
  const deadline = now() + 60_000;
  const trace: Array<Record<string, unknown>> = [];
  const contents: GeminiPart[] = [...(opts.history ?? []), { text: opts.userMessage }];
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
      tools: [{ functionDeclarations: opts.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.jsonSchema })) }],
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

    contents.push(...res.parts);
    for (const call of calls) {
      const spec = opts.tools.find((t) => t.name === call.functionCall!.name);
      if (!spec) {
        trace.push({ tool: call.functionCall!.name, args: call.functionCall!.args, ok: false, reason: "unknown_tool" });
        contents.push({ functionResponse: { name: call.functionCall!.name, response: { error: "tool tidak dikenal" }, id: call.functionCall!.id } });
        continue;
      }
      opts.onEvent({ type: "tool_call", tool: spec.name, label: spec.label });
      if (!opts.permissions.has(spec.requiredPermission)) {
        trace.push({ tool: spec.name, args: call.functionCall!.args, ok: false, reason: "no_permission" });
        opts.onEvent({ type: "tool_result", tool: spec.name, ok: false });
        contents.push({ functionResponse: { name: spec.name, response: { error: `Anda tidak punya akses modul ${spec.requiredPermission}` }, id: call.functionCall!.id } });
        continue;
      }
      try {
        const result = await opts.providerExecute(spec.name, call.functionCall!.args);
        trace.push({ tool: spec.name, args: call.functionCall!.args, ok: true });
        opts.onEvent({ type: "tool_result", tool: spec.name, ok: true });
        contents.push({ functionResponse: { name: spec.name, response: result, id: call.functionCall!.id } });
      } catch (e) {
        trace.push({ tool: spec.name, args: call.functionCall!.args, ok: false, reason: "execute_error" });
        opts.onEvent({ type: "tool_result", tool: spec.name, ok: false });
        contents.push({ functionResponse: { name: spec.name, response: { error: e instanceof Error ? e.message : "gagal" }, id: call.functionCall!.id } });
      }
    }
  }
  const msg = "Terlalu banyak langkah — coba persempit pertanyaan Anda.";
  opts.onEvent({ type: "text_delta", delta: msg });
  return { text: msg, trace };
}
```

- [ ] **Step 4: PASS + commit**

Run: `pnpm test tool-loop` → 5/5 PASS; `pnpm typecheck` → 0.
```bash
git add apps/api/src/ai apps/api/test/tool-loop.test.ts
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase2): runToolLoop (permission gate, max 8, deadline) + fake gemini"
```

_(Task 4+ menyusul)_

---

### Task 4: Provider catalog + execute + refreshToken + privilegeCatalog (TDD vs mock)

**Files:**
- Modify: `apps/api/src/providers/accounting/types.ts`, `apps/api/src/providers/accounting/accurate.ts`
- Create: `apps/api/src/providers/accounting/catalog.ts`, `apps/api/test/accurate-execute.test.ts`

- [ ] **Step 1: extend types**

Edit `apps/api/src/providers/accounting/types.ts` — tambah di akhir:
```ts
export interface ToolSpec {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  requiredPermission: string;
  label: string;
}
export interface ProviderCtx {
  tenantId: string;
  host: string;
  session: string;
  accessToken: string;
}
export interface PrivilegeGroup {
  id: string;
  name: string;
  allowViewModules: string[];
}
```
Dan di interface `AccountingProvider` tambah method:
```ts
  capabilityCatalog(): ToolSpec[];
  execute(tool: string, args: Record<string, unknown>, ctx: ProviderCtx): Promise<unknown>;
  refreshToken(refreshToken: string): Promise<ProviderTokenSet>;
  privilegeCatalog(ctx: ProviderCtx): Promise<PrivilegeGroup[]>;
```
(Catatan: keputusan desain — kebijakan refresh (kapan) di-orkestrasi route "H-1 sebelum expired", adapter murni HTTP `refreshToken`; tetap memenuhi §4 token lifecycle.)

- [ ] **Step 2: catalog**

Create `apps/api/src/providers/accounting/catalog.ts`:
```ts
import type { ToolSpec } from "./types.js";

export const ACCURATE_CATALOG: ToolSpec[] = [
  {
    name: "customer.list",
    description: "Ambil daftar pelanggan (nama, id)",
    jsonSchema: { type: "object", properties: {} },
    requiredPermission: "accurate:customer.view",
    label: "Mengambil data pelanggan…",
  },
  {
    name: "salesEntry.list",
    description: "Ambil daftar transaksi penjualan (faktur): pelanggan, tanggal, total",
    jsonSchema: { type: "object", properties: {} },
    requiredPermission: "accurate:sales-entry.view",
    label: "Mengambil data penjualan…",
  },
];
```

- [ ] **Step 3: failing test execute**

Create `apps/api/test/accurate-execute.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp as createMockApp } from "@mock/accurate";
import { AccurateAdapter } from "../src/providers/accounting/accurate.js";
import type { ProviderCtx } from "../src/providers/accounting/types.js";

let server: Server;
let base: string;
let adapter: AccurateAdapter;
let adminCtx: ProviderCtx;
let staffCtx: ProviderCtx;

async function loginCtx(user: string, dbId: string): Promise<ProviderCtx> {
  const url = new URL(adapter.authorizeUrl({ redirectUri: "http://x/cb", state: "s" }));
  url.searchParams.set("user", user);
  const res = await fetch(url, { redirect: "manual" });
  const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
  const tok = await adapter.exchangeCode(code, "http://x/cb");
  const open = await adapter.openDb(tok.accessToken, dbId);
  return { tenantId: `t-${user}`, host: open.host, session: open.session, accessToken: tok.accessToken };
}

beforeAll(async () => {
  server = createMockApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  adapter = new AccurateAdapter({ clientId: "c", clientSecret: "s", apiBase: base });
  adminCtx = await loginCtx("admin", "1001");
  staffCtx = await loginCtx("staff", "1001");
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

describe("AccurateAdapter execute/refresh/privilege", () => {
  it("customer.list admin → data mock PT Maju Jaya", async () => {
    const d = (await adapter.execute("customer.list", {}, adminCtx)) as Array<{ name: string }>;
    expect(d.map((c) => c.name)).toContain("Budi Santoso");
  });

  it("salesEntry.list admin → ada transaksi total", async () => {
    const d = (await adapter.execute("salesEntry.list", {}, adminCtx)) as Array<{ total: number }>;
    expect(d.length).toBeGreaterThan(0);
    expect(typeof d[0].total).toBe("number");
  });

  it("staff tanpa hak customer → execute throw (provider gagal)", async () => {
    await expect(adapter.execute("customer.list", {}, staffCtx)).rejects.toThrow();
  });

  it("refreshToken → token baru berbeda", async () => {
    const url = new URL(adapter.authorizeUrl({ redirectUri: "http://x/cb", state: "s" }));
    url.searchParams.set("user", "admin");
    const res = await fetch(url, { redirect: "manual" });
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
    const tok = await adapter.exchangeCode(code, "http://x/cb");
    const refreshed = await adapter.refreshToken(tok.refreshToken);
    expect(refreshed.accessToken).not.toBe(tok.accessToken);
    expect(refreshed.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("privilegeCatalog → kelompok Administrator + Staff Penjualan; admin melihat modul view", async () => {
    const groups = await adapter.privilegeCatalog(adminCtx);
    const admin = groups.find((g) => g.id === "priv-admin")!;
    expect(admin.allowViewModules).toEqual(expect.arrayContaining(["customer", "sales-entry"]));
  });

  it("capabilityCatalog → 2 tool teranotasi permission", () => {
    const cat = adapter.capabilityCatalog();
    expect(cat.map((t) => t.name).sort()).toEqual(["customer.list", "salesEntry.list"]);
    expect(cat.every((t) => t.requiredPermission.startsWith("accurate:"))).toBe(true);
  });
});
```

- [ ] **Step 4: jalankan — FAIL**

Run: `pnpm test accurate-execute`. Expected: FAIL (method belum ada / tool tidak dikenal).

- [ ] **Step 5: implement di accurate.ts**

Edit `apps/api/src/providers/accounting/accurate.ts` — tambah import `ACCURATE_CATALOG` dari `./catalog.js` dan method-method berikut di kelas:
```ts
  capabilityCatalog() {
    return ACCURATE_CATALOG;
  }

  private async moduleGet(path: string, ctx: ProviderCtx): Promise<Envelope<unknown>> {
    const res = await fetch(`${ctx.host}${path}`, {
      headers: { Authorization: `Bearer ${ctx.accessToken}`, "X-Session-ID": ctx.session },
      redirect: "follow",
    });
    if (res.status === 401) throw new Error("sesi/token ditolak provider (401)");
    const j = (await res.json()) as Envelope<unknown>;
    if (!j.s) throw new Error(`provider gagal: ${JSON.stringify(j.d)}`);
    return j;
  }

  async execute(tool: string, _args: Record<string, unknown>, ctx: ProviderCtx): Promise<unknown> {
    const paths: Record<string, string> = {
      "customer.list": "/accurate/api/customer/list.do",
      "salesEntry.list": "/accurate/api/sales-entry/list.do",
    };
    const p = paths[tool];
    if (!p) throw new Error(`tool tidak dikenal: ${tool}`);
    const j = await this.moduleGet(p, ctx);
    return j.d;
  }

  async refreshToken(refreshToken: string): Promise<ProviderTokenSet> {
    return this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  async privilegeCatalog(ctx: ProviderCtx): Promise<PrivilegeGroup[]> {
    const list = await this.moduleGet("/accurate/api/access-privilege/list.do", ctx);
    const groups = (list.d as Array<{ id: string; name: string }>) ?? [];
    const out: PrivilegeGroup[] = [];
    for (const g of groups) {
      const detail = await this.moduleGet(`/accurate/api/access-privilege/detail.do?id=${encodeURIComponent(g.id)}`, ctx);
      const row = (detail.d as Array<{ Privilege: Array<{ ModuleName: string; AllowView: boolean }> }>)[0];
      out.push({
        id: g.id,
        name: g.name,
        allowViewModules: (row?.Privilege ?? []).filter((m) => m.AllowView).map((m) => m.ModuleName),
      });
    }
    return out;
  }
```
Tambah import di atas: `import { ACCURATE_CATALOG } from "./catalog.js";` dan ke type import tambahkan `PrivilegeGroup`.

- [ ] **Step 6: PASS + commit**

Run: `pnpm test accurate-execute` → 6/6 PASS; `pnpm test` → semua PASS; typecheck 0.
```bash
git add apps/api/src/providers apps/api/test/accurate-execute.test.ts
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase2): catalog+execute+refreshToken+privilegeCatalog pada AccurateAdapter"
```

---

### Task 5: Launch upgrade — simpan host+session & seed permission modul

**Files:**
- Modify: `apps/api/src/routes/launch.ts`, `apps/api/test/oauth-launch.test.ts`

- [ ] **Step 1: perluas test**

Edit `apps/api/test/oauth-launch.test.ts` — di test "callback penuh", tambah setelah `expect(me.body.tenant.provider).toBe("accurate")`:
```ts
    const conn = await prisma.connection.findFirst({ where: { tenantId: tenant!.id } });
    expect(conn!.host).toBe(mockBase);
    expect(conn!.session).toMatch(/^sess-/);
    const role = await prisma.role.findFirstOrThrow({ where: { tenantId: tenant!.id, key: "admin" } });
    const perms = await prisma.rolePermission.findMany({ where: { roleId: role.id } });
    expect(perms.map((p) => p.permissionKey)).toEqual(
      expect.arrayContaining(["accurate:customer.view", "accurate:sales-entry.view", "app:settings.manage"])
    );
```
Catatan: `tenant` dideklarasikan lebih awal — pindahkan `const tenant = await prisma.tenant.findFirst...` ke sebelum blok `conn` (atau deklarasikan ulang dengan `const tenant = ...` sebelumnya). Susunan akhir test: cookie/me → tenant → conn/host/session → role perms → count.

- [ ] **Step 2: implement di launch.ts**

Di callback, setelah `openDb`-belum ada — saat ini callback BELUM memanggil openDb. Tambahkan SETELAH `const db = ...`:
```ts
    const open = await provider.openDb(tok.accessToken, db.providerDbId);
```
Ganti upsert `connection` — create/update tambah field host & session:
```ts
      create: {
        tenantId: tenant.id, provider: "accurate",
        accessTokenEnc: encryptToken(tok.accessToken), refreshTokenEnc: encryptToken(tok.refreshToken),
        expiresAt: tok.expiresAt, host: open.host, session: open.session,
      },
      update: {
        accessTokenEnc: encryptToken(tok.accessToken), refreshTokenEnc: encryptToken(tok.refreshToken),
        expiresAt: tok.expiresAt, status: "connected", host: open.host, session: open.session,
      },
```
Setelah upsert connection, seeding permission modul:
```ts
    if (db.admin) {
      const modulPerms = accurateProvider()
        .capabilityCatalog()
        .map((t) => t.requiredPermission);
      await prisma.rolePermission.createMany({
        data: modulPerms.map((permissionKey) => ({ roleId: role.id, permissionKey })),
        skipDuplicates: true,
      });
    }
```
(Tahap admin-only; non-admin = fallback spek: tanpa modul sampai editor role Fase 4.)

- [ ] **Step 3: PASS + commit**

Run: `pnpm test oauth-launch` → PASS; full `pnpm test` PASS; typecheck 0.
```bash
git add apps/api/src/routes/launch.ts apps/api/test/oauth-launch.test.ts
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase2): launch simpan host+session & seed permission modul admin"
```

_(Task 6+ menyusul)_

---

### Task 6: Chat persistence + stream endpoint (TDD, fake gemini)

**Files:**
- Create: `apps/api/src/permissions.ts`, `apps/api/src/audit.ts`, `apps/api/src/routes/chat.ts`, `apps/api/test/chat-stream.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: permissions + audit helpers**

Create `apps/api/src/permissions.ts`:
```ts
import { prisma } from "./db.js";

export async function loadPermissionSet(roleId: string): Promise<Set<string>> {
  const rows = await prisma.rolePermission.findMany({ where: { roleId } });
  return new Set(rows.map((r) => r.permissionKey));
}
```

Create `apps/api/src/audit.ts`:
```ts
import { prisma } from "./db.js";

export async function writeAudit(tenantId: string, userId: string, action: string, detail: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: { tenantId, userId, action, detail: JSON.stringify(detail) },
  });
}
```

- [ ] **Step 2: failing test stream**

Create `apps/api/test/chat-stream.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { createApp as createMockApp } from "@mock/accurate";
import { prisma } from "../src/db.js";

let api: ReturnType<typeof createApp>;
let mockSrv: Server;
let mockBase: string;
let cookie = "";
let tenantId = "";
let userId = "";

beforeAll(async () => {
  mockSrv = createMockApp().listen(0);
  await new Promise((r) => mockSrv.once("listening", r));
  mockBase = `http://127.0.0.1:${(mockSrv.address() as { port: number }).port}`;
  process.env.MOCK_ACCURATE_URL = mockBase;
  api = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `c-${randomBytes(4).toString("hex")}`, name: "PT Chat", alias: "CHAT" },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({ data: { tenantId: tenant.id, key: "admin", name: "Admin" } });
  await prisma.rolePermission.createMany({
    data: ["accurate:customer.view", "accurate:sales-entry.view"].map((permissionKey) => ({ roleId: role.id, permissionKey })),
  });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, providerUserId: `cu-${randomBytes(4).toString("hex")}`, email: "chat@demo.local", name: "Chat", roleId: role.id },
  });
  userId = user.id;
  // koneksi lengkap (hasil launch) ke mock db 1001
  const url = new URL(`http://x/oauth/authorize`);
  void url;
  const auth = await fetch(`${mockBase}/oauth/authorize?redirect_uri=${encodeURIComponent("http://x/cb")}&user=admin`, { redirect: "manual" });
  const code = new URL(auth.headers.get("location")!).searchParams.get("code")!;
  const tokRes = await fetch(`${mockBase}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: "http://x/cb", client_id: "c", client_secret: "s" }),
  });
  const tok = (await tokRes.json()) as { access_token: string; refresh_token: string; expires_in: number };
  const open = (await (await fetch(`${mockBase}/api/open-db.do?id=1001`, { headers: { Authorization: `Bearer ${tok.access_token}` } })).json()) as { session: string; host: string };
  const { encryptToken } = await import("../src/crypto.js");
  await prisma.connection.create({
    data: {
      tenantId: tenant.id, provider: "accurate",
      accessTokenEnc: encryptToken(tok.access_token), refreshTokenEnc: encryptToken(tok.refresh_token),
      expiresAt: new Date(Date.now() + tok.expires_in * 1000),
      host: open.host, session: open.session,
    },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86400_000) } });
  cookie = `sid=${sid}`;
});

afterAll(async () => {
  mockSrv.closeAllConnections();
  await new Promise((r) => mockSrv.close(r));
  await prisma.$disconnect();
});

function parseNdjson(body: string): Array<Record<string, unknown>> {
  return body
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("chat stream", () => {
  it("tanpa login → 401", async () => {
    expect((await request(api).post("/api/chat/stream").send({ message: "hi" })).status).toBe(401);
  });

  it("teks polos (fake gemini) → NDJSON start + text_delta + done; pesan tersimpan", async () => {
    const { FakeGeminiClient } = await import("../src/ai/fake-gemini.js");
    const { setGeminiForTest } = await import("../src/ai/gemini-client.js");
    setGeminiForTest(() => new FakeGeminiClient([{ parts: [{ text: "Halo!" }] }]));
    const res = await request(api).post("/api/chat/stream").set("Cookie", cookie).send({ message: "halo" }).buffer(true).parse((r, cb) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => cb(null, d));
    });
    const events = parseNdjson(res.body as string);
    expect(events[0].type).toBe("start");
    expect(events.some((e) => e.type === "text_delta" && e.delta === "Halo!")).toBe(true);
    expect(events.at(-1)!.type).toBe("done");
    const sess = await prisma.chatSession.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
    expect(sess).toBeTruthy();
    const msgs = await prisma.chatMessage.findMany({ where: { sessionId: sess!.id }, orderBy: { createdAt: "asc" } });
    expect(msgs.map((m) => m.role)).toEqual(["user", "ai"]);
  });

  it("tool call (fake) → event tool_call + baris audit + toolTrace tersimpan", async () => {
    const { FakeGeminiClient } = await import("../src/ai/fake-gemini.js");
    const { setGeminiForTest } = await import("../src/ai/gemini-client.js");
    setGeminiForTest(
      () =>
        new FakeGeminiClient([
          { parts: [{ functionCall: { name: "customer.list", args: {}, id: "c1" } }] },
          { parts: [{ text: "Ada pelanggan Budi." }] },
        ])
    );
    const res = await request(api).post("/api/chat/stream").set("Cookie", cookie).send({ message: "siapa pelanggan saya?" }).buffer(true).parse((r, cb) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => cb(null, d));
    });
    const events = parseNdjson(res.body as string);
    expect(events.some((e) => e.type === "tool_call" && e.tool === "customer.list")).toBe(true);
    expect(events.some((e) => e.type === "tool_result" && e.ok === true)).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { tenantId, action: "tool.call" }, orderBy: { createdAt: "desc" } });
    expect(audit).toBeTruthy();
    expect(audit!.detail).toContain("customer.list");
    const sess = await prisma.chatSession.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
    const lastAi = await prisma.chatMessage.findFirst({ where: { sessionId: sess!.id, role: "ai" }, orderBy: { createdAt: "desc" } });
    expect(lastAi!.toolTrace).toContain("customer.list");
  });

  it("GET /api/chat/sessions → daftar sesi tenant sendiri", async () => {
    const res = await request(api).get("/api/chat/sessions").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("GET messages sesi → urutan user/ai", async () => {
    const list = await request(api).get("/api/chat/sessions").set("Cookie", cookie);
    const id = list.body[0].id as string;
    const res = await request(api).get(`/api/chat/sessions/${id}/messages`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: jalankan — FAIL**

Run: `pnpm test chat-stream`. Expected: FAIL (rute belum ada).

- [ ] **Step 4: Gemini factory dengan hook test**

Edit `apps/api/src/ai/gemini-client.ts` — tambah di bawah class:
```ts
import { env } from "../env.js";

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
```
(Lihat catatan: `env` diimpor untuk GEMINI_MODEL di generate — boleh dipakai `env.GEMINI_MODEL` di `envModel()`: ganti isi `envModel()` menjadi `return env.GEMINI_MODEL;`.)

- [ ] **Step 5: implement routes/chat.ts**

Create `apps/api/src/routes/chat.ts`:
```ts
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { decryptToken } from "../crypto.js";
import { geminiClient } from "../ai/gemini-client.js";
import { runToolLoop } from "../ai/tool-loop.js";
import { loadPermissionSet } from "../permissions.js";
import { writeAudit } from "../audit.js";
import { accurateProvider } from "../providers/accounting/index.js";
import type { ProviderTokenSet } from "../providers/accounting/types.js";
import { z } from "zod";

export const chatRouter = Router();

chatRouter.get("/chat/sessions", requireUser, asyncHandler(async (req, res) => {
  const sessions = await prisma.chatSession.findMany({
    where: { tenantId: req.user!.tenant.id, userId: req.user!.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, title: true, createdAt: true },
  });
  res.json(sessions);
}));

chatRouter.get("/chat/sessions/:id/messages", requireUser, asyncHandler(async (req, res) => {
  const sess = await prisma.chatSession.findFirst({
    where: { id: req.params.id, tenantId: req.user!.tenant.id, userId: req.user!.id },
  });
  if (!sess) return res.status(404).json({ error: "tidak_ditemukan" });
  const msgs = await prisma.chatMessage.findMany({
    where: { sessionId: sess.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, createdAt: true },
  });
  res.json(msgs);
}));

async function ensureConnection(tenantId: string) {
  const conn = await prisma.connection.findUnique({
    where: { tenantId_provider: { tenantId, provider: "accurate" } },
  });
  if (!conn) return null;
  let accessToken = decryptToken(conn.accessTokenEnc);
  let host = conn.host;
  let session = conn.session;
  const provider = accurateProvider();
  if (conn.expiresAt.getTime() - Date.now() < 24 * 3600_000) {
    try {
      const fresh: ProviderTokenSet = await provider.refreshToken(decryptToken(conn.refreshTokenEnc));
      accessToken = fresh.accessToken;
      await prisma.connection.update({
        where: { id: conn.id },
        data: {
          accessTokenEnc: (await import("../crypto.js")).encryptToken(fresh.accessToken),
          refreshTokenEnc: (await import("../crypto.js")).encryptToken(fresh.refreshToken),
          expiresAt: fresh.expiresAt,
        },
      });
    } catch {
      await prisma.connection.update({ where: { id: conn.id }, data: { status: "expired" } });
      return null;
    }
  }
  if (!host || !session) {
    const dbs = await provider.listDbs(accessToken);
    const open = await provider.openDb(accessToken, dbs[0]?.providerDbId ?? "");
    host = open.host;
    session = open.session;
    await prisma.connection.update({ where: { id: conn.id }, data: { host, session } });
  }
  return { tenantId, host, session, accessToken };
}

chatRouter.post("/chat/stream", requireUser, asyncHandler(async (req, res) => {
  const body = z.object({ message: z.string().min(1).max(4000), sessionId: z.string().optional() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "bad_request" });
  const user = req.user!;

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  const send = (e: Record<string, unknown>) => res.write(JSON.stringify(e) + "\n");

  let session = body.data.sessionId
    ? await prisma.chatSession.findFirst({ where: { id: body.data.sessionId, tenantId: user.tenant.id, userId: user.id } })
    : null;
  if (!session) {
    session = await prisma.chatSession.create({
      data: { tenantId: user.tenant.id, userId: user.id, title: body.data.message.slice(0, 60) },
    });
  }
  await prisma.chatMessage.create({ data: { sessionId: session.id, role: "user", content: body.data.message } });

  const ctx = await ensureConnection(user.tenant.id);
  const permissions = await loadPermissionSet(user.roleKey === "admin" || user.roleKey === "staff" ? (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).roleId : "");
  const provider = accurateProvider();
  const tools = provider.capabilityCatalog();

  try {
    const out = await runToolLoop({
      gemini: geminiClient(),
      providerExecute: (tool, args) => {
        if (!ctx) return Promise.reject(new Error("koneksi Accurate belum aktif — hubungkan ulang di Pengaturan"));
        return provider.execute(tool, args, ctx);
      },
      permissions,
      tools,
      userMessage: body.data.message,
      onEvent: (e) => send(e as Record<string, unknown>),
      model: env.GEMINI_MODEL,
    });
    for (const t of out.trace) {
      if (t.tool) void writeAudit(user.tenant.id, user.id, "tool.call", t);
    }
    const aiMsg = await prisma.chatMessage.create({
      data: { sessionId: session.id, role: "ai", content: out.text, toolTrace: JSON.stringify(out.trace) },
    });
    send({ type: "done", messageId: aiMsg.id });
  } catch (e) {
    const msg = e instanceof Error && /503|GEMINI/i.test(e.message)
      ? "Layanan AI sedang tidak tersedia — coba lagi sebentar."
      : "Terjadi gangguan — coba lagi.";
    send({ type: "error", message: msg });
  }
  res.end();
}));
```
(Catatan implementasi: agar rapi, di awal handler ambil `const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });` lalu `permissions = await loadPermissionSet(dbUser.roleId);` — ganti baris permissions yang bertele-tele di atas.)

- [ ] **Step 6: mount di app.ts**

Tambah import `chatRouter` + `app.use("/api", chatRouter);` setelah googleRouter.

- [ ] **Step 7: PASS + commit**

Run: `pnpm test chat-stream` → PASS semua; full suite PASS; typecheck 0.
```bash
git add apps/api/src apps/api/test/chat-stream.test.ts
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase2): endpoint chat NDJSON + riwayat + audit tool call"
```

---

### Task 7: Isolasi multi-tenant (wajib gagal bila bocor)

**Files:**
- Create: `apps/api/test/chat-isolation.test.ts`

- [ ] **Step 1: test**

Create `apps/api/test/chat-isolation.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

let api: ReturnType<typeof createApp>;
let cookieA = "";
let cookieB = "";
let sessionA = "";

async function mk(prefix: string): Promise<{ cookie: string; tenantId: string }> {
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `${prefix}-${randomBytes(3).toString("hex")}`, name: `PT ${prefix}`, alias: prefix },
  });
  const role = await prisma.role.create({ data: { tenantId: tenant.id, key: "admin", name: "Admin" } });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, providerUserId: `${prefix}-${randomBytes(3).toString("hex")}`, email: `${prefix}@demo.local`, name: prefix, roleId: role.id },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86400_000) } });
  return { cookie: `sid=${sid}`, tenantId: tenant.id };
}

beforeAll(async () => {
  api = createApp();
  const a = await mk("isoA");
  const b = await mk("isoB");
  cookieA = a.cookie;
  cookieB = b.cookie;
  const s = await prisma.chatSession.create({ data: { tenantId: a.tenantId, userId: (await prisma.user.findFirstOrThrow({ where: { tenantId: a.tenantId } })).id, title: "rahasia A" } });
  sessionA = s.id;
  await prisma.chatMessage.create({ data: { sessionId: s.id, role: "ai", content: "JAWABAN RAHASIA A" } });
});
afterAll(() => prisma.$disconnect());

describe("isolasi tenant chat", () => {
  it("sesi milik A tidak terbaca oleh B (404)", async () => {
    const res = await request(api).get(`/api/chat/sessions/${sessionA}/messages`).set("Cookie", cookieB);
    expect(res.status).toBe(404);
  });

  it("daftar sesi B tidak memuat sesi A", async () => {
    const res = await request(api).get("/api/chat/sessions").set("Cookie", cookieB);
    expect(res.body.map((s: { id: string }) => s.id)).not.toContain(sessionA);
  });

  it("audit log A tidak terlihat (endpoint tidak ada — kolom tenantId wajib terisi)", async () => {
    const a = await prisma.auditLog.create({ data: { tenantId: (await prisma.tenant.findFirstOrThrow({ where: { alias: "isoA" } })).id, userId: "u", action: "tool.call", detail: "{}" } });
    const leak = await prisma.auditLog.findMany({ where: { id: a.id, NOT: { tenantId: { contains: "isoB" } } } });
    expect(leak).toHaveLength(1);
  });
});
```

- [ ] **Step 2: jalankan — PASS langsung (defensif by query)**

Run: `pnpm test chat-isolation` → 3/3 PASS. Bila gagal = BOCOR, perbaiki rute.
Commit:
```bash
git add apps/api/test/chat-isolation.test.ts
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase2): uji isolasi multi-tenant chat"
```

_(Task 8+ menyusul)_

---

### Task 8: Integration Gemini ASLI + mock Accurate

**Files:**
- Create: `apps/api/test/chat-gemini-live.test.ts`

- [ ] **Step 1: test (skip/retry saat outage)**

Create `apps/api/test/chat-gemini-live.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { createApp as createMockApp } from "@mock/accurate";
import { prisma } from "../src/db.js";
import { setGeminiForTest } from "../src/ai/gemini-client.js";

const keyOk = (process.env.GEMINI_API_KEY?.length ?? 0) > 10;
let api: ReturnType<typeof createApp>;
let mockSrv: Server;
let cookie = "";
let outage = false;

beforeAll(async () => {
  setGeminiForTest(null); // pakai client ASLI
  mockSrv = createMockApp().listen(0);
  await new Promise((r) => mockSrv.once("listening", r));
  const mockBase = `http://127.0.0.1:${(mockSrv.address() as { port: number }).port}`;
  process.env.MOCK_ACCURATE_URL = mockBase;
  api = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `live-${randomBytes(4).toString("hex")}`, name: "PT Live", alias: "LIVE" },
  });
  const role = await prisma.role.create({ data: { tenantId: tenant.id, key: "admin", name: "Admin" } });
  await prisma.rolePermission.createMany({
    data: ["accurate:customer.view", "accurate:sales-entry.view"].map((permissionKey) => ({ roleId: role.id, permissionKey })),
  });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, providerUserId: `lu-${randomBytes(4).toString("hex")}`, email: "live@demo.local", name: "Live", roleId: role.id },
  });
  const auth = await fetch(`${mockBase}/oauth/authorize?redirect_uri=${encodeURIComponent("http://x/cb")}&user=admin`, { redirect: "manual" });
  const code = new URL(auth.headers.get("location")!).searchParams.get("code")!;
  const tokRes = await fetch(`${mockBase}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: "http://x/cb", client_id: "c", client_secret: "s" }),
  });
  const tok = (await tokRes.json()) as { access_token: string; refresh_token: string; expires_in: number };
  const open = (await (await fetch(`${mockBase}/api/open-db.do?id=1001`, { headers: { Authorization: `Bearer ${tok.access_token}` } })).json()) as { session: string; host: string };
  const { encryptToken } = await import("../src/crypto.js");
  await prisma.connection.create({
    data: {
      tenantId: tenant.id, provider: "accurate",
      accessTokenEnc: encryptToken(tok.access_token), refreshTokenEnc: encryptToken(tok.refresh_token),
      expiresAt: new Date(Date.now() + tok.expires_in * 1000), host: open.host, session: open.session,
    },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86400_000) } });
  cookie = `sid=${sid}`;
}, 60000);

afterAll(async () => {
  setGeminiForTest(null);
  mockSrv.closeAllConnections();
  await new Promise((r) => mockSrv.close(r));
  await prisma.$disconnect();
});

describe.skipIf(!keyOk)("chat dengan Gemini asli + mock Accurate", () => {
  it("pertanyaan BI 'siapa saja pelanggan saya?' → tool_call customer.list + jawaban menyebut data", async () => {
    let last = "";
    for (let attempt = 0; attempt < 3 && !outage; attempt++) {
      const res = await request(api)
        .post("/api/chat/stream")
        .set("Cookie", cookie)
        .send({ message: "Sebutkan nama pelanggan yang ada di data saya." })
        .buffer(true)
        .parse((r, cb) => {
          let d = "";
          r.on("data", (c) => (d += c));
          r.on("end", () => cb(null, d));
        });
      last = res.body as string;
      if (last.includes('"tool_call"') || last.includes("Budi")) break;
      if (last.includes("tidak tersedia") || last.includes("gangguan")) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (last.includes("tidak tersedia") || last === "") {
      outage = true;
      console.warn("Gemini outage — integration test di-skip");
      return;
    }
    expect(last).toContain("customer.list");
    expect(last.toLowerCase()).toContain("budi");
  }, 120000);
});
```

- [ ] **Step 2: jalankan (butuh key valid + network)**

Run: `pnpm test chat-gemini-live`. Expected: PASS (tool dipanggil, jawaban menyebut "Budi"); bila outage → log skip, bukan gagal.
Commit:
```bash
git add apps/api/test/chat-gemini-live.test.ts
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase2): integration chat Gemini asli + mock Accurate"
```

---

### Task 9: Endpoint STT + TTS (Gemini asli)

**Files:**
- Create: `apps/api/src/routes/audio.ts`, `apps/api/test/audio-real.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: failing test**

Create `apps/api/test/audio-real.test.ts`:
```ts
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { readFileSync } from "node:fs";

const keyOk = (process.env.GEMINI_API_KEY?.length ?? 0) > 10;
const api = createApp();
afterAll(() => import("../src/db.js").then((m) => m.prisma.$disconnect()));

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw last;
}

describe.skipIf(!keyOk)("audio Gemini asli", () => {
  it("POST /api/stt wav senyap → teks kosong (tidak mengarang)", async () => {
    const wav = readFileSync("/tmp/opencode/silence.wav");
    const res = await withRetry(() =>
      request(api).post("/api/stt").set("Content-Type", "audio/wav").send(wav).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
    );
    expect(res.status).toBe(200);
    const body = JSON.parse((res.body as Buffer).toString());
    expect(typeof body.text).toBe("string");
    expect(body.text.trim()).toBe("");
  }, 90000);

  it("POST /api/tts → audio/wav bytes", async () => {
    const res = await withRetry(() =>
      request(api).post("/api/tts").send({ text: "Halo, ini uji suara." }).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("audio/wav");
    expect((res.body as Buffer).length).toBeGreaterThan(1000);
  }, 90000);
});
```
Catatan: siapkan wav senyap sekali di lingkungan: `python3 -c "import wave; w=wave.open('/tmp/opencode/silence.wav','w'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(b'\x00\x00'*8000)"` (sudah ada dari spike).

- [ ] **Step 2: jalankan — FAIL**

Run: `pnpm test audio-real`. Expected: FAIL (rute belum ada).

- [ ] **Step 3: implement**

Create `apps/api/src/routes/audio.ts`:
```ts
import { Router } from "express";
import { env } from "../env.js";
import { asyncHandler } from "../asyncHandler.js";
import { geminiClient } from "../ai/gemini-client.js";
import { RealGeminiClient, GeminiHttpError } from "../ai/gemini-client.js";

export const audioRouter = Router();

function real(): RealGeminiClient {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.length < 10) {
    throw new GeminiHttpError(503, "GEMINI_API_KEY belum diisi/tidak valid");
  }
  return new RealGeminiClient(process.env.GEMINI_API_KEY);
}

audioRouter.post("/stt", asyncHandler(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req as AsyncIterable<Buffer>) chunks.push(c);
  const audio = Buffer.concat(chunks);
  if (audio.length === 0) return res.status(400).json({ error: "audio kosong" });
  const mime = String(req.headers["content-type"] ?? "audio/webm").split(";")[0];
  const client = real();
  const gen = client.generateStream({
    contents: [{ inlineData: { mimeType: mime, data: audio.toString("base64") } }, { text: "Transkrip audio ini persis, tanpa tambahan. Bila hening, balas kosong." }],
    model: env.GEMINI_TRANSCRIBE_MODEL,
  });
  let text = "";
  for await (const p of gen) if (p.text) text += p.text;
  res.json({ text: text.trim() });
}));

audioRouter.post("/tts", asyncHandler(async (req, res) => {
  const body = req.body as { text?: string };
  if (!body?.text || typeof body.text !== "string" || body.text.length === 0 || body.text.length > 2000) {
    return res.status(400).json({ error: "bad_request" });
  }
  const client = real();
  const { parts } = await client.generate({
    contents: [{ text: body.text }],
    responseModalities: ["AUDIO"],
    model: env.GEMINI_TTS_MODEL,
  });
  const audio = parts.find((p) => p.inlineData?.mimeType.startsWith("audio/"));
  if (!audio?.inlineData) throw new Error("tts tidak mengembalikan audio");
  const buf = Buffer.from(audio.inlineData.data, "base64");
  res.setHeader("Content-Type", audio.inlineData.mimeType || "audio/wav");
  res.send(buf);
}));
```
Mount: `app.use("/api", audioRouter);` di app.ts (setelah chatRouter). Import tidak perlu `geminiClient` di file ini — hapus bila unused (typecheck).

- [ ] **Step 4: PASS + commit**

Run: `pnpm test audio-real` → PASS; full suite PASS; typecheck 0.
```bash
git add apps/api/src/routes/audio.ts apps/api/src/app.ts apps/api/test/audio-real.test.ts
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase2): endpoint STT (transcribe) + TTS (wav) Gemini"
```

_(Task 10+ menyusul)_

---

### Task 10: UI Chat (streaming, badge, riwayat, error state)

**Files:**
- Create: `apps/web/src/pages/Chat.tsx`, `apps/web/src/chat-api.ts`
- Modify: `apps/web/src/pages/Shell.tsx`

- [ ] **Step 1: chat-api (NDJSON client)**

Create `apps/web/src/chat-api.ts`:
```ts
export type ChatEvent =
  | { type: "start" }
  | { type: "tool_call"; tool: string; label?: string }
  | { type: "tool_result"; tool: string; ok: boolean }
  | { type: "text_delta"; delta: string }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

export interface SessionInfo {
  id: string;
  title: string;
  createdAt: string;
}
export interface MessageInfo {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export async function listSessions(): Promise<SessionInfo[]> {
  const res = await fetch("/api/chat/sessions");
  return res.ok ? res.json() : [];
}

export async function listMessages(sessionId: string): Promise<MessageInfo[]> {
  const res = await fetch(`/api/chat/sessions/${sessionId}/messages`);
  return res.ok ? res.json() : [];
}

export async function streamChat(
  message: string,
  sessionId: string | null,
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }),
    signal,
  });
  if (!res.ok || !res.body) {
    onEvent({ type: "error", message: res.status === 401 ? "Sesi berakhir — buka ulang dari Accurate." : "Gagal mengirim pesan." });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line) as ChatEvent);
      } catch {
        /* baris belum utuh */
      }
    }
  }
}
```

- [ ] **Step 2: Chat.tsx**

Create `apps/web/src/pages/Chat.tsx` (placeholder penuh — UI Soft Utility radius 4–6, palet warm gray/sage):
```tsx
import { useEffect, useRef, useState } from "react";
import type { MessageInfo, SessionInfo } from "../chat-api";
import { listMessages, listSessions, streamChat } from "../chat-api";

interface UiMsg {
  role: "user" | "ai";
  content: string;
  badges: string[];
}

const SUGGESTED = ["Berapa total penjualan bulan ini?", "Siapa saja pelanggan saya?", "Rincikan penjualan per pelanggan"];

export function Chat() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<UiMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void listSessions().then(setSessions);
  }, []);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function openSession(id: string) {
    setSessionId(id);
    setError(null);
    const history = await listMessages(id);
    setMsgs(history.map((m) => ({ role: m.role as "user" | "ai", content: m.content, badges: [] })));
  }

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setMsgs((m) => [...m, { role: "user", content: text, badges: [] }, { role: "ai", content: "", badges: [] }]);
    setInput("");
    try {
      await streamChat(text, sessionId, (e) => {
        setMsgs((m) => {
          const copy = [...m];
          const last = { ...copy[copy.length - 1] };
          if (e.type === "tool_call") last.badges = [...last.badges, e.label ?? e.tool];
          if (e.type === "tool_result" && !e.ok) last.badges = [...last.badges, "Ditolak/gagal"];
          if (e.type === "text_delta") last.content += e.delta;
          if (e.type === "error") setError(e.message);
          copy[copy.length - 1] = last;
          return copy;
        });
        if (e.type === "done") {
          setBusy(false);
          void listSessions().then(setSessions);
        }
      });
    } catch {
      setError("Koneksi terputus — coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 16, maxWidth: 960, margin: "0 auto", padding: 16, fontFamily: "system-ui" }}>
      <aside style={{ width: 200, flexShrink: 0 }}>
        <button style={btn} onClick={() => { setSessionId(null); setMsgs([]); }}>+ Percakapan baru</button>
        <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
          {sessions.map((s) => (
            <li key={s.id}>
              <button style={{ ...btn, background: sessionId === s.id ? "#3d6b54" : "#eeeae3", color: sessionId === s.id ? "#fff" : "#333", width: "100%", textAlign: "left", marginBottom: 6 }} onClick={() => void openSession(s.id)}>
                {s.title.slice(0, 28)}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 420 }}>
        <div style={{ flex: 1, background: "#faf8f5", border: "1px solid #e3ddd4", borderRadius: 6, padding: 16, overflowY: "auto" }}>
          {msgs.length === 0 && (
            <div>
              <p style={{ color: "#555" }}>Tanya data akuntansi Anda — ketik atau pakai mic.</p>
              {SUGGESTED.map((s) => (
                <button key={s} style={{ ...btn, background: "#eeeae3", color: "#333", marginRight: 8, marginBottom: 8 }} onClick={() => void send(s)}>{s}</button>
              ))}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <strong style={{ color: m.role === "user" ? "#3d6b54" : "#333" }}>{m.role === "user" ? "Anda" : "AI"}</strong>
              {m.badges.map((b, bi) => (
                <span key={bi} style={{ marginLeft: 8, fontSize: 12, background: "#e8efe9", borderRadius: 4, padding: "2px 8px", color: "#3d6b54" }}>{b}</span>
              ))}
              <div style={{ whiteSpace: "pre-wrap", color: "#222" }}>{m.content}{busy && i === msgs.length - 1 ? " ▌" : ""}</div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        {error && <div style={{ color: "#a33", marginTop: 8 }}>{error} — <button style={{ border: "none", background: "none", color: "#3d6b54", cursor: "pointer" }} onClick={() => void send(input || msgs[msgs.length - 2]?.content ?? "")}>Coba lagi</button></div>}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input style={{ flex: 1, padding: 10, borderRadius: 4, border: "1px solid #e3ddd4" }} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void send(input)} placeholder="Tanya sesuatu…" />
          <MicButton onText={(t) => void send(t)} disabled={busy} />
          <button style={btn} onClick={() => void send(input)} disabled={busy}>{busy ? "…" : "Kirim"}</button>
        </div>
      </section>
    </div>
  );
}

const btn: React.CSSProperties = { border: "none", borderRadius: 4, padding: "8px 12px", cursor: "pointer", background: "#3d6b54", color: "white", fontSize: 14 };

import { MicButton } from "../voice";
```
(Catatan: pindahkan `import { MicButton } from "../voice";` ke baris import teratas saat implementasi — jangan di bawah file.)

- [ ] **Step 3: Shell wrap Chat**

Replace `apps/web/src/pages/Shell.tsx`:
```tsx
import { useEffect, useState } from "react";
import type { Me } from "@aigoogle/shared";
import { getMe } from "../api";
import { Chat } from "./Chat";

export function Shell() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    void getMe().then(setMe);
  }, []);
  if (me === undefined) return <p style={{ padding: 24 }}>Memuat…</p>;
  if (me === null) {
    window.location.href = "/";
    return null;
  }
  return (
    <div style={{ fontFamily: "system-ui" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #e3ddd4", background: "#faf8f5" }}>
        <strong style={{ color: "#3d6b54" }}>{me.tenant.name}</strong>
        <span style={{ fontSize: 13, color: "#666" }}>{me.name} · {me.roleKey} · <a href="/settings" style={{ color: "#3d6b54" }}>Pengaturan</a></span>
      </header>
      <Chat />
    </div>
  );
}
```

- [ ] **Step 4: build + commit**

Run: `pnpm build` (apps/web) → ✓; `pnpm typecheck` root → 0. (MicButton di Task 11 — sementara buat stub dulu di Task 10 agar build hijau: lihat Task 11 Step 1 yang juga menulis `voice.ts` penuh; BILA mengerjakan berurutan, kerjakan Task 11 Step 1 voice.ts SEBELUM build Task 10.)
```bash
git add apps/web/src
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase2): UI chat streaming + badge tool + riwayat"
```

---

### Task 11: Voice wiring (web-speech + gemini-native)

**Files:**
- Create: `apps/web/src/voice.ts`
- Modify: `apps/web/src/pages/Chat.tsx` (terima props engine dari /api/settings)

- [ ] **Step 1: voice.ts**

Create `apps/web/src/voice.ts`:
```tsx
import { useState } from "react";
import { getSettings } from "./api";

export async function sttGemini(audio: Blob): Promise<string> {
  const res = await fetch("/api/stt", { method: "POST", body: audio });
  if (!res.ok) throw new Error("gagal transkripsi");
  const j = (await res.json()) as { text: string };
  return j.text;
}

export async function ttsGemini(text: string): Promise<void> {
  const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error("gagal sintesis suara");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  await audio.play();
}

export function speakWeb(text: string): void {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "id-ID";
  window.speechSynthesis.speak(u);
}

export function MicButton({ onText, disabled }: { onText: (t: string) => void; disabled?: boolean }) {
  const [listening, setListening] = useState(false);

  async function click() {
    if (listening) return;
    const settings = await getSettings();
    setListening(true);
    try {
      if (settings.voiceEngine === "web-speech") {
        const SR = (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognition }).webkitSpeechRecognition;
        if (!SR) {
          alert("Browser ini belum mendukung Web Speech — coba Chrome/Edge.");
          return;
        }
        const rec = new SR();
        rec.lang = "id-ID";
        const text = await new Promise<string>((resolve, reject) => {
          rec.onresult = (e) => resolve(e.results[0][0].transcript);
          rec.onerror = () => reject(new Error("stt gagal"));
          rec.start();
        });
        onText(text);
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
        const chunks: BlobPart[] = [];
        rec.ondataavailable = (e) => chunks.push(e.data);
        const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
        rec.start();
        alert("Bicara sekarang… OK untuk berhenti.");
        rec.stop();
        await done;
        stream.getTracks().forEach((t) => t.stop());
        const text = await sttGemini(new Blob(chunks, { type: "audio/webm" }));
        onText(text);
      }
    } finally {
      setListening(false);
    }
  }

  return (
    <button style={{ border: "none", borderRadius: 4, padding: "8px 12px", cursor: "pointer", background: listening ? "#a33" : "#eeeae3", fontSize: 14 }} onClick={() => void click()} disabled={disabled} aria-label="Rekam suara">
      {listening ? "●…" : "🎤"}
    </button>
  );
}
```
Catatan tipe `SpeechRecognition`: tambahkan di `apps/web/src/web-types.d.ts`:
```ts
declare interface SpeechRecognition {
  lang: string;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  start(): void;
}
```
Dan `getSettings` sudah ada di `api.ts`.

- [ ] **Step 2: auto-TTS jawaban (gemini-native)**

Di `Chat.tsx`, setelah `e.type === "done"` di dalam loop… — praktis: saat `streamChat` selesai dan engine gemini-native, panggil `ttsGemini(lastAiText)`:
```tsx
    const settings = await getSettings();
    const lastAi = /* ambil teks ai terakhir dari closure msgs terbaru */;
    if (settings.voiceEngine === "gemini-native" && lastAi) void ttsGemini(lastAi).catch(() => {});
```
Implementasi praktis: ubah `send()` — kumpulkan teks AI lokal (`aiText` variabel di closure `onEvent`), setelah `await streamChat(...)` selesai:
```tsx
    let aiText = "";
    await streamChat(text, sessionId, (e) => { if (e.type === "text_delta") aiText += e.delta; /* ...handler existing... */ });
    const settings = await getSettings();
    if (settings.voiceEngine === "gemini-native" && aiText) void ttsGemini(aiText).catch(() => {});
```

- [ ] **Step 3: build + commit**

`pnpm build` (web) ✓; `pnpm typecheck` root 0.
```bash
git add apps/web/src
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase2): voice wiring web-speech + gemini-native (stt/tts)"
```

---

### Task 12: Smoke e2e lokal + README + verifikasi akhir

**Files:**
- Create: `docs/spikes/2026-10-10-phase2-chat-check.md`
- Modify: `README.md`

- [ ] **Step 1: skrip smoke (3 proses + chat asli)**

Sama pola Fase 1 (`/tmp/opencode/e2e-smoke-phase2.sh`): start mock :4010, API (MOCK_ACCURATE_URL), web :5173. Lalu:
1. Flow launch lengkap → sid cookie (salin dari skrip Fase 1).
2. `POST /api/chat/stream` via proxy web: `curl -s -b "sid=..." -H 'Content-Type: application/json' -d '{"message":"Siapa saja pelanggan saya? Sebutkan namanya."}' http://localhost:5173/api/chat/stream` → assert keluaran mengandung `tool_call` dan `customer.list` dan jawaban menyebut "Budi" (retry ≤3 bila 503).
3. `GET /api/chat/sessions` → ≥1.
4. `POST /api/tts` `{text:"Halo"}` → `content-type audio/wav`, ukuran > 1KB.
5. `POST /api/stt` wav senyap → `{"text":""}`.
Jalankan; PASS=semua → dokumentasikan.

- [ ] **Step 2: dokumen hasil**

Create `docs/spikes/2026-10-10-phase2-chat-check.md` — tabel butir ✓/✗ + catatan (model dipakai, latensi, perilaku retry).

- [ ] **Step 3: README**

Edit `README.md`: tambah baris "Fase 2: chat AI (Gemini tool loop) + voice — lihat docs/plans/…; smoke: skrip phase2".

- [ ] **Step 4: verifikasi akhir penuh**

```bash
pnpm test          # root — semua paket (termasuk live tests bila key ada)
pnpm typecheck
pnpm --filter @aigoogle/web build
```
Expected: semua PASS/exit 0. `git status` bersih.

- [ ] **Step 5: commit**

```bash
git add docs/spikes README.md
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "docs(fase2): hasil smoke chat+voice + README"
```

---

## Selesai Fase 2

**Keluaran:** chat AI streaming (badge tool, riwayat, isolasi tenant) berjalan terhadap mock Accurate dengan Gemini asli; STT/TTS dua engine; permission per-role ditegakkan di tool loop; audit per tool call.

**Catatan:** key Gemini pemilik sudah terisi & terverifikasi live (model `gemini-3.8-flash`/`-tts`/`3.5-transcribe`). Uji Accurate API asli tetap menunggu pendaftaran callback (keputusan pemilik: nanti saat testing real online).






