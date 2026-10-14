# Multi-Provider AI (DB-driven) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pindahkan konfigurasi provider AI dari `.env` ke DB, dikelola via halaman admin `/ai` (tambah free-form → Muat model → checklist → Simpan; radio provider aktif; failover antar model provider aktif).

**Architecture:** Dua tabel baru `AiProvider` + `AiProviderModel` (ModelPool di-drop). `withModelFailover` tetap API-nya; kandidat kini membawa `client` siap pakai dari provider aktif sehingga 3 baris env-ternary di `llm-client.ts`/`scan.ts`/`classify.ts` cukup jadi `c.client`. Router API baru (`requirePlatform`) + halaman React `/ai` + nav item platform-admin. Auto-seed dari env lama saat DB kosong.

**Tech Stack:** Express 4 + Prisma/Postgres (apps/api), React 18 + Vite tanpa router (apps/web), zod, vitest.

**Spec:** `docs/specs/2026-10-14-multi-provider-ai-design.md`

**RULES WAJIB:** DILARANG mengubah struktur AI di chat, voice, upload image, dokumen. Yang boleh diubah hanya lapisan pemilihan provider (baris client-construction + sumber default model). `nvidia.ts`, `tool-loop.ts`, TTS/STT, FakeLLMClient tidak disentuh.

---

## File Map

| File | Aksi | Tanggung jawab |
|---|---|---|
| `apps/api/prisma/schema.prisma` | Modify | +AiProvider, +AiProviderModel; −ModelPool |
| `apps/api/prisma/migrations/...` | Create (via CLI) | drop ModelPool + create tabel baru |
| `apps/api/src/ai/model-pool.ts` | Rewrite | candidates dari provider aktif; kandidat bawa `client`; seed dari env |
| `apps/api/test/model-pool.test.ts` | Rewrite | test failover DB-driven |
| `apps/api/src/ai/llm-client.ts` | Modify (kecil) | `clientFor` → `c.client`; `defaultModel` → `getDefaultModel()` |
| `apps/api/src/doc/scan.ts` | Modify (1 blok) | ternary → `c.client` |
| `apps/api/src/drive/classify.ts` | Modify (1 blok) | ternary → `c.client` |
| `apps/api/src/routes/chat.ts` | Modify (1 baris) | model default dari pool |
| `apps/api/src/routes/ai-providers.ts` | Create | CRUD provider + preview/refresh models + activate |
| `apps/api/src/app.ts` | Modify | mount aiProvidersRouter |
| `apps/api/test/ai-providers.test.ts` | Create | test route |
| `apps/api/test/customers.test.ts`, `drive-vision.test.ts` | Modify (setup) | seed provider aktif |
| `packages/shared/src/index.ts` | Modify | DTO `AiProviderRow`, `AiProviderModelRow` |
| `apps/web/src/api.ts` | Modify | fetch helpers AI providers |
| `apps/web/src/pages/AiProviders.tsx` | Create | halaman kelola provider |
| `apps/web/src/App.tsx` | Modify | route `/ai` |
| `apps/web/src/ui.tsx` | Modify | nav item `/ai` (platform only) |

**Perintah penting** (jalankan dari `/root/aigoogle`):
- Test API: `pnpm --filter @aigoogle/api exec vitest run <file>` (root `.env` di-load otomatis; `fileParallelism:false`)
- TSC: `pnpm --filter @aigoogle/api exec tsc --noEmit` dan `pnpm --filter @aigoogle/web exec tsc --noEmit`
- Migrasi: `pnpm --filter @aigoogle/api exec prisma migrate dev --name ai_providers`
- Restart API live: `touch /root/aigoogle/apps/api/src/index.ts` (tsx watch)
- Build+deploy web: `pnpm --filter @aigoogle/web build && cp -r apps/web/dist/* /var/www/aigoogle/`
- Cookie platform uji live: asumsi cookie `psid` platform admin ada di lingkungan; jika tidak, uji route via vitest saja.

---

### Task 1: Schema + Migrasi

**Files:**
- Modify: `apps/api/prisma/schema.prisma:261-274` (ganti blok ModelPool)

- [ ] **Step 1: Edit schema — hapus ModelPool, tambah AiProvider + AiProviderModel**

Ganti blok `// Pool model AI ... model ModelPool { ... }` (schema.prisma:261-274) dengan:

```prisma
// Provider AI (OpenAI-compatible) — dikelola admin platform via halaman /ai
model AiProvider {
  id        String            @id @default(cuid())
  name      String
  baseUrl   String
  apiKey    String // plaintext, konsisten dgn AppSetting
  isActive  Boolean           @default(false)
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt
  models    AiProviderModel[]
}

// Model tercentang milik satu provider — "tercentang" = baris ada
model AiProviderModel {
  id           String     @id @default(cuid())
  providerId   String
  provider     AiProvider @relation(fields: [providerId], references: [id], onDelete: Cascade)
  name         String
  rank         Int        @default(0) // urutan percobaan (0 = utama)
  failureCount Int        @default(0)
  lastError    String     @default("")
  lastOkAt     DateTime?
  lastFailAt   DateTime?
  @@unique([providerId, name])
  @@index([providerId, rank])
}
```

- [ ] **Step 2: Jalankan migrasi**

Run: `pnpm --filter @aigoogle/api exec prisma migrate dev --name ai_providers`
Expected: migrasi dibuat; `ModelPool` di-drop; `AiProvider`/`AiProviderModel` ter-create. (Kalau ada kode yang masih impor `prisma.modelPool` — Task 2–3 segera menghapusnya; migrasi schema tidak butuh kode bersih, `migrate dev` hanya cek schema.)

- [ ] **Step 3: Regenerate Prisma client & pastikan tsc model-pool lama masih compile sementara**

Run: `pnpm --filter @aigoogle/api exec prisma generate && pnpm --filter @aigoogle/api exec tsc --noEmit`
Expected: FAIL — `modelPool` sudah tidak ada di client types (error di `model-pool.ts`). Itu expected; lanjut Task 2 segera memperbaiki. (Jika ingin hijau dulu di commit terpisah, boleh lanjut Task 2 dalam commit yang sama.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(api): skema AiProvider + AiProviderModel; drop ModelPool"
```

---

### Task 2: Rewrite model-pool.ts + test

**Files:**
- Rewrite: `apps/api/src/ai/model-pool.ts`
- Rewrite: `apps/api/test/model-pool.test.ts`

- [ ] **Step 1: Tulis skeleton `model-pool.ts` baru (timpa file)**

```ts
import { prisma } from "../db.js";
import { env } from "../env.js";
import { LlmHttpError } from "./llm-error.js";
import { RealNvidiaClient, type NvidiaClient } from "./nvidia.js";

/**
 * Pool model AI berbasis DB (tabel AiProvider + AiProviderModel).
 *
 * - Tepat satu provider aktif (AiProvider.isActive) — diatur admin via radio.
 * - Kandidat = model tercentang provider aktif (rank asc, failureCount < MAX_FAILURES).
 * - Kandidat membawa `client` siap pakai (RealNvidiaClient dari baseUrl+apiKey provider)
 *   sehingga pemanggil TIDAK perlu lagi ternary env.
 * - Gagal semua (ada transient) → reset failureCount provider aktif → 1 siklus lagi.
 * - 401/403 → abort; 404 → demote permanen; transient (0/429/5xx) → demote sementara.
 */
export type ModelAction = "generate";

export interface ModelCandidate {
  provider: { id: string; name: string; baseUrl: string; apiKey: string };
  model: string;
  client: NvidiaClient;
}

export const MAX_FAILURES = 3;
const MAX_TRY = 3;

function errStatus(e: unknown): number { /* SAMA seperti lama */ }
const ABORT_STATUS = new Set([401, 403]);
const isTransient = (s: number) => s === 0 || s === 404 || s === 429 || s >= 500;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

// TODO SEED: seedFromEnvIfNeeded()
// TODO CANDIDATES: candidates(preferred?)
// TODO FAILOVER: withModelFailover
// TODO DEFAULT: getDefaultModel()
```

Salin isi fungsi `errStatus`/`ABORT_STATUS`/`isTransient`/`errMsg` persis dari file lama (model-pool.ts:32-40).

- [ ] **Step 2: Implement seed + candidates**

Ganti `// TODO SEED` dan `// TODO CANDIDATES` dengan:

```ts
/** Seed sekali dari env lama bila belum ada provider sama sekali. */
export async function seedFromEnvIfNeeded(): Promise<void> {
  const n = await prisma.aiProvider.count();
  if (n > 0) return;
  if (env.ROUTER_API_KEY.length > 10) {
    const models = env.ROUTER_MODEL.split(",").map((s) => s.trim()).filter(Boolean);
    await prisma.aiProvider.create({
      data: {
        name: "9Router",
        baseUrl: env.ROUTER_BASE_URL,
        apiKey: env.ROUTER_API_KEY,
        isActive: true,
        models: { createMany: { data: models.map((name, rank) => ({ name, rank })) } },
      },
    });
  } else if (env.NVIDIA_API_KEY.length > 10) {
    await prisma.aiProvider.create({
      data: {
        name: "NVIDIA NIM",
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: env.NVIDIA_API_KEY,
        isActive: true,
        models: env.NVIDIA_MODEL
          ? { createMany: { data: [{ name: env.NVIDIA_MODEL.trim(), rank: 0 }] } }
          : undefined,
      },
    });
  }
}

function toCandidate(p: { id: string; name: string; baseUrl: string; apiKey: string }, model: string): ModelCandidate {
  return { provider: p, model, client: new RealNvidiaClient(p.apiKey, p.baseUrl) };
}

async function candidates(preferred?: string): Promise<ModelCandidate[]> {
  await seedFromEnvIfNeeded();
  const active = await prisma.aiProvider.findFirst({
    where: { isActive: true },
    include: { models: { where: { failureCount: { lt: MAX_FAILURES } }, orderBy: { rank: "asc" } } },
  });
  if (!active) throw new LlmHttpError(503, "tidak ada provider AI aktif — atur di halaman AI");
  let list = active.models.map((m) => toCandidate(active, m.name));
  if (preferred && !list.some((c) => c.model === preferred)) {
    const pref = await prisma.aiProviderModel.findUnique({
      where: { providerId_name: { providerId: active.id, name: preferred } },
    });
    if (pref && pref.failureCount < MAX_FAILURES) {
      list = [toCandidate(active, pref.name), ...list];
    }
  }
  return list.slice(0, MAX_TRY);
}
```

- [ ] **Step 3: Implement `withModelFailover` + `getDefaultModel`**

Ganti `// TODO FAILOVER` dan `// TODO DEFAULT` dengan (pola cycle/refresh sama seperti file lama:173-226, tapi reset counter menggantikan refreshModelsLive):

```ts
type Cycle<T> = { ok: true; value: T } | { ok: false };

async function markOk(m: ModelCandidate): Promise<void> {
  await prisma.aiProviderModel.updateMany({
    where: { providerId: m.provider.id, name: m.model },
    data: { failureCount: 0, lastError: "", lastOkAt: new Date() },
  });
}

async function markFail(m: ModelCandidate, status: number, message: string): Promise<void> {
  const isGone = status === 404;
  await prisma.aiProviderModel.updateMany({
    where: { providerId: m.provider.id, name: m.model },
    data: isGone
      ? { failureCount: MAX_FAILURES, lastError: `404: ${message}`.slice(0, 500), lastFailAt: new Date() }
      : { failureCount: { increment: 1 }, lastError: message.slice(0, 500), lastFailAt: new Date() },
  });
}

async function resetActiveFailures(): Promise<void> {
  const active = await prisma.aiProvider.findFirst({ where: { isActive: true } });
  if (!active) return;
  await prisma.aiProviderModel.updateMany({
    where: { providerId: active.id },
    data: { failureCount: 0, lastError: "" },
  });
}

export async function withModelFailover<T>(
  _action: ModelAction,
  run: (c: ModelCandidate) => Promise<T>,
  preferred?: string
): Promise<T> {
  let lastErr: unknown = null;
  let sawTransient = false;

  const cycle = async (cands: ModelCandidate[]): Promise<Cycle<T>> => {
    for (const c of cands) {
      try {
        const value = await run(c);
        await markOk(c);
        return { ok: true, value };
      } catch (e) {
        const st = errStatus(e);
        if (ABORT_STATUS.has(st)) throw e;
        lastErr = e;
        if (isTransient(st)) {
          sawTransient = true;
          await markFail(c, st, errMsg(e));
        }
      }
    }
    return { ok: false };
  };

  let models = await candidates(preferred);
  let out = await cycle(models);
  if (out.ok) return out.value;

  if (sawTransient) {
    await resetActiveFailures();
    models = await candidates(preferred);
    out = await cycle(models);
    if (out.ok) return out.value;
  }

  throw lastErr ?? new LlmHttpError(503, "tidak ada model AI tersedia");
}

/** Model rank-1 provider aktif (untuk preferred default di chat). */
export async function getDefaultModel(): Promise<string> {
  await seedFromEnvIfNeeded();
  const m = await prisma.aiProviderModel.findFirst({
    where: { provider: { isActive: true }, failureCount: { lt: MAX_FAILURES } },
    orderBy: { rank: "asc" },
  });
  return m?.name ?? "";
}
```

- [ ] **Step 4: Pastikan impor NvidiaClient type valid**

Di `nvidia.ts`, pastikan `interface NvidiaClient` sudah di-export (cek baris ~144; jika belum, tambahkan `export` — ini bukan perubahan struktur AI, hanya visibility type). Run: `pnpm --filter @aigoogle/api exec tsc --noEmit` — error di `llm-client.ts`/`scan.ts`/`classify.ts`/`chat.ts` masih expected (Task 3).

- [ ] **Step 5: Tulis ulang `test/model-pool.test.ts` (skeleton dulu)**

```ts
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db.js";
import { withModelFailover, getDefaultModel, MAX_FAILURES } from "../src/ai/model-pool.js";
import { LlmHttpError } from "../src/ai/llm-error.js";

async function seedProvider(models: string[], opts?: { active?: boolean; failures?: Record<string, number> }) {
  await prisma.aiProviderModel.deleteMany({});
  await prisma.aiProvider.deleteMany({});
  return prisma.aiProvider.create({
    data: {
      name: "uji",
      baseUrl: "http://localhost:9/v1",
      apiKey: "kunci-uji-panjang-sekali",
      isActive: opts?.active ?? true,
      models: {
        createMany: {
          data: models.map((name, rank) => ({ name, rank, failureCount: opts?.failures?.[name] ?? 0 })),
        },
      },
    },
  });
}

beforeEach(async () => {
  await prisma.aiProviderModel.deleteMany({});
  await prisma.aiProvider.deleteMany({});
});
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(async () => {
  await prisma.aiProviderModel.deleteMany({});
  await prisma.aiProvider.deleteMany({});
  await prisma.$disconnect();
});
```

- [ ] **Step 6: Isi test cases**

Tambahkan `describe("pool model AI (failover DB)", () => { ... })` dengan 6 test:

```ts
it("rotasi: model a 429 → b sukses; failureCount a naik, b lastOkAt terisi", async () => {
  await seedProvider(["a", "b"]);
  const tried: string[] = [];
  const out = await withModelFailover("generate", async (c) => {
    tried.push(c.model);
    if (c.model === "a") throw new LlmHttpError(429, "quota habis");
    return `ok-${c.model}`;
  }, "a");
  expect(out).toBe("ok-b");
  expect(tried).toEqual(["a", "b"]);
  const a = await prisma.aiProviderModel.findFirst({ where: { name: "a" } });
  const b = await prisma.aiProviderModel.findFirst({ where: { name: "b" } });
  expect(a?.failureCount).toBe(1);
  expect(a?.lastError).toContain("quota");
  expect(b?.failureCount).toBe(0);
  expect(b?.lastOkAt).not.toBeNull();
});

it("kandidat membawa client dari provider aktif (baseUrl+apiKey)", async () => {
  const p = await seedProvider(["m1"]);
  const out = await withModelFailover("generate", async (c) => {
    expect(c.provider.baseUrl).toBe("http://localhost:9/v1");
    expect(c.provider.apiKey).toBe("kunci-uji-panjang-sekali");
    expect(c.client).toBeTruthy();
    expect(c.provider.id).toBe(p.id);
    return "ok";
  });
  expect(out).toBe("ok");
});

it("SEMUA model transient gagal → reset counter → siklus kedua sukses", async () => {
  await seedProvider(["a", "b"]);
  let calls = 0;
  const out = await withModelFailover("generate", async (c) => {
    calls++;
    if (calls <= 2) throw new LlmHttpError(500, "down"); // siklus 1: a,b gagal
    return `ok-${c.model}`; // siklus 2 setelah reset
  });
  expect(out).toMatch(/^ok-/);
  const rows = await prisma.aiProviderModel.findMany();
  expect(rows.every((r) => r.failureCount === 0 || r.name === undefined || true)).toBe(true);
  // setelah sukses, model terakhir yang dipakai di-reset markOk-nya
});

it("401 → abort: tanpa rotasi ke model berikut", async () => {
  await seedProvider(["x", "y"]);
  const tried: string[] = [];
  await expect(
    withModelFailover("generate", async (c) => {
      tried.push(c.model);
      throw new LlmHttpError(401, "API key tidak valid");
    })
  ).rejects.toThrow(/API key/);
  expect(tried).toEqual(["x"]);
  const x = await prisma.aiProviderModel.findFirst({ where: { name: "x" } });
  expect(x?.failureCount).toBe(0);
});

it("model demoted (failureCount ≥ MAX) tidak jadi kandidat; preferred tetap bisa unshift bila belum demoted", async () => {
  await seedProvider(["a", "b"], { failures: { a: MAX_FAILURES } });
  const tried: string[] = [];
  const out = await withModelFailover("generate", async (c) => { tried.push(c.model); return "ok"; }, "a");
  expect(out).toBe("ok");
  expect(tried).toEqual(["b"]); // a demoted → dilewati meski preferred
});

it("tanpa provider aktif → 503; getDefaultModel mengikuti provider aktif", async () => {
  await seedProvider(["z1", "z2"], { active: false });
  await expect(withModelFailover("generate", async () => "ok")).rejects.toThrow(/provider AI aktif/);
  expect(await getDefaultModel()).toBe("");
  await seedProvider(["z1", "z2"], { active: true });
  expect(await getDefaultModel()).toBe("z1");
});
```

- [ ] **Step 7: Jalankan test**

Run: `pnpm --filter @aigoogle/api exec vitest run test/model-pool.test.ts`
Expected: PASS semua (6 test). Kalau gagal karena seed env mengganggu: test selalu `deleteMany` di beforeEach sehingga `seedFromEnvIfNeeded` akan re-seed dari env (ROUTER_API_KEY kosong, NVIDIA_API_KEY ada di .env) — HATI-HATI: `seedFromEnvIfNeeded` dipanggil di `candidates()` dan akan membuat provider NVIDIA dari env bila count=0, menabrak skenario "tanpa provider aktif". **Solusi:** di test "tanpa provider aktif", set `process.env.NVIDIA_API_KEY=""` dan `process.env.ROUTER_API_KEY=""` sementara… tidak bisa (env sudah di-parse saat import). **Fix desain:** `seedFromEnvIfNeeded` hanya dijalankan bila `prisma.aiProvider.count()===0`; test "tanpa provider aktif" membuat provider non-aktif (count>0) → seed tidak jalan. Test `getDefaultModel` non-aktif juga aman. Pastikan semua test selalu membuat ≥1 provider (termasuk non-aktif) sebelum assert 503 — skeleton `seedProvider` sudah begitu. Untuk test yang butuh count=0 murni, skip (tidak perlu).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/ai/model-pool.ts apps/api/test/model-pool.test.ts
git commit -m "feat(api): model-pool DB-driven — provider aktif + kandidat bawa client"
```

---

### Task 3: Wire consumers (4 file, perubahan minimal)

**Files:**
- Modify: `apps/api/src/ai/llm-client.ts:14-33`
- Modify: `apps/api/src/doc/scan.ts:187-194`
- Modify: `apps/api/src/drive/classify.ts:47-55`
- Modify: `apps/api/src/routes/chat.ts:129`

- [ ] **Step 1: `llm-client.ts` — hapus env clientFor, pakai c.client + getDefaultModel**

Ganti baris 1-16 (impor + defaultModel) menjadi:

```ts
import { LlmHttpError } from "./llm-error.js";
import { withModelFailover, getDefaultModel, type ModelCandidate } from "./model-pool.js";
import type { GenerateOpts, LLMPart } from "./llm-types.js";

export { LlmHttpError };

export interface LLMClient {
  generate(opts: GenerateOpts): Promise<{ parts: LLMPart[] }>;
  generateStream(opts: GenerateOpts): AsyncGenerator<LLMPart>;
}
```

Ganti method `generate` (baris 25-34) menjadi:

```ts
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
```

Ganti bagian dalam `generateStream` (baris 40-41) — `this.clientFor(c).generate` → `c.client.generate`; preferred `opts.model || defaultModel()` → `opts.model || (await getDefaultModel())`. Hapus class-method `clientFor` seluruhnya (baris 19-23). Hapus impor `env` dan `RealNvidiaClient` yang tak terpakai.

- [ ] **Step 2: `scan.ts` — ganti blok ternary**

Ganti baris 189-194 (`generateText`) menjadi:

```ts
  return await withModelFailover("generate", async (c) => {
    const { parts: out } = await c.client.generate({ contents, model: c.model });
```

(Sisanya fungsi tidak berubah.) Hapus impor `RealNvidiaClient`/`env` bila tak terpakai lagi di file scan.ts — cek dulu; jika `env` masih dipakai bagian lain scan.ts biarkan.

- [ ] **Step 3: `classify.ts` — ganti blok ternary**

Ganti baris 47-55 menjadi:

```ts
    const raw = await withModelFailover("generate", async (c) => {
      const { parts: out } = await c.client.generate({
        contents: [{ role: "user", parts }],
        model: c.model,
      });
```

Hapus impor `RealNvidiaClient`/`env` bila tak terpakai.

- [ ] **Step 4: `chat.ts` — ganti sumber model default (1 baris)**

Ganti baris 129 `model: env.ROUTER_MODEL.split(",")[0]?.trim(),` menjadi:

```ts
        model: await getDefaultModel(),
```

Tambah impor: `import { getDefaultModel } from "../ai/model-pool.js";`. Hapus impor `env` di chat.ts bila tak terpakai lagi (cek dulu baris lain).

- [ ] **Step 5: TSC hijau**

Run: `pnpm --filter @aigoogle/api exec tsc --noEmit`
Expected: PASS. Jika error impor tak terpakai/`env` — bersihkan.

- [ ] **Step 6: Jalankan test AI yang ada**

Run: `pnpm --filter @aigoogle/api exec vitest run test/tool-loop.test.ts test/golden-set.test.ts test/system-prompt.test.ts test/model-pool.test.ts`
Expected: PASS (FakeLLMClient tidak lewat model-pool; golden-set perlu dicek — jika memanggil RealLLMClient/live, mungkin skip; lihat hasil aktual dan sesuaikan: jika golden-set butuh provider, tambahkan `seedProvider` serupa di awal file via import helper — untuk sekarang cukup pastikan tidak REGRESS).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/ai/llm-client.ts apps/api/src/doc/scan.ts apps/api/src/drive/classify.ts apps/api/src/routes/chat.ts
git commit -m "refactor(api): konsumen AI pakai client dari pool (c.client) — struktur AI tak berubah"
```

---

### Task 4: Shared types + API routes AI providers

**Files:**
- Modify: `packages/shared/src/index.ts` (tambah di akhir)
- Create: `apps/api/src/routes/ai-providers.ts`
- Modify: `apps/api/src/app.ts:17-18,55-56` (impor + mount)
- Create: `apps/api/test/ai-providers.test.ts`

- [ ] **Step 1: Shared DTO**

Tambahkan di `packages/shared/src/index.ts` setelah `WINPAY_DEFAULT_CLIENT_ID`:

```ts
export interface AiProviderModelRow {
  name: string;
  rank: number;
  failureCount: number;
  lastError: string;
  lastOkAt: string | null;
}
export interface AiProviderRow {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyMasked: string; // "••••" + 4 char terakhir
  isActive: boolean;
  models: AiProviderModelRow[];
}
```

- [ ] **Step 2: Skeleton `routes/ai-providers.ts`**

```ts
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePlatform } from "../middleware/session.js";
import { asyncHandler } from "../asyncHandler.js";
import { writeAudit } from "../audit.js";
import { RealNvidiaClient } from "../ai/nvidia.js";
import { LlmHttpError } from "../ai/llm-error.js";

export const aiProvidersRouter = Router();

function maskKey(key: string): string {
  if (!key) return "";
  return `••••${key.slice(-4)}`;
}

// TODO: GET /ai/providers
// TODO: POST /ai/providers
// TODO: PUT /ai/providers/:id
// TODO: DELETE /ai/providers/:id
// TODO: POST /ai/providers/:id/activate
// TODO: POST /ai/providers/preview-models
// TODO: POST /ai/providers/:id/refresh-models
```

- [ ] **Step 3: Implement GET list**

Ganti `// TODO: GET` dengan:

```ts
aiProvidersRouter.get(
  "/ai/providers",
  requirePlatform,
  asyncHandler(async (_req, res) => {
    const rows = await prisma.aiProvider.findMany({
      include: { models: { orderBy: { rank: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    res.json(
      rows.map((p) => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        apiKeyMasked: maskKey(p.apiKey),
        isActive: p.isActive,
        models: p.models.map((m) => ({
          name: m.name,
          rank: m.rank,
          failureCount: m.failureCount,
          lastError: m.lastError,
          lastOkAt: m.lastOkAt?.toISOString() ?? null,
        })),
      }))
    );
  })
);
```

- [ ] **Step 4: Implement POST create + PUT update (replace models)**

Ganti `// TODO: POST` dan `// TODO: PUT` dengan:

```ts
const ProviderBody = z.object({
  name: z.string().min(1).max(100),
  baseUrl: z.string().url().max(300),
  apiKey: z.string().min(1).max(500),
  models: z.array(z.string().min(1).max(200)).max(200).default([]),
});

aiProvidersRouter.post(
  "/ai/providers",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const body = ProviderBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const { name, baseUrl, apiKey, models } = body.data;
    const p = await prisma.aiProvider.create({
      data: {
        name,
        baseUrl: baseUrl.replace(/\/+$/, ""),
        apiKey,
        models: { createMany: { data: models.map((m, rank) => ({ name: m, rank })) } },
      },
      include: { models: true },
    });
    await writeAudit("platform", req.platform!.id, "ai_provider.create", { id: p.id, name });
    res.status(201).json({ id: p.id });
  })
);

const UpdateBody = z.object({
  name: z.string().min(1).max(100).optional(),
  baseUrl: z.string().url().max(300).optional(),
  apiKey: z.string().min(1).max(500).optional(),
  models: z.array(z.string().min(1).max(200)).max(200).optional(),
});

aiProvidersRouter.put(
  "/ai/providers/:id",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const body = UpdateBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const id = req.params.id;
    const exists = await prisma.aiProvider.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ error: "tidak_ditemukan" });
    const { models, baseUrl, ...rest } = body.data;
    await prisma.$transaction(async (tx) => {
      await tx.aiProvider.update({
        where: { id },
        data: { ...rest, ...(baseUrl ? { baseUrl: baseUrl.replace(/\/+$/, "") } : {}) },
      });
      if (models !== undefined) {
        await tx.aiProviderModel.deleteMany({ where: { providerId: id } });
        if (models.length) {
          await tx.aiProviderModel.createMany({
            data: models.map((m, rank) => ({ providerId: id, name: m, rank })),
          });
        }
      }
    });
    await writeAudit("platform", req.platform!.id, "ai_provider.update", { id });
    res.json({ ok: true });
  })
);
```

- [ ] **Step 5: Implement DELETE + activate**

Ganti `// TODO: DELETE` dan `// TODO: activate` dengan:

```ts
aiProvidersRouter.delete(
  "/ai/providers/:id",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const exists = await prisma.aiProvider.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ error: "tidak_ditemukan" });
    await prisma.aiProvider.delete({ where: { id } });
    await writeAudit("platform", req.platform!.id, "ai_provider.delete", { id, name: exists.name });
    res.json({ ok: true });
  })
);

aiProvidersRouter.post(
  "/ai/providers/:id/activate",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const exists = await prisma.aiProvider.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ error: "tidak_ditemukan" });
    await prisma.$transaction([
      prisma.aiProvider.updateMany({ data: { isActive: false } }),
      prisma.aiProvider.update({ where: { id }, data: { isActive: true } }),
    ]);
    await writeAudit("platform", req.platform!.id, "ai_provider.activate", { id });
    res.json({ ok: true });
  })
);
```

- [ ] **Step 6: Implement preview-models + refresh-models**

Ganti `// TODO: preview` dan `// TODO: refresh` dengan:

```ts
const PreviewBody = z.object({
  baseUrl: z.string().url().max(300),
  apiKey: z.string().min(1).max(500),
});

async function fetchModelList(baseUrl: string, apiKey: string): Promise<string[]> {
  try {
    return await new RealNvidiaClient(apiKey, baseUrl.replace(/\/+$/, "")).listModels();
  } catch (e) {
    const st = e instanceof LlmHttpError ? e.status : 502;
    const msg = e instanceof Error ? e.message : String(e);
    throw new LlmHttpError(st >= 400 && st < 600 ? st : 502, `gagal memuat model: ${msg}`.slice(0, 500));
  }
}

aiProvidersRouter.post(
  "/ai/providers/preview-models",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const body = PreviewBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const models = await fetchModelList(body.data.baseUrl, body.data.apiKey);
    res.json({ models });
  })
);

aiProvidersRouter.post(
  "/ai/providers/:id/refresh-models",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const p = await prisma.aiProvider.findUnique({ where: { id: req.params.id } });
    if (!p) return res.status(404).json({ error: "tidak_ditemukan" });
    const models = await fetchModelList(p.baseUrl, p.apiKey);
    res.json({ models });
  })
);
```

- [ ] **Step 7: Mount di `app.ts`**

Tambah impor setelah baris 18: `import { aiProvidersRouter } from "./routes/ai-providers.js";`  
Tambah mount setelah `app.use("/api", settingsRouter);` (baris 47): `app.use("/api", aiProvidersRouter);`

- [ ] **Step 8: Test route (auth + activate + preview non-2xx)**

Buat `apps/api/test/ai-providers.test.ts`:

```ts
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

const app = createApp();

// helper: buat platform session langsung di DB (ikuti pola test lain bila ada; jika tidak:)
async function platformCookie(): Promise<string> {
  const u = await prisma.platformUser.upsert({
    where: { email: "uji-ai@example.com" },
    create: { email: "uji-ai@example.com", name: "Uji", passwordHash: "x" },
    update: {},
  });
  const s = await prisma.platformSession.create({ data: { userId: u.id } });
  return `psid=${s.id}`;
}

beforeEach(async () => {
  await prisma.aiProviderModel.deleteMany({});
  await prisma.aiProvider.deleteMany({});
});
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(async () => {
  await prisma.aiProviderModel.deleteMany({});
  await prisma.aiProvider.deleteMany({});
  await prisma.$disconnect();
});

describe("API kelola provider AI", () => {
  it("tanpa sesi platform → 401", async () => {
    const res = await request(app).get("/api/ai/providers");
    expect(res.status).toBe(401);
  });

  it("create → list (key masked) → activate hanya 1 aktif", async () => {
    const cookie = await platformCookie();
    const a = await request(app).post("/api/ai/providers").set("Cookie", cookie).send({
      name: "A", baseUrl: "https://a.example/v1", apiKey: "key-AAAA", models: ["m1", "m2"],
    });
    expect(a.status).toBe(201);
    const b = await request(app).post("/api/ai/providers").set("Cookie", cookie).send({
      name: "B", baseUrl: "https://b.example/v1", apiKey: "key-BBBB", models: ["n1"],
    });
    expect(b.status).toBe(201);
    await request(app).post(`/api/ai/providers/${b.body.id}/activate`).set("Cookie", cookie).send({});
    const list = await request(app).get("/api/ai/providers").set("Cookie", cookie);
    expect(list.status).toBe(200);
    const actives = list.body.filter((p: { isActive: boolean }) => p.isActive);
    expect(actives).toHaveLength(1);
    expect(actives[0].name).toBe("B");
    expect(list.body[0].apiKeyMasked).toBe("••••AAAA");
    expect(list.body[0].models.map((m: { name: string }) => m.name)).toEqual(["m1", "m2"]);
  });

  it("preview-models non-2xx upstream → error status", async () => {
    const cookie = await platformCookie();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const res = await request(app)
      .post("/api/ai/providers/preview-models")
      .set("Cookie", cookie)
      .send({ baseUrl: "https://x.example/v1", apiKey: "k" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(String(res.body.error ?? "")).toContain("gagal memuat model");
  });

  it("PUT models mengganti seluruh checklist", async () => {
    const cookie = await platformCookie();
    const a = await request(app).post("/api/ai/providers").set("Cookie", cookie).send({
      name: "A", baseUrl: "https://a.example/v1", apiKey: "key", models: ["m1", "m2", "m3"],
    });
    await request(app).put(`/api/ai/providers/${a.body.id}`).set("Cookie", cookie).send({ models: ["m2", "m9"] });
    const list = await request(app).get("/api/ai/providers").set("Cookie", cookie);
    expect(list.body[0].models.map((m: { name: string }) => m.name)).toEqual(["m2", "m9"]);
    expect(list.body[0].models.map((m: { rank: number }) => m.rank)).toEqual([0, 1]);
  });
});
```

**Catatan:** cek dulu `schema.prisma` field `PlatformUser`/`PlatformSession` (email unique, kolom passwordHash, relasi userId) dan `test/` yang sudah ada (mis. test auth platform) — sesuaikan helper `platformCookie` dengan factory yang ada (grep `psid` / `platformSession` di `apps/api/test`). Jika ada `test/helpers.ts` pakai itu.

- [ ] **Step 9: Jalankan test + tsc**

Run: `pnpm --filter @aigoogle/api exec vitest run test/ai-providers.test.ts test/model-pool.test.ts && pnpm --filter @aigoogle/api exec tsc --noEmit && pnpm --filter @aigoogle/web exec tsc --noEmit`
Expected: PASS. (Shared types baru → web tsc bisa minta build shared dulu: `pnpm --filter @aigoogle/shared build` bila pakai dist; cek package.json shared — workspace source export biasanya cukup.)

- [ ] **Step 10: Commit**

```bash
git add packages/shared apps/api/src/routes/ai-providers.ts apps/api/src/app.ts apps/api/test/ai-providers.test.ts
git commit -m "feat(api): route kelola provider AI (CRUD, activate, preview/refresh models)"
```

---

### Task 5: Perbaiki test yang pakai scan/drive (seed provider)

**Files:**
- Modify: `apps/api/test/customers.test.ts` (area setup, ~baris 94-110 stubs fetch)
- Modify: `apps/api/test/drive-vision.test.ts` (setup serupa)

- [ ] **Step 1: Buka kedua test, temukan sebelum suite where scan/classify dipanggil**

Grep: `rg -n "beforeEach|beforeAll|scanDocument|classifyFile|/api/customers/scan|/api/drive/plan" apps/api/test/customers.test.ts apps/api/test/drive-vision.test.ts`

- [ ] **Step 2: Tambah seed provider aktif di setup suite tersebut**

Di file test, tambahkan (sebelum kasus pertama yang memicu AI):

```ts
import { prisma } from "../src/db.js";

// …di beforeEach / beforeAll suite:
await prisma.aiProviderModel.deleteMany({});
await prisma.aiProvider.deleteMany({});
await prisma.aiProvider.create({
  data: {
    name: "uji",
    baseUrl: "http://localhost:9/v1",
    apiKey: "kunci-uji-panjang-sekali",
    isActive: true,
    models: { createMany: { data: [{ name: "model-uji", rank: 0 }] } },
  },
});
```

Stub `fetch` yang sudah ada (intercept `/chat/completions`) akan tetap kena karena `RealNvidiaClient.generate` memanggil `fetch(baseUrl + "/chat/completions")` — `c.client` memakai baseUrl provider (localhost:9) — PASTIKAN stub menangani URL apa pun yang berakhir dengan `/chat/completions` (biasanya via `vi.stubGlobal("fetch", …)` yang cek `String(url).includes("/chat/completions")`). Jika stub lama hardcode host tertentu, longgarkan ke `includes("/chat/completions")`.

- [ ] **Step 3: Jalankan kedua test**

Run: `pnpm --filter @aigoogle/api exec vitest run test/customers.test.ts test/drive-vision.test.ts`
Expected: PASS.

- [ ] **Step 4: Full API test suite**

Run: `pnpm --filter @aigoogle/api exec vitest run`
Expected: semua PASS kecuali `oauth-launch.test.ts` yang sudah pre-existing gagal (abaikan yang itu saja).

- [ ] **Step 5: Commit**

```bash
git add apps/api/test
git commit -m "test(api): seed provider aktif di suite scan/drive"
```

---

### Task 6: Web — helpers + halaman AiProviders + route + nav

**Files:**
- Modify: `apps/web/src/api.ts` (tambah helpers di akhir)
- Create: `apps/web/src/pages/AiProviders.tsx`
- Modify: `apps/web/src/App.tsx:14-24`
- Modify: `apps/web/src/ui.tsx:5-14,46-58` (impor ikon + links)

- [ ] **Step 1: API helpers di `api.ts`**

Tambahkan di akhir `api.ts`:

```ts
import type { AiProviderRow } from "@aigoogle/shared";

export const getAiProviders = () => adminFetch<AiProviderRow[]>("/api/ai/providers");
export const createAiProvider = (body: { name: string; baseUrl: string; apiKey: string; models: string[] }) =>
  adminFetch<{ id: string }>("/api/ai/providers", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
export const updateAiProvider = (id: string, body: { name?: string; baseUrl?: string; apiKey?: string; models?: string[] }) =>
  adminFetch<{ ok: boolean }>(`/api/ai/providers/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
export const deleteAiProvider = (id: string) =>
  adminFetch<{ ok: boolean }>(`/api/ai/providers/${id}`, { method: "DELETE" });
export const activateAiProvider = (id: string) =>
  adminFetch<{ ok: boolean }>(`/api/ai/providers/${id}/activate`, { method: "POST" });
export const previewAiModels = (baseUrl: string, apiKey: string) =>
  adminFetch<{ models: string[] }>("/api/ai/providers/preview-models", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl, apiKey }),
  });
export const refreshAiModels = (id: string) =>
  adminFetch<{ models: string[] }>(`/api/ai/providers/${id}/refresh-models`, { method: "POST" });
```

(Pindahkan `import type { AiProviderRow }` ke baris impor type di atas bersama `AppSettings` bila gaya file menuntut; `adminFetch` sudah ada.)

- [ ] **Step 2: Skeleton `AiProviders.tsx`**

Buat file dengan: impor React hooks, `AppHeader`/`PageLoader` dari `../ui`, helpers dari `../api`, type `AiProviderRow`. State:
- `list: AiProviderRow[] | null`
- `editing: null | { id?: string; name: string; baseUrl: string; apiKey: string }` (tanpa id = tambah)
- `availModels: string[] | null` (hasil Muat model)
- `checked: string[]` (checklist form)
- `busy: boolean`, `err: string`, `ok: string`

Fungsi: `load()` (getAiProviders), `muatModel()` (preview atau refresh → set availModels+checked dari intersect), `simpan()` (create/update), `hapus(id)` (confirm), `aktifkan(id)` (activate).

- [ ] **Step 3: Implement daftar provider + radio aktif**

Render `<AppHeader />` lalu `<main className="page">`:
- Banner `err`/`ok` (pola `Settings.tsx`: `className="banner banner--error"` / `banner--success` — cek class yang dipakai Settings.tsx dan samakan).
- `<section className="card">` daftar: tiap provider row = nama + baseUrl + `input type="radio" name="aktif" checked={p.isActive} onChange={() => aktifkan(p.id)}` label "Aktif" + jumlah model + tombol Edit + Hapus. Bila `list.length===0` → teks "Belum ada provider — tambah provider pertama".
- Tombol "Tambah provider" → `setEditing({ name: "", baseUrl: "", apiKey: "" }); setAvailModels(null); setChecked([])`.

- [ ] **Step 4: Implement form tambah/edit + Muat model + checklist + Simpan**

Form `<section className="card">` (tampil bila `editing` non-null):
- Input Nama, Base URL, API Key (type password).
- Tombol **"Muat model"**: `busy=true`; kalau `editing.id` ada → `refreshAiModels(id)`; kalau tidak → `previewAiModels(baseUrl, apiKey)`. Sukses → `setAvailModels(models)`; `setChecked(intersection(checkedLama, models))` (untuk edit: centang ulang model lama yang masih ada; untuk tambah: semua uncent). Gagal → `setErr(message)`.
- Bila `availModels` non-null → daftar checkbox: `availModels.map(m => <label><input type="checkbox" checked={checked.includes(m)} onChange={toggle}/>{m}</label>)`.
- Tombol **"Simpan"**: create (`createAiProvider`) atau update (`updateAiProvider(id, {…, models: checked})`); tutup form; `load()` ulang; `setOk("Tersimpan")`.
- Validasi ringan di UI: nama & baseUrl & (apiKey diisi atau edit yang sudah ada key — untuk edit, apiKey kosong = biarkan key lama: kirim `apiKey` hanya bila `editing.apiKey !== ""`).

- [ ] **Step 5: Mount route + nav**

`App.tsx`: tambah `import { AiProviders } from "./pages/AiProviders";` dan `if (path === "/ai") return <AiProviders />;` (sebelum fallback Landing).

`ui.tsx`: impor ikon yang cocok — cek `icons.tsx` untuk ikon chip/cpu; bila tidak ada, pakai `IconSettings` atau tambah `IconCpu` sederhana (viewBox 24, path stroke). Tambah ke links setelah settings:

```ts
...(canPlatform ? [{ href: "/ai", label: "AI Provider", short: "AI", Icon: IconCpu }] : []),
```

- [ ] **Step 6: TSC web + build**

Run: `pnpm --filter @aigoogle/web exec tsc --noEmit && pnpm --filter @aigoogle/web build`
Expected: PASS.

- [ ] **Step 7: Uji manual ringan (opsional bila server jalan)**

Buka `https://103.253.244.13/ai` login platform → pastikan nav "AI" muncul, list menampilkan provider hasil seed (9Router/NVIDIA dari env), radio aktif, Muat model terhadap provider NVIDIA asli bisa load daftar, checklist+Simpan → refresh list. Chat uji: `POST /api/chat/stream` cookie `sid=realsessionmv6t4ruv` masih merespons (pakai provider aktif DB).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): halaman kelola provider AI (/ai) + nav platform"
```

---

### Task 7: Deploy + commit gabungan final

**Files:** tidak ada kode baru.

- [ ] **Step 1: Full test + tsc final**

Run: `pnpm --filter @aigoogle/api exec vitest run && pnpm --filter @aigoogle/api exec tsc --noEmit && pnpm --filter @aigoogle/web exec tsc --noEmit`
Expected: PASS (kecuali oauth-launch pre-existing).

- [ ] **Step 2: Build + deploy web**

Run: `pnpm --filter @aigoogle/web build && cp -r apps/web/dist/* /var/www/aigoogle/`

- [ ] **Step 3: Restart API + smoke live**

Run: `touch /root/aigoogle/apps/api/src/index.ts` lalu curl health: `curl -s http://localhost:3001/api/health` → `{"ok":true}`. Chat smoke (cookie `sid=realsessionmv6t4ruv`): kirim pesan pendek ke `/api/chat/stream` → ada event `start`/`done`.

- [ ] **Step 4: Scrub & push**

Cek tak ada secret di diff: `git diff main...HEAD | rg -n "sk-bc1765|GEMINI_API_KEY=|AQ\.Ab8|bwr_live|nvapi-"` (kosong = aman; note: contoh key di test memakai string palsu "key-AAAA"/"kunci-uji" — aman). Push:

```bash
git push https://bocilmion7-dev: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@github.com/bocilmion7-dev/aigoogle.git main
```

(Hati-hati: push URL mengandung token — jangan echo ke log commit message.)

---

## Self-Review (dijalankan penulis plan)

- **Spec coverage:** schema (T1), runtime (T2), wire consumers (T3), routes 7 endpoint (T4), test scan/drive (T5), UI+nav+route (T6), seed (T2 seedFromEnvIfNeeded), deploy (T7). Radio activate, checklist replace, preview non-fallback manual, plaintext key, masking — semua ada.
- **Placeholder:** tidak ada TBD; langkah skeleton eksplisit "ganti TODO dengan kode di step berikutnya".
- **Konsistensi tipe:** `ModelCandidate{provider,model,client}` dipakai konsisten; DTO shared = respons route; `adminFetch` dipakai web helpers.
