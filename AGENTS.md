# AGENTS.md — panduan kerja di repo ini

## Perintah penting
- `pnpm test` (root) — 44+ file test, ±90 dtk. **DB test = `aigoogle_test`** (diturunkan otomatis dari `DATABASE_URL` oleh `apps/api/vitest.config.ts`).
- `pnpm typecheck` (root) / `npx tsc --noEmit` per workspace.
- `cd apps/web && pnpm build` — wajib sebelum deploy web.
- `pnpm eval` — bench 509 soal (butuh `eval/.sid` + API hidup).
- Migrasi: `cd apps/api && npx prisma migrate deploy`. **Setelah menambah migrasi, terapkan juga ke DB test**:
  `DATABASE_URL=<...>/aigoogle_test npx prisma migrate deploy`.

## Deploy (produksi)
**Setiap perubahan harus langsung di-deploy ke publik** setelah verifikasi lulus (tidak menunggu diminta):
1. `scripts/deploy-web.sh` — build + rsync **aditif**: aset ber-hash lama disimpan 30 hari. Jangan memakai `rsync --delete` langsung ke `/var/www/aigoogle`; index/service worker lama yang masih dipegang klien bisa menunjuk chunk yang sudah dihapus → halaman macet.
2. `systemctl restart aigoogle-api` **hanya jika kode API berubah** (API pakai `tsx`). Deploy web saja tidak perlu restart agar sesi & request pengguna tidak terputus.
3. Cek `curl -s http://127.0.0.1:3001/api/health?deep=1`.
4. nginx TIDAK perlu reload kecuali config diubah.

## Konvensi & jebakan
- **Semua jawaban data harus tabel GFM.** Formatter di `apps/api/src/ai/transformer.ts` (blok `FORMATTERS`) — dilarang bullet `•`; ada test penjaga `test/formatter-table-guard.test.ts`.
- Prompt sistem: `apps/api/src/ai/system-prompt.ts`. Literal **`MODE SUARA`** hanya boleh ada di aturan suara (`test/system-prompt.test.ts`).
- Router: `transformToRoute` (fast path) + cache 5 menit; tool baru harus terdaftar di `ROUTER_CATALOG` **dan** `validateRoute` (kalau tidak, router menolaknya).
- Tool non-Accurate (Drive/Stats) didispatch di `apps/api/src/routes/chat.ts` `providerExecute`, bukan lewat provider Accurate.
- Tabel HTML di web: `apps/web/src/rich-text.tsx` (parser GFM, link `[Buka](url)`, modal zoom).
- `apps/web` tidak punya test runner; verifikasi lewat `tsc` + build + Playwright manual (venv di `/tmp/opencode/venv`, chromium di `/root/.cache/ms-playwright`).
- Jangan commit `.env`/rahasia. Model LLM dev diatur lewat systemd drop-in (`/etc/systemd/system/aigoogle-api.service.d/`), bukan repo.

## Struktur singkat
- `apps/api/src/routes/` — HTTP. `apps/api/src/ai/` — LLM, router, formatter, tool. `apps/api/src/providers/accounting/` — adapter Accurate (414 tool) + agregasi. `apps/api/src/drive/` — Drive client, indeks, tidy. `apps/api/src/wa/` — WhatsApp (scheduler, proaktif). `apps/api/src/sync/` — snapshot harian.
- `apps/web/src/pages/` — Chat, Explore (Drive), Admin, Settings, Pelanggan, WhatsApp, Aktivitas.
- `eval/` — harness bench akurasi. `docs/` — plan & spec per fase.
- Insight pasar: `apps/api/src/wawasan/` (ingest RSS whitelist, deteksi industri dari katalog Accurate, ranking, digest harian 04:30 WIB, ask RAG). Halaman `/insight` read-only + search bar. Cron ingest tiap 2 jam; digest harian sekali/hari.
- Perbandingan harga antar marketplace (`wawasan/marketplace.ts`) pakai SerpAPI `engine=google_shopping` — **tidak ada API Shopee/Tokopedia langsung**, hasil Google Shopping-lah yang memuat listing marketplace. Butuh `SERPAPI_KEY` di `.env` (opsional `SERPAPI_DAILY_LIMIT`, default 60 pencarian/hari lintas semua tenant — kuota gratis SerpAPI cuma 100/bulan). Tiap produk disimpan sebagai **rentang min–max per marketplace** (bukan tiap penawaran), difilter: relevansi judul + nomor model, pita harga ±15× harga jual, bukan barang sejenis (tablet/kacamata/dll), utamakan marketplace Indonesia.
