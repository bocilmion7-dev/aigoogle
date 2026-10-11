# Cek Fase 4 — Admin & Audit

Tanggal: 2026-10-11
Plan: `docs/plans/2026-10-11-phase4-admin-audit.md`

## Hasil verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| `pnpm test` root | **115/115 PASS** (mocks/accurate 23 + apps/api 92; admin.test.ts 10) |
| `pnpm typecheck` (root) | api + web **Done** |
| `pnpm --filter @aigoogle/web build` | ✓ |
| Smoke live `e2e-smoke-phase4.sh` | **18/18 PASS** |

## Isi fase

- **`app-features.ts`** — daftar statis fitur app: `app:users.manage`, `app:settings.manage`, `app:drive.tidy`, `app:chat.history`, `app:audit.view` (+validasi prefix key).
- **`requirePerm(key)`** — middleware gerbang berbasis RolePermission; `req.user` kini memuat `roleId`.
- **`/api/admin/*`** (gerbang `app:users.manage`; audit `app:audit.view`):
  - `GET /roles` — role + permissions; `PUT /roles/:id/permissions` — replace-all (validasi prefix, transaksi, audit `role.permissions.update`).
  - `GET /privileges` — modul dari `capabilityCatalog()` + info mirror `privilegeCatalog()` (bila koneksi Accurate tersedia), + `APP_FEATURES`.
  - `GET /users`; `PUT /users/:id/role` — guard **tidak boleh ubah role sendiri**, audit `user.role.update`.
  - `GET /audit?limit=&action=` — + `userEmail`.
- **`/api/me`** — + `permissions: string[]`.
- **UI `/admin`** — tab User (ganti role), Peran (checklist Modul Accurate + Fitur Aplikasi → simpan), Audit (tabel). Nav "Admin" di Shell hanya tampil bila `app:users.manage`.
- `ensureConnection` chat di-extract ke `providers/accounting/connection.ts` (`accurateCtxFor`) dipakai ulang oleh admin.

## Smoke 18/18 (2 sesi login: admin + staff)

Login admin & staff (mock) → `/me` memuat permissions → roles (admin+staff) → privileges (modules + appFeatures) → PUT role permissions → users (2) → PUT role user → audit berisi `role.permissions.update` & `user.role.update` → staff 403 di audit & roles → vite `/admin` 200.

## Catatan

- Launch seed admin kini menyertakan `app:audit.view` (tenant lama dapat otomatis saat re-launch; manual via PUT permissions bila perlu).
- Guard self-role mencegah admin mengunci dirinya sendiri.
