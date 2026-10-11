# Cek Fase 3 — Explore Manager (Drive rapikan)

Tanggal: 2026-10-11
Plan: `docs/plans/2026-10-10-phase3-explore-manager.md`

## Hasil verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| `pnpm test` apps/api | **82/82 PASS** (21 file) — termasuk drive-mock 7, drive-classify 10, drive-tidy 5, drive-google 6, drive-routes 7 |
| `pnpm typecheck` (root) | api + web **Done** |
| `pnpm build` apps/web | ✓ built |
| Smoke live `e2e-smoke-phase3.sh` | **13/13 PASS** |

## Smoke 13/13 (mock Accurate + API + web + `MOCK_DRIVE=1`)

1. callback redirect ke /app + sid cookie terpasang
2. drive status `connected:true`, `engine:"mock"`
3. plan job dibuat + berisi aksi move (3 PDF → kategori via Gemini fallback nama-file)
4. run: start → progress → done (NDJSON)
5. jobs JSON array
6. cancel sebelum run → event `cancelled`
7. `GET /api/oauth/google/start` → redirect accounts.google.com (bukan 501; secret terisi)

Skrip: `/tmp/opencode/e2e-smoke-phase3.sh` (cleanup pakai pola bracket anti-self-match).

## Bug yang diperbaiki saat integrasi

1. **Race log**: `driveActionLog.create` fire-and-forget → log belum landing saat run selesai. Dibuat `await` (onProgress async, executePlan await onProgress).
2. **Cancel di-reset**: `run` men-set `cancelFlags=false` saat start → cancel-sebelum-run hilang. Flag dihapus setelah run selesai, bukan di-set awal.
3. **Prefix izin**: route cek `drive.tidy` tapi launch menanam `app:drive.tidy` → 403 `tidak_punya_hak` di jalur nyata (test lolos karena menanam key tanpa prefix). Disamakan ke `app:drive.tidy`.
4. **Mock seed demo**: seed default mock drive kini berisi folder `demo-scan` (3 PDF) + `demo-scan2` (1 PDF) agar mode mock langsung bisa dirapikan dan jalur cancel punya bahan.

## Catatan lingkungan

- Proses `tsx` dipecah: wrapper (`dist/cli.mjs`) + pekerja (`preflight.cjs`) — `pkill` harus memakai pola keduanya; pola di cmdline shell membunuh shell-nya sendiri (pakai `[.]`).
- Neon sempat `P1001 Can't reach database server` (flake) — launch di-smoke diberi retry 3×.
- Cakupan Fase 3: rencana + eksekusi rapikan (create folder, move, rename), log posisi asal untuk undo (fitur undo sendiri di luar scope, menyusul fase admin/audit).
