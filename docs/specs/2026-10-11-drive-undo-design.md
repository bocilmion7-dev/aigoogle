# Spek Desain — Undo Massal Drive (Explore Manager)

**Tanggal:** 2026-10-11  
**Status:** Disetujui pengguna (brainstorming; judgment terbaik)  
**Menindaklanjuti:** spek asli §5.2 / §9 (log posisi asal disiapkan, tombol undo menyusul)

## 1. Tujuan

Setelah job "Rapikan Folder Ini" selesai, user dapat **mengembalikan file** ke posisi semula (folder asal + nama asli) — baik untuk seluruh job maupun subset file terpilih. Folder kategori yang dibuat job **tidak dihapus** (dibiarkan, mungkin kosong).

## 2. Keputusan

| Topi | Keputusan |
|---|---|
| Cakupan undo | Balikkan rename + move file ke `originalParent`; folder kategori dibiarkan |
| Selektif | Default semua file result `ok`; body boleh kirim `fileIds[]` subset |
| Permission | `app:drive.tidy` (sama dengan rapikan) |
| Status job | Bila semua target sukses → `undone` (tidak bisa di-undo lagi). Ada gagal → status tetap, boh retry subset file yang belum sukses |
| Gagal per file | Lanjut file lain; laporan per-file ok/failed |
| Sumber data balik | `resultJson` (`originalParent`/`originalName`) + `planJson` (`toParent`/`toName`) per `fileId`; log = audit, bukan sumber utama |
| Audit | `writeAudit` action `drive.undo` |

## 3. Perbaikan fondasi (wajib)

1. **`DriveClient.move(fileId, newParents, oldParents?)`** — Google: `addParents` + `removeParents` agar pindah benar-benar (bukan akumulasi parent). Mock tetap replace.
2. **Logging run** (`drive.ts` onProgress): isi `toParent` (saat ini hardcode `""`); tetap satu entri log per file `move` yang berhasil/gagal.
3. Skema DB: tanpa migrasi; `DriveJob.status` memakai nilai string baru `undone`.

## 4. API

`POST /api/drive/jobs/:id/undo`  
- Auth: `requireUser` + cek `app:drive.tidy`  
- Body: `{ fileIds?: string[] }` (opsional)  
- Job 404 / bukan milik tenant → 404  
- Job `undone` → 409 `already_undone`  
- Job tanpa `resultJson` berisi item `ok` → 400 `tidak_ada_yang_bisa_diundo`  
- Respons: **NDJSON** seperti `/run`  
  - `start` → `progress`* → `done` `{ jobId, status, items }`  
- Setelah selesai: update `resultJson` digabung dengan field undo (`undoStatus`, `undoError`), status job `undone` bila semua target ok.

## 5. Logika undo (`executeUndo` di `drive/tidy.ts`)

Urutan **terbalik** dari daftar target:
1. Bila `toName` ≠ `originalName` → `rename(fileId, originalName)`  
2. Bila `originalParent` ≠ `toParent` → `move(fileId, originalParent, toParent)`  
3. Gagal → catat error, lanjut  
4. Tulis `DriveActionLog` (`action: "undo_rename"|"undo_move"`)

## 6. UI (`Explore.tsx`)

Panel hasil job `done`:
- Checkbox per file (default tercentang; hanya status `ok`)  
- Tombol **Urungkan** (Soft Utility, radius 4px) — disabled saat `undone` / sedang undo / tidak ada tercentang  
- Progress NDJSON; laporan per-file setelah selesai  
- State: loading, error Indonesia, banner "Sudah diurungkan", retry subset  

API client (`drive-api.ts`): `driveUndo(jobId, fileIds?, onEvent)`.

## 7. Testing

- Unit `executeUndo` (MockDriveClient): balik rename+move; gagal per file lanjut; subset.  
- Unit logging: `toParent` terisi di result onProgress (via executePlan).  
- Route (butuh DB): undo happy path, already_undone, isolasi tenant.  
- Typecheck mock/api/web.

## 8. Out of scope

- Hapus folder kategori  
- Undo untuk job yang dibatalkan sebelum file bergerak  
- Permission undo terpisah  
- Webhook / write ops Accurate (dibatalkan user)
