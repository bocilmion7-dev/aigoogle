# AI Google — Add-on AI untuk Accurate Online

## Struktur
- `apps/api` — Express + Prisma (Neon) — port 3001
- `apps/web` — React + Vite — port 5173 (proxy /api → 3001)
- `mocks/accurate` — mock API Accurate — port 4010
- `packages/shared` — tipe TS bersama

## Dev lokal
```bash
pnpm install
cd apps/api && pnpm exec prisma migrate dev   # sekali
# 3 terminal:
cd mocks/accurate && pnpm dev
cd apps/api && MOCK_ACCURATE_URL=http://localhost:4010 pnpm dev
cd apps/web && pnpm dev
```
Buka http://localhost:5173 → landing. Launch mock: http://localhost:5173/api/launch?dbId=1001

## Uji
`pnpm test` (root, semua paket) · `pnpm typecheck`

## Environment (.env root)
DATABASE_URL (Neon), TOKEN_ENC_KEY, ACCURATE_CLIENT_ID/SECRET,
ACCURATE_API_BASE, MOCK_ACCURATE_URL, APP_ORIGIN, GEMINI_API_KEY,
GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET (menyusul)

## Fase
- **Fase 1 (selesai):** fondasi monorepo, multi-tenant Neon, session cookie, OAuth Accurate (mock), Settings UI, koneksi. Rencana: `docs/plans/2026-10-10-phase1-fondasi-platform.md`.
- **Fase 2 (selesai):** AI chat streaming (Gemini tool loop, badge tool, riwayat, isolasi tenant, audit per tool call) + voice (STT/TTS dua engine: Web Speech & Gemini native). Rencana: `docs/plans/2026-10-10-phase2-ai-chat-voice.md`; hasil smoke: `docs/spikes/2026-10-10-phase2-chat-check.md`; skrip: `/tmp/opencode/e2e-smoke-phase2.sh` (11/11 PASS dengan Gemini asli).
- **Fase 3 (selesai):** Explore Manager — hubungkan Google Drive (OAuth, `MOCK_DRIVE=1` untuk mock), telusuri folder, rencana rapikan (folder kategori Faktur/Kuitansi/Nota/Surat Jalan/Lainnya via isi PDF dengan Gemini Vision, fallback nama file), preview + persetujuan, eksekusi NDJSON (progress, batal), log posisi asal per file untuk undo. Rencana: `docs/plans/2026-10-10-phase3-explore-manager.md`; hasil: `docs/spikes/2026-10-10-phase3-explore-check.md`; skrip: `/tmp/opencode/e2e-smoke-phase3.sh` (13/13 PASS).
- **Fase 4 (selesai):** Admin & audit — editor role checklist (Modul Accurate dari `capabilityCatalog` + mirror `privilegeCatalog`, Fitur Aplikasi statis), manajemen user (ganti role, guard ubah role sendiri), audit log (filter + email user), `/api/me` mengekspos `permissions`, UI `/admin` (tab User/Peran/Audit). Rencana: `docs/plans/2026-10-11-phase4-admin-audit.md`; hasil: `docs/spikes/2026-10-11-phase4-admin-check.md`; skrip: `/tmp/opencode/e2e-smoke-phase4.sh` (18/18 PASS).
- **Fase 5 (selesai):** Kesiapan rilis — billing core Midtrans QRIS **dormant** (`BILLING_ENABLED=0`; Subscription/Payment + signature webhook + entitlement), golden set offline (tool-loop stub + klasifikasi 10 fixture ambang ≥90%), aksesibilitas dasar (aria-live, role alert, aria-label), security headers, dokumen listing Accurate Store + checklist pra-rilis. Rencana: `docs/plans/2026-10-11-phase5-release-readiness.md`; hasil: `docs/spikes/2026-10-11-phase5-release-check.md`.

**Status:** seluruh fase spek (§18) selesai — suite 137/137, smoke fase 1–4 hijau. Rilis produksi ikuti `docs/release-checklist.md`.
- Catatan model Gemini: default `gemini-3.6-flash` (free tier 20 req/hari/model — `gemini-3.8-flash` habis kuota harian saat pengembangan); TTS `gemini-3.8-flash-tts`; STT `gemini-3.5-transcribe`.

