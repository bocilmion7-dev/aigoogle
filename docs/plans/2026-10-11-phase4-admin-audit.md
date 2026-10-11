# Fase 4 — Admin & Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. (User memilih eksekusi INLINE — tanpa sub-agent, tanpa code-quality review sub-agent; verifikasi = test + typecheck hijau.)

**Goal:** Hak akses dikelola dinamis: editor role checklist (modul Accurate + fitur app), manajemen user (ganti role), tampilan audit log — semua bergerbang permission `app:*`.

**Architecture:** Sumber daftar modul = `AccountingProvider.capabilityCatalog()` (tool AI → `requiredPermission`), diperkaya info mirror dari `privilegeCatalog()` (grup hak akses Accurate → modul yang diizinkan). Fitur app = daftar statis `APP_FEATURES` (`app:users.manage`, `app:settings.manage`, `app:drive.tidy`, `app:chat.history`, `app:audit.view`). Endpoint `/api/admin/*` digate `requirePerm`; `/api/me` ikut mengekspos `permissions` agar UI hanya merender yang diizinkan. Audit ditulis untuk setiap perubahan role/permission.

**Tech Stack:** Express + Prisma/Neon (sudah ada), React+Vite (sudah ada), Vitest + supertest.

---

## Peta File

| File | Tanggung jawab |
|---|---|
| `apps/api/src/app-features.ts` | Daftar statis fitur app (key + label ID) |
| `apps/api/src/permissions.ts` | (Modify) +`requirePerm(key)` middleware express |
| `apps/api/src/routes/launch.ts` | (Modify) seed admin + `app:audit.view` |
| `apps/api/src/routes/admin.ts` | Endpoints roles/privileges/users/audit |
| `apps/api/src/routes/me.ts` | (Modify) `/me` + `permissions: string[]` |
| `apps/api/src/app.ts` | (Modify) mount adminRouter |
| `apps/web/src/api.ts` | (Modify) client admin (REST biasa) |
| `apps/web/src/pages/Admin.tsx` | UI: tab Users / Peran / Audit |
| `apps/web/src/App.tsx`, `Shell.tsx` | (Modify) route `/admin` + nav (gerbang `app:users.manage`) |
| `apps/api/test/admin.test.ts` | Test gerbang + roles + users + audit + /me |

**Aturan safety:** tidak boleh mengubah role diri sendiri (guard `self-role`); permission key tervalidasi prefix `accurate:` / `app:`; semua perubahan ditulis ke `AuditLog`.

---

### Task 1: Katalog fitur app + middleware requirePerm + seed launch

**Files:** Modify `apps/api/src/app-features.ts` (baru), `apps/api/src/permissions.ts`, `apps/api/src/routes/launch.ts`

- [ ] `app-features.ts`:

```ts
export interface AppFeature { key: string; label: string }
export const APP_FEATURES: AppFeature[] = [
  { key: "app:users.manage", label: "Kelola User & Role" },
  { key: "app:settings.manage", label: "Pengaturan" },
  { key: "app:drive.tidy", label: "Rapikan Drive (Explore)" },
  { key: "app:chat.history", label: "Riwayat Chat" },
  { key: "app:audit.view", label: "Lihat Log Audit" },
];
export const APP_PERMISSION_PREFIXES = ["app:", "accurate:"] as const;
```

- [ ] `permissions.ts` tambah:

```ts
export function requirePerm(key: string) {
  return asyncHandler(async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "belum_login" });
    const set = await loadPermissionSet(req.user.roleId);
    if (!set.has(key)) return res.status(403).json({ error: "tidak_punya_hak" });
    next();
  });
}
```

Tambahan: `req.user.roleId` harus ikut diisi — modify `middleware/session.ts` agar `req.user` memuat `roleId`.
`asyncHandler` di-import dari `./asyncHandler.js`.

- [ ] `launch.ts`: tambah `"app:audit.view"` ke array seed admin.
- [ ] typecheck + test suite hijau + commit `feat(fase4): katalog fitur app + middleware requirePerm`.

### Task 2: Routes admin — roles + privileges

**Files:** `apps/api/src/routes/admin.ts` (baru), `apps/api/src/app.ts`

- [ ] `GET /api/admin/roles` (gate `app:users.manage`): daftar role + `permissions[]` (rolePermission).
- [ ] `GET /api/admin/privileges` (gate): `{ modules: [{ key, label, mirrorChecked }], appFeatures: APP_FEATURES }`
  - `modules` = unique `requiredPermission` dari `provider.capabilityCatalog()`; `label` = judul tool pertama yang punya permission itu.
  - `mirrorChecked` = true bila ada grup di `privilegeCatalog(ctx)` yang mengizinkan modul (normalisasi nama modul: lowercase + spasi/underscore → `-`; cocokkan infix pada permission key).
  - Bila koneksi Accurate belum ada → modules tetap dari catalog, `mirrorChecked: false` (tanpa error).
- [ ] `PUT /api/admin/roles/:id/permissions` (gate): body `{ permissions: string[] }`.
  - Validasi tiap key prefix `accurate:`/`app:`; role harus milik tenant yang sama.
  - Replace all dalam transaction (`deleteMany` + `createMany`).
  - `writeAudit(tenantId, userId, "role.permissions.update", { roleKey, permissions })`.
- [ ] mount `adminRouter` di `app.ts`.
- [ ] typecheck + commit.

### Task 3: Routes admin — users + role

- [ ] `GET /api/admin/users` (gate `app:users.manage`): `[{ id, name, email, roleKey }]` (urut name).
- [ ] `PUT /api/admin/users/:id/role` (gate): body `{ roleKey }`.
  - User + role harus satu tenant; `roleKey` harus ada di tenant itu.
  - **Guard:** `id === req.user.id` → 400 `{ error: "tidak_boleh_ubah_role_sendiri" }`.
  - `writeAudit(..., "user.role.update", { userId, roleKey })`.
- [ ] typecheck + commit.

### Task 4: Routes admin — audit log + /me permissions

- [ ] `GET /api/admin/audit?limit=50&action=` (gate `app:audit.view`): limit max 200, desc by createdAt; sertakan `userEmail` (join manual via user ids); filter `action` bila diisi.
- [ ] `routes/me.ts`: `/me` response + `permissions: string[]` (dari `loadPermissionSet(req.user.roleId)`); butuh asyncHandler.
- [ ] typecheck + commit.

### Task 5: UI Admin (tab Users / Peran / Audit)

**Files:** `apps/web/src/api.ts` (Modify), `apps/web/src/pages/Admin.tsx` (baru), `App.tsx` + `Shell.tsx` (Modify)

- [ ] `api.ts`: `getRoles`, `getPrivileges`, `putRolePermissions`, `getAdminUsers`, `putUserRole`, `getAuditLogs`.
- [ ] `Admin.tsx`:
  - Tab **User**: tabel nama/email/select role (opsi dari roles) → PUT role; pesan error guard ditampilkan.
  - Tab **Peran**: pilih role → dua blok checklist: "Modul Accurate" (mirrorChecked sebagai default awal) + "Fitur Aplikasi" → Simpan (PUT replace-all).
  - Tab **Audit**: tabel waktu/user/action/detail JSON (ringkas).
  - Sistem tab state sederhana, gaya kartu sama dengan Settings.tsx.
- [ ] `App.tsx`: route `/admin`; `Shell.tsx`: link "Admin" hanya bila `me.permissions?.includes("app:users.manage")`. Perlu tipe `Me` di shared + `permissions?: string[]`.
- [ ] build + typecheck + commit.

### Task 6: Test admin + smoke + docs

**Files:** `apps/api/test/admin.test.ts` (baru), `/tmp/opencode/e2e-smoke-phase4.sh`, `docs/spikes/2026-10-10-phase4-admin-check.md`, `README.md`

- [ ] Test (tenant+role admin+staff seed sendiri, cookie dua user):
  1. `/api/admin/roles` tanpa login → 401; dengan user tanpa `app:users.manage` → 403.
  2. GET roles → array berisi admin+staff dengan permissions.
  3. PUT permissions admin → replace (mis. hanya `["app:users.manage","accurate:customer.view"]`) → GET memantulkan; key sampah (`foo:bar`) → 400.
  4. GET users → 2 user; PUT role staff→admin OK (audit `user.role.update`); PUT role diri sendiri → 400.
  5. GET audit (gate `app:audit.view`) → berisi entri role.permissions.update & user.role.update dengan userEmail.
  6. `/api/me` mengandung `permissions` berisi `app:users.manage` untuk admin.
- [ ] Smoke live: launch mock (admin lalu staff) → roles/privileges/users/audit/me → PUT permission → PUT role → audit bertambah → `/admin` (vite) 200.
- [ ] Dokumen `docs/spikes/2026-10-10-phase4-admin-check.md` + README (Fase 4 selesai) + verifikasi akhir root test/typecheck/build + commit.
