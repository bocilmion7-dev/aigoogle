# Mock Server Accurate Online

Server tiruan untuk pengembangan Fase 1–2 tanpa credential akun Accurate.
**Bentuk response disamakan dengan API REAL Accurate Online** (lihat `docs/spikes/2026-10-10-accurate-api-findings.md`).

## Jalankan

```bash
pnpm install
pnpm test        # seluruh suite vitest (23 test)
pnpm dev         # http://localhost:4010 (env PORT untuk ganti)
```

## Kontrak (mengikuti bentuk real)

- Envelope: `{ s: true, d: [...], sp? }`; gagal = HTTP 200 + `{ s: false, d: ["pesan"] }`; token/session invalid = HTTP 401.
- Semua endpoint db/modul = **GET**; modul butuh header `Authorization: Bearer` **dan** `X-Session-ID` (session harus milik token yang sama).
- URL modul: `{host}/accurate/api/{module}/{action}.do` — mock: `http://localhost:4010/accurate/api/...`

## Demo

```bash
# 1. OAuth: authorize → code → token
curl -s "http://localhost:4010/oauth/authorize?client_id=c&redirect_uri=http://localhost:3000/cb&state=s" -o /dev/null -D -
# (redirect Location berisi ?code=code-...; tambah &user=staff untuk user staf)

curl -s -X POST http://localhost:4010/oauth/token \
  -H 'Content-Type: application/json' \
  -d '{"grant_type":"authorization_code","code":"code-...","client_id":"c"}'
# → { access_token, refresh_token, expires_in: 1296000 }

# 2. Userinfo & daftar db
curl -s http://localhost:4010/api/userinfo.do -H "Authorization: Bearer $AT"
curl -s http://localhost:4010/api/db-list.do -H "Authorization: Bearer $AT"

# 3. Buka db → session & host (top level)
curl -s "http://localhost:4010/api/open-db.do?id=1001" -H "Authorization: Bearer $AT"
# → { s: true, d: ["Proses Berhasil Dilakukan"], session: "sess-...", host: "http://localhost:4010", admin: true }

# 4. Panggil modul (Bearer + X-Session-ID)
curl -s "http://localhost:4010/accurate/api/customer/list.do" \
  -H "Authorization: Bearer $AT" -H "X-Session-ID: $SESSION"
```

## User demo

| Email | Role mock | Akses modul (db 1001) | admin flag |
|---|---|---|---|
| admin@demo.local | Administrator | semua modul view | true |
| staff@demo.local | Staff Penjualan | sales-entry view saja | false |

## Fixture db

| id | alias | nama | user |
|---|---|---|---|
| 1001 | MAJU | PT Maju Jaya | admin + staff |
| 1002 | SIAP | CV Sejahtera | admin saja |

Kredensial OAuth di mock tidak diverifikasi (client_id bebas) — mock mensimulasikan alur.
