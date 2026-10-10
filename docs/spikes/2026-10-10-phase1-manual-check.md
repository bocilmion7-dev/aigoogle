# Verifikasi Manual E2E Lokal — Fase 1

Tanggal: 2026-10-10 · Branch: `phase1-fondasi`

Cara: skrip smoke `/tmp/opencode/e2e-smoke.sh` menjalankan 3 proses (mock Accurate :4010, API :3001 dengan `MOCK_ACCURATE_URL=http://localhost:4010`, web :5173) lalu mengecek alur via proxy web.

| # | Butir (plan Task 10) | Hasil |
|---|---|---|
| 1 | `http://localhost:5173/` tanpa login → landing tampil | ✓ (HTML shell + title; render H1 oleh React di client) |
| 2 | `/api/launch?dbId=1001` → authorize mock → auto-kembali → `/app` "PT Maju Jaya · Halo, Admin Demo (admin)" | ✓ (302 → `localhost:4010/oauth/authorize`, state `ls-*`, callback balik ke `/app`, `/api/me` = PT Maju Jaya + `roleKey: admin`) |
| 3 | `/settings`: koneksi Accurate terhubung; ubah suara Gemini → Simpan → reload tetap | ✓ (default `web-speech`, PUT → GET ulang `gemini-native`, `/api/connections` accurate **connected**) |
| 4 | `POST /api/logout` → `/app` kembali ke landing | ✓ (logout 200; `/api/me` sesudahnya 401; tanpa cookie 401) |

**Hasil skrip: PASS=15 FAIL=0** (termasuk cek proxy web → API, prefix state, sid cookie).

## Catatan
- Reset baris `AppSetting.voiceEngine` via psql sebelum cek default (setting bersifat global).
- Klien-side render dicek lewat build hijau + shell HTML; tidak ada browser otomatis di lingkungan ini.
- Token Accurate diuji terhadap **mock**; uji API asli menunggu pendaftaran redirect URI oleh pemilik.
