# Spike: API Accurate Online — Temuan (2026-10-10)

Sumber: skema publik `https://account.accurate.id/open-api/json.do` (2,3 MB, 334 path, terunduh tanpa login), halaman resmi `accurate.id/api-integration/api-example/`, GitHub resmi `aol-integration` (php-01..04, accurate-schema-mcp).

## Status per butir spike

| # | Butir | Status | Jawaban |
|---|---|---|---|
| 1 | Parameter launch add-on (dbId/token) | **SEBAGIAN** | OAuth authorize: `https://account.accurate.id/oauth/authorize` (implicit flow di skema; authorization code kemungkinan tersedia — contoh php-01). Mekanisme pemanggilan add-on dari Accurate Store (param persis) → **BUTUH AKUN DEVELOPER** (daftar di `account.accurate.id/developer`). |
| 2 | access-privilege: matriks per-user? | **TERJAWAB** | `access-privilege/list.do` = daftar **Akses Grup** (bukan per-user). `detail.do?id=` = matriks modul × hak grup. **Pemetaan user→grup TIDAK tersedia di API publik.** Yang per-user hanya: `db-list.do` memberi `admin: true/false` + `dataAccessType: "ADMIN"` per db. |
| 6 | Scope OAuth final per modul | **TERJAWAB** | 223 scope = 81 modul × view/save/delete. Daftar 81 modul `*_view` tercatat di bawah. Scope final dipilih saat registrasi aplikasi (mulai dari modul read). |

## Envelope response (REAL — berbeda dari mock!)

Bentuk asli (dari dokumentasi resmi + accurate-schema-mcp):

```json
// sukses list (db-list.do, customer/list.do, dst.)
{ "s": true, "d": [ ...rows... ], "sp": { "page": 1, "sort": null, "pageSize": 20, "pageCount": 2, "rowCount": 22, "start": 0, "limit": null } }

// open-db.do — session & host di TOP LEVEL, bukan di d
{ "s": true, "d": ["Proses Berhasil Dilakukan"], "session": "7ff8...", "host": "https://public.accurate.id", "admin": true, "trial": true, ... }

// save.do
{ "r": { ...record... }, "s": true, "d": ["pesan sukses"] }

// GAGAL: HTTP 200 + { "s": false } (juga bisa HTTP 401 untuk token invalid)
```

Catatan: `s` = **boolean**; `d` = **array** (rows atau pesan); pagination `sp`; record `r`. **Ini berbeda dari kontrak mock** `{ s: { status, message? }, d: any }`.

## Endpoint OAuth & API dasar (server `https://account.accurate.id`)

| Endpoint | Method | Keterangan |
|---|---|---|
| `/oauth/authorize` | GET | authorizationUrl resmi dari securitySchemes |
| `/api/db-list.do` | GET + Bearer | daftar db: `id` (int), `alias`, `admin` (bool), `dataAccessType`, `trial`, `expired`, `licenseEnd`, `accessibleUntil` |
| `/api/open-db.do?id={id}` | GET + Bearer | → `{ session, host, admin, ... }`; host tanpa suffix `/accurate` |
| `/api/userinfo.do` | GET + Bearer | klaim OAuth user |
| `/api/auth-info.do` | GET + Bearer | info user dari token |
| `/api/approved-scope.do` | GET + Bearer | scope yang disetujui token aktif |
| `/api/db-check-session.do`, `/api/db-refresh-session.do`, `/api/db-status.do`, `/api/db-detail.do` | GET | manajemen sesi db |

## API modul (server `https://{cloud}.accurate.id/accurate`, default cloud `zeus`)

- URL lengkap: `{host}/accurate/api/{module}/{action}.do` (contoh resmi: `https://public.accurate.id/accurate/api/item/list.do`)
- **Semua GET** (query string untuk filter/fields), header: `Authorization: Bearer` + `X-Session-ID`
- Auth: **Bearer token tetap dibutuhkan di panggilan modul** (bukan X-Session-ID saja)
- Parameter filter pola: `filter.{field}.op` (EQUAL, CONTAIN, dst.) + `filter.{field}.val`, `fields=id,name,no`, pagination query standar
- Modul & akses: `customer`, `sales-entry`, `purchase-invoice`, `glaccount`, `item`, `vendor`, `access-privilege`, dst. (81 modul view)

## access-privilege — bentuk & pemetaan

- `list.do` → daftar Akses Grup (id, name) di db tsb; scope `access_privilege_view`
- `detail.do?id=` → matriks modul × hak (AllowView/AllowCreate/… — field persis belum ada di skema response; verifikasi live saat credential tersedia)
- **Tidak ada** endpoint user→grup. Rekomendasi fallback (untuk spek §4): user baru = role dasar hasil kombinasi `admin` flag dari db-list + checklist manual oleh Admin; mirror per-user tunggu mekanisme dari CPSsoft.

## Daftar modul *_view (81)

access_privilege, account_budget_target, approval, asset_transfer, attachment, auto_number, bank_statement, bank_transfer, bill_of_material, bom_process_category, branch, cogs_monitoring, comment, contact, currency, customer, customer_category, customer_claim, dashboard, data_classification, delivery_order, department, employee, employee_payment, exchange_invoice, expense_accrual, finished_good_slip, fixed_asset, fob, freeonboard, glaccount, item, item_adjustment, item_brand, item_category, item_transfer, job_order, journal_voucher, manufacture_order, material_adjustment, material_equipment, material_slip, online_order, other_deposit, other_payment, payment_term, preliminary_survey, price_category, process_stages, project, project_contractor, purchase_invoice, purchase_order, purchase_payment, purchase_requisition, purchase_return, receive_item, recognition, roll_over, sales_checkin, sales_invoice, sales_order, sales_quotation, sales_receipt, sales_return, salesman_commission, sellingprice_adjustment, shipment, standard_product_cost, stock_mutation_history, stock_opname_order, stock_opname_result, tax, unit, vendor, vendor_category, vendor_claim, vendor_price, warehouse, wo_person_in_charge, work_order

## Gap yang butuh akun developer CPSsoft

1. Mekanisme launch add-on dari Accurate Store (nama param: code? token? dbId?) — tanya CPSsoft / uji saat terdaftar.
2. Bentuk field matriks `access-privilege/detail.do` (AllowView dll.) — verifikasi live.
3. Ketersediaan authorization code flow (vs implicit) untuk server-side app — uji via php-01 sebagai referensi.

## Keputusan untuk mock & Fase 1

1. ~~Mock saat ini memakai kontrak mock~~ **DIPUTUSKAN (checkpoint batch 1): mock disamakan ke bentuk REAL** (s: boolean, d: array, GET, session/host top-level, sp pagination, Bearer + X-Session-ID).
2. Mock base URL: `http://localhost:4010`; mapping: `{host}` real ≈ mock origin; path modul real `{host}/accurate/api/...` = mock `/accurate/api/...` ✓ (sudah cocok).
3. Fixture: db 1001 "PT Maju Jaya" (admin+staff), db 1002 "CV Sejahtera" (admin saja); user demo admin@demo.local, staff@demo.local.
4. Adapter Fase 1 menerjemahkan real↔internal; mock idealnya = bentuk real agar parser diuji sekali.
5. Pemetaan user→privilege: **fallback disarankan** — `admin:true` dari db-list → role Admin; selain itu role dasar + checklist manual.
