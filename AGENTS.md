# AGENTS.md — panduan kerja di repo ini

## Perintah penting
- `pnpm test` (root) — 44+ file test, ±90 dtk. **DB test = `aigoogle_test`** (diturunkan otomatis dari `DATABASE_URL` oleh `apps/api/vitest.config.ts`).
- `pnpm typecheck` (root) / `npx tsc --noEmit` per workspace.
- `cd apps/web && pnpm build` — wajib sebelum deploy web.
- `pnpm eval` — bench 509 soal (butuh `eval/.sid` + API hidup).
- Migrasi: `cd apps/api && npx prisma migrate deploy`. **Setelah menambah migrasi, terapkan juga ke DB test**:
  `DATABASE_URL=<...>/aigoogle_test npx prisma migrate deploy`.

## Deploy (produksi)
1. `cd apps/web && pnpm build && rsync -a --delete dist/ /var/www/aigoogle/`
2. `systemctl restart aigoogle-api` (API pakai `tsx` — perubahan kode butuh restart; ±15 dtk).
3. Cek `curl -s http://127.0.0.1:3001/api/health?deep=1`.
4. nginx TIDAK perlu reload kecuali config diubah.

## Konvensi & jebakan
- **Semua jawaban data harus tabel GFM.** Formatter di `apps/api/src/ai/transformer.ts` (blok `FORMATTERS`) — dilarang bullet `•`; ada test penjaga `test/formatter-table-guard.test.ts`.
- Prompt sistem: `apps/api/src/ai/system-prompt.ts`. Literal **`MODE SUARA`** hanya boleh ada di aturan suara (`test/system-prompt.test.ts`).
- Router: `transformToRoute` (fast path) + cache 10 menit; tool baru harus terdaftar di `ROUTER_CATALOG` **dan** `validateRoute` (kalau tidak, router menolaknya).
- Tool non-Accurate (Drive/Stats) didispatch di `apps/api/src/routes/chat.ts` `providerExecute`, bukan lewat provider Accurate.
- Tabel HTML di web: `apps/web/src/rich-text.tsx` (parser GFM, link `[Buka](url)`, modal zoom).
- `apps/web` tidak punya test runner; verifikasi lewat `tsc` + build + Playwright manual (venv di `/tmp/opencode/venv`, chromium di `/root/.cache/ms-playwright`).
- Jangan commit `.env`/rahasia. Model LLM dev diatur lewat systemd drop-in (`/etc/systemd/system/aigoogle-api.service.d/`), bukan repo.

## Struktur singkat
- `apps/api/src/routes/` — HTTP. `apps/api/src/ai/` — LLM, router, formatter, tool. `apps/api/src/providers/accounting/` — adapter Accurate (414 tool) + agregasi. `apps/api/src/drive/` — Drive client, indeks, tidy. `apps/api/src/wa/` — WhatsApp (scheduler, proaktif). `apps/api/src/sync/` — snapshot harian.
- `apps/web/src/pages/` — Chat, Explore (Drive), Admin, Settings, Pelanggan, WhatsApp, Aktivitas.
- `eval/` — harness bench akurasi. `docs/` — plan & spec per fase.
