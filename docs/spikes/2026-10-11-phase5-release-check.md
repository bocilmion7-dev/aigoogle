# Cek Fase 5 — Kesiapan Rilis

Tanggal: 2026-10-11
Plan: `docs/plans/2026-10-11-phase5-release-readiness.md`

## Hasil verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| `pnpm test` root | **137/137 PASS** (mocks/accurate 23 + apps/api 114; billing 5, golden-set 17) |
| `pnpm typecheck` | api + web **Done** |
| `pnpm --filter @aigoogle/web build` | ✓ |
| Smoke fase 3 (`e2e-smoke-phase3.sh`) | **13/13 PASS** (regresi) |
| Smoke fase 4 (`e2e-smoke-phase4.sh`) | **18/18 PASS** (regresi) |

## Isi fase

- **Billing dormant** — model `Subscription`/`Payment`; `billing/midtrans.ts` (hitung + verifikasi signature SHA-512 timing-safe, `isBillingEnabled` baca `process.env` agar bisa disuntik di test); `billing/entitlement.ts` (`isEntitled` → dormant selalu true); routes `GET /billing/status`, `POST /billing/subscribe` (503 dormant), `POST /billing/webhook` (403 dormant; 401 signature salah; update payment + expire subscription saat deny).
- **Golden set offline** — 5 kasus tool-loop (Gemini stub → tool diharapkan) + permission-ditolak; 10 fixture klasifikasi dokumen (teks + nama file) dengan **ambang ≥ 90%**. Golden set menemukan 2 bug klasifikasi nyata (regex `no \d+` rakus; `surat-jalan` hyphen tak dikenali) → diperbaiki.
- **Aksesibilitas dasar** — transcript chat `role="log"` + `aria-live="polite"`, error `role="alert"`, input chat `aria-label`, breadcrumb `aria-label`, tombol rapikan `aria-label` (mic sudah ada).
- **Hardening** — security headers global: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`.
- **Dokumen rilis** — `docs/listing/accurate-store.md` (deskripsi, harga, privasi, screenshot plan, FAQ) + `docs/release-checklist.md` (prasyarat bisnis/teknis, aktivasi billing).

## Status total

| Fase | Status |
|---|---|
| 0 Spike & mock | selesai (`6f34d37`) |
| 1 Fondasi | selesai (45/45 + smoke 15/15) |
| 2 Chat + voice | selesai (smoke 11/11 Gemini asli) |
| 3 Explore Manager | selesai (smoke 13/13) |
| 4 Admin & audit | selesai (smoke 18/18) |
| 5 Kesiapan rilis | selesai (suite 137/137, smoke regresi hijau) |

Semua fase spek (§18) terimplementasi. Rilis produksi tinggal mengikuti `docs/release-checklist.md` (kemitraan CPSsoft, env produksi, aktivasi billing bila harga final).
