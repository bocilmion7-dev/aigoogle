# Design: Multi-Provider AI (DB-driven)

Tanggal: 2026-10-14  
Status: Approved ( Pendekatan A )

## Goal

Konfigurasi provider AI dipindah dari `.env` (ROUTER_*/NVIDIA_* + hardcode ModelPool) ke **database**, dikelola lewat halaman admin baru:

- Tambah/edit/hapus provider **free-form**: Nama, Base URL, API Key (OpenAI-compatible apa pun).
- Alur: pilih/isi provider → **Muat model** (`GET {baseUrl}/models`, wajib; gagal = error, tanpa fallback manual) → **checklist model** → **Simpan**.
- Di daftar provider ada **radio "Aktif"** — tepat satu provider aktif.
- **Failover antar model dalam provider aktif** (bila checklist > 1): rotasi urut rank; 401/403 abort; 404 demote permanen; transient (0/429/5xx) demote sementara.

## RULES (wajib)

**DILARANG mengubah struktur AI di chat, voice, upload image, dan dokumen.** Yang boleh diubah hanya **lapisan pemilihan provider** (baris pembentukan client + sumber nama model). Format pesan (`nvidia.ts`), `tool-loop.ts`, alur scan/classify/chat, TTS/STT, FakeLLMClient — tidak disentuh.

## Arsitektur

### Data (Prisma)

Dua model baru; `ModelPool` **di-drop** di migrasi yang sama (tidak dipakai lagi).

```prisma
model AiProvider {
  id        String   @id @default(cuid())
  name      String
  baseUrl   String
  apiKey    String   // plaintext, konsisten dgn AppSetting
  isActive  Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  models    AiProviderModel[]
}

model AiProviderModel {
  id           String     @id @default(cuid())
  providerId   String
  provider     AiProvider @relation(fields: [providerId], references: [id], onDelete: Cascade)
  name         String
  rank         Int        @default(0)
  failureCount Int        @default(0)
  lastError    String     @default("")
  lastOkAt     DateTime?
  lastFailAt   DateTime?
  @@unique([providerId, name])
  @@index([providerId, rank])
}
```

- "Model tercentang" = baris ada di `AiProviderModel` (saat save, unchecked dihapus).
- Tepat **satu** `AiProvider.isActive = true` — di-tegakkan di kode saat activate (set semua false, lalu target true, dalam transaksi).

### Runtime (`apps/api/src/ai/model-pool.ts` dirombak)

API publik **tetap**: `withModelFailover(action, run, preferred?)`. Internals berubah:

- `candidates(action, preferred?)`:
  - ambil provider `isActive=true`; jika tidak ada → `LlmHttpError(503, "tidak ada provider AI aktif")`.
  - model provider itu: `failureCount < MAX_FAILURES (3)`, `orderBy rank asc`, cap `MAX_TRY (3)`.
  - `preferred` (nama model dari chat) di-unshift bila barisnya ada di provider aktif & belum demoted.
- `ModelCandidate` kini: `{ provider: { id, name, baseUrl, apiKey }, model: string, client: NvidiaClient }` — `client = new RealNvidiaClient(provider.apiKey, provider.baseUrl)` dibangun sekali di `candidates()`/`withModelFailover`.
- 3 lokasi triplicated ternary env diganti **hanya** baris client:
  - `llm-client.ts` `clientFor(c)` → pakai `c.client`.
  - `scan.ts` inline ternary → `c.client`.
  - `classify.ts` inline ternary → `c.client`.
- `getDefaultModel()`: model rank-1 provider aktif (atau `""`) — menggantikan `env.ROUTER_MODEL.split(",")[0]` di `chat.ts:129` (hanya sumber nama model).
- Semua model aktif gagal (ada transient) → **reset `failureCount` semua model provider aktif** (list dikelola admin; TIDAK re-fetch live `GET /models`) → 1 siklus lagi → lempar error terakhir / 503.
- `refreshModelsLive` / `ensureSeeded` lama **dihapus**; seeding diganti (lihat Auto-seed).
- `markOk` / `markFail` / `rowId` menyesuaikan (id = `AiProviderModel.id`, tak perlu lagi format `action:provider:name`; action tetap selalu `"generate"` dan bisa disederhanakan — field `action` di schema baru TIDAK ada, cukup provider+model).

### API (`apps/api/src/routes/ai-providers.ts`, semua `requirePlatform`)

| Method | Path | Body / hasil |
|---|---|---|
| GET | `/api/ai/providers` | `[{id,name,baseUrl,apiKeyMasked,isActive,models:[{name,rank,failureCount,lastError,lastOkAt}]}]` — key disajikan sebagai `••••` + 4 char terakhir |
| POST | `/api/ai/providers` | `{name,baseUrl,apiKey,models:string[]}` — create; models urutan array = rank |
| PUT | `/api/ai/providers/:id` | `{name?,baseUrl?,apiKey?,models?:string[]}` — update; `models` mengganti seluruh checklist |
| DELETE | `/api/ai/providers/:id` | cascade hapus model; jika aktif → tidak ada provider aktif sampai radio lain diset |
| POST | `/api/ai/providers/:id/activate` | `{}` — radio; transaksi set semua false → target true |
| POST | `/api/ai/providers/preview-models` | `{baseUrl,apiKey}` → `GET {baseUrl}/models` → `{models:string[]}` — untuk provider BELUM tersimpan |
| POST | `/api/ai/providers/:id/refresh-models` | `{}` → re-fetch list dari baseUrl+apiKey tersimpan → `{models:string[]}` |

- `preview-models` pakai `RealNvidiaClient(apiKey, baseUrl).listModels()`; non-2xx/network → 502 dengan pesan dari upstream (max 500 char).
- Validasi zod; audit log aksi platform (ikuti pola `routes/settings.ts`).
- `refresh-models` frontend merge: model lama tercentang yang masih ada di list baru tetap centang; yang hilang di-drop saat save.

### Web UI

- Halaman baru: `apps/web/src/pages/AiProviders.tsx`; route `/ai` di `App.tsx`.
- **Item bottom-nav baru** di `ui.tsx` `AppHeader`, tampil **hanya** bila `perms.includes("app:settings.manage")` (platform admin).
- Layout:
  - Daftar provider (card/row): nama, baseUrl, **radio "Aktif"**, jumlah model tercentang, tombol Edit / Hapus.
  - Tombol "Tambah provider".
  - Form tambah/edit (inline/section): Nama, Base URL, API Key → tombol **"Muat model"** (POST preview atau refresh) → spinner → **checklist model** (urut sesuai respons `/models`; rank = urutan array tercentang saat save, mengikuti urutan list) → tombol **"Simpan"**.
  - Hapus provider aktif → konfirmasi dulu.
- State coverage:
  - List kosong → CTA "Belum ada provider — tambah provider pertama".
  - Muat model: loading (tombol disabled), gagal → error banner, form tetap terisi.
  - Simpan: disabled + spinner; sukses/gagal → banner (pola `Settings.tsx`).
  - Provider aktif dihapus → daftar tampil tanpa radio aktif; runtime akan 503 sampai radio baru diset.
- Arah visual: konsisten dengan `Settings.tsx` (card section, banner sukses/error) — tanpa design system baru.

### Auto-seed

Saat runtime butuh provider (`ensureSeeded` sederhana: `AiProvider.count()===0` → seed):

1. Jika `env.ROUTER_API_KEY.length > 10` → buat provider name `"9Router"`, baseUrl `env.ROUTER_BASE_URL`, apiKey, models = `env.ROUTER_MODEL.split(",")` (semua tercentang, rank = urutan CSV), `isActive=true`.
2. Else jika `env.NVIDIA_API_KEY.length > 10` → `"NVIDIA NIM"`, baseUrl default NVIDIA, models = `[env.NVIDIA_MODEL]` (jika kosong → models kosong; admin wajib Muat model + Simpan).
3. Else → biarkan kosong (runtime 503 dengan pesan jelas).

Env `NVIDIA_*`/`ROUTER_*` **hanya untuk seed**; runtime setelah seed mengabaikannya. Env tidak dihapus dari `env.ts` (masih dipakai seed + test lama yang diadaptasi).

### Perubahan file (ringkas)

| File | Perubahan |
|---|---|
| `prisma/schema.prisma` | + AiProvider, AiProviderModel; − ModelPool; migrasi drop+create |
| `src/ai/model-pool.ts` | rombak (lihat Runtime) |
| `src/ai/llm-client.ts` | `clientFor` → `c.client`; `defaultModel` → `getDefaultModel()` pool |
| `src/doc/scan.ts` | 1 baris: ternary → `c.client` |
| `src/drive/classify.ts` | 1 baris: ternary → `c.client` |
| `src/routes/chat.ts` | 1 baris: `env.ROUTER_MODEL.split(",")[0]` → `getDefaultModel()` |
| `src/routes/ai-providers.ts` | **baru** |
| `src/app.ts` | mount router AI providers |
| `src/env.ts` | komentar: hanya utk seed (field tidak dihapus) |
| `apps/web/src/pages/AiProviders.tsx` | **baru** |
| `apps/web/src/App.tsx` | route `/ai` |
| `apps/web/src/ui.tsx` | nav item `/ai` (platform only) |
| `apps/web/src/api.ts` | fetch helpers AI providers |
| `packages/shared/src/index.ts` | tipe DTO provider AI |

### Testing

- Tulis ulang `test/model-pool.test.ts`: seed provider aktif di DB (prisma), uji rotasi failover, abort 401/403, demote 404, reset counter, 503 tanpa provider aktif, preferred unshift.
- Test route `ai-providers`: auth `requirePlatform` (401 tanpa psid), activate radio (hanya 1 aktif), preview-models dgn `fetch` mock non-2xx → 502, PUT models replace checklist.
- Test yang pakai `withModelFailover` via scan/drive/customers (`customers.test.ts` stubs fetch): seeding provider aktif di test setup (insert `AiProvider`+`AiProviderModel` → `RealNvidiaClient` dipakai, fetch stub tetap kena `/chat/completions`).
- `tool-loop` / `golden-set` / `system-prompt` / `drive-vision` — pastikan tetap lulus tanpa perubahan FakeLLMClient.

### Out of scope

- Streaming SSE sungguhan (masih simulasi yield).
- Enkripsi API key.
- Provider per-tenant (ini platform-global).
- Multi aktif / lintas provider failover.
- TTS/STT provider (TTS tetap Edge, STT browser).
