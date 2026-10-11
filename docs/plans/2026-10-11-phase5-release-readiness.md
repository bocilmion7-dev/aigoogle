# Fase 5 — Kesiapan Rilis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. (User memilih eksekusi INLINE — tanpa sub-agent, tanpa code-quality review sub-agent; verifikasi = test + typecheck hijau.)

**Goal:** Siap rilis — billing core Midtrans QRIS **dormant** (nonaktif, siap diaktifkan tanpa redesign), entitlement helper, golden set offline (tool-loop stub + klasifikasi PDF), aksesibilitas dasar, hardening ringan, dokumen listing Accurate Store.

**Architecture:** Model `Subscription` + `Payment` di Neon; modul `billing/` berisi verifikasi signature webhook Midtrans (SHA-512, server key dari env) dan `isEntitled(tenantId)` — **flag `BILLING_ENABLED` default `false`** membuat semua jalur billing mengembalikan status dormant; entitlement selalu "aktif" selama dormant (belum ada enforcement di fitur). Golden set offline: kasus tool-loop dengan Gemini stub (functionCall sudah ditentukan) + kasus klasifikasi PDF fixture → ambang akurasi.

**Tech Stack:** Express + Prisma/Neon, Vitest + supertest, React+Vite.

---

## Peta File

| File | Tangung jawab |
|---|---|
| `apps/api/prisma/schema.prisma` | (Modify) model `Subscription`, `Payment` |
| `apps/api/src/env.ts` | (Modify) `BILLING_ENABLED`, `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY` |
| `apps/api/src/billing/midtrans.ts` | Verifikasi signature webhook + payload type |
| `apps/api/src/billing/entitlement.ts` | `isEntitled(tenantId)` — dormant-aware |
| `apps/api/src/routes/billing.ts` | GET status, POST subscribe (disabled), POST webhook |
| `apps/api/src/app.ts` | (Modify) mount billingRouter + security headers |
| `apps/api/src/security.ts` | Header keamanan ringan (nosniff, frame-deny, referrer) |
| `apps/api/test/billing.test.ts` | Signature, dormant, entitlement |
| `apps/api/test/golden-set.test.ts` | Tool-loop stub cases + akurasi klasifikasi fixture |
| `apps/web/src/pages/Chat.tsx` | (Modify) `aria-live` transcript + label |
| `docs/listing/accurate-store.md` | Dokumen listing (deskripsi, harga, privasi, FAQ) |
| `docs/release-checklist.md` | Checklist pra-rilis |
| `docs/spikes/2026-10-11-phase5-release-check.md` | Hasil verifikasi |

---

### Task 1: Skema Subscription/Payment + env + modul billing

- [ ] Model Prisma (relasi Tenant, index tenantId) + migrasi `phase5-billing`.
- [ ] `env.ts`: `BILLING_ENABLED: z.string().default("0")`, `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY` default "".
- [ ] `billing/midtrans.ts`: `verifyWebhookSignature(payload, serverKey)` → SHA-512 `order_id+status_code+gross_amount+server_key`; `isBillingEnabled()`.
- [ ] `billing/entitlement.ts`: `isEntitled(tenantId)` → dormant → true; aktif → cek Subscription aktif & belum kadaluarsa.
- [ ] typecheck + commit.

### Task 2: Routes billing + tests

- [ ] `GET /api/billing/status` (requireUser): `{ enabled, entitled, plan? }`.
- [ ] `POST /api/billing/subscribe` (requireUser): nonaktif → 503 `{ error: "billing_dormant" }`.
- [ ] `POST /api/billing/webhook`: nonaktif → 403; aktif → verifikasi signature (401 bila gagal), update Payment/Subscription sesuai `transaction_status` (settlement→paid/aktif, deny/cancel/expire→expired).
- [ ] Tests: signature benar/salah (fixture payload + server key), dormant status, webhook disabled 403, entitlement true saat dormant.
- [ ] typecheck + commit.

### Task 3: Golden set offline

- [ ] `test/golden-set.test.ts`:
  - **Tool-loop stub**: kasus [(prompt, tool yang diharapkan)] dengan Gemini fake mengembalikan functionCall sesuai mapping → jalankan `runToolLoop` → assert tool dieksekusi & permission ditolak bila role kurang (sudah ada pola di tool-loop test — tambah kasus baru berjumlah ≥5, mis. pelanggan, penjualan, campuran, tanpa tool, permission ditolak).
  - **Klasifikasi fixture**: ≥8 kasus teks/nama-file → kategori berlabel; **ambang**: minimal 7/8 benar (akurasi ≥ 87.5%).
- [ ] typecheck + commit.

### Task 4: Aksesibilitas dasar + hardening

- [ ] `security.ts`: middleware header `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` → pasang di `createApp`.
- [ ] Chat.tsx: transcript `aria-live="polite"`, label mic button (`aria-label`), input teks `aria-label`.
- [ ] Explore.tsx: `aria-label` tombol utama, breadcrumb `<nav aria-label="Breadcrumb">`.
- [ ] build + typecheck + commit.

### Task 5: Dokumen listing + checklist rilis

- [ ] `docs/listing/accurate-store.md`: deskripsi add-on, fitur, harga (contoh paket), data yang diakses + privasi, FAQ, screenshot plan (daftar file PNG yang perlu diunggah).
- [ ] `docs/release-checklist.md`: prasyarat (kemitraan CPSsoft, Google sensitive scope review, DNS/Vercel, Midtrans akun, dsb.), langkah aktivasi billing.
- [ ] commit.

### Task 6: Verifikasi akhir + spike + README

- [ ] Root: `pnpm test` + `pnpm typecheck` + build web; smoke phase3 & phase4 ulang (regresi).
- [ ] `docs/spikes/2026-10-11-phase5-release-check.md` + README (Fase 5 selesai, status total proyek).
- [ ] commit.
