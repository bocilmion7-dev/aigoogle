# Phase 6 Check — Perbaikan Nama Modul + Perluasan Tool Accurate

**Tanggal:** 2026-10-11
**Branch:** `phase6-api-alignment`
**Plan:** `docs/plans/2026-10-11-phase6-accurate-api-alignment.md`

## Tabel sebelum / sesudah

| Aspek | Sebelum | Sesudah |
|---|---|---|
| Mock path penjualan | `/accurate/api/sales-entry/list.do` | `/accurate/api/sales-invoice/list.do` |
| Mock path pembelian | (tidak ada) | `/accurate/api/purchase-invoice/list.do` |
| Mock path akun | (tidak ada) | `/accurate/api/glaccount/list.do` |
| Mock `ping.do` | ada | **dihapus** (404) |
| Data store key | `salesEntries` | `salesInvoices` (+ items, vendors, glAccounts, salesOrders, salesReceipts, purchaseInvoices) |
| Permission key | `accurate:sales-entry.view` | `accurate:sales-invoice.view` |
| Tool catalog | 2 (`customer.list`, `salesEntry.list`) | **10** (customer.list/detail, salesInvoice.list/detail, salesOrder.list, item.list, vendor.list, glAccount.list, purchaseInvoice.list, salesReceipt.list) |
| Adapter query | tanpa args | resmi: `fields`, `keywords`, `sp.page/pageSize/sort`, `filter.{f}.op/.val` |
| Golden set | 5 prompt | 8 prompt (+item, COA, vendor) |
| Helper mock | router manual per modul | `makeListRouter` (list+detail+privilege, DRY) |

## Hasil suite

| Suite | Sebelum | Sesudah |
|---|---|---|
| `@mock/accurate` | 23/23 | **26/26** |
| `@aigoogle/api` offline (accurate-execute + golden-set + tool-loop) | 28/28 | **34/34** |
| golden-set | 17 | **20** |
| typecheck mock/api/web | OK | **OK** |

Catatan: suite API yang butuh DB Neon (`oauth-launch`, `admin`, `chat-stream`, `chat-gemini-live`, `audio-real`) tidak dapat dijalankan di environment ini — koneksi ke `ep-icy-frog-…neon.tech:5432` ditolak. Baseline sebelum perubahan pun sudah gagal di suite tersebut.

## Hasil smoke live mock (`/tmp/opencode/e2e-smoke-phase6.sh`)

**12/12 PASS:**
1. mock `/health` ok
2. api :3001 listen
3. oauth token issued
4. open-db session
5. `sales-invoice/list.do` s true
6. `ping.do` → 404
7–12. `item/vendor/glaccount/sales-order/sales-receipt/purchase-invoice/list.do` s true
13. item query `fields=code,name&keywords=A4&sp.pageSize=1` → Kertas A4
14. `GET /api/launch?dbId=1001` → 302 (redirect OAuth; persist tenant butuh DB Neon — SKIP di env ini)

## Deviasi dari plan

1. **Task 4 — `ALL_MODULES` di `store.ts`**: plan tidak menyebut expand daftar modul saat menambah 6 modul baru. Tanpa ini admin tidak punya privilege row → semua modul baru ditolak. Diperbaiki: `ALL_MODULES` kini 8 modul resmi.
2. **Task 4 — `makeListRouter` rows typing**: plan memakai `rows: (db) => Row[]`, tapi interface fixture (`SalesInvoice`, dll) tidak punya index signature → typecheck gagal. Diperbaiki: parameter `readonly unknown[]` + cast internal.
3. **Task 7 smoke DB**: plan mengasumsikan DB Neon tersedia. Di env ini Neon tidak terjangkau → smoke memverifikasi mock langsung + adapter path; launch sampai redirect 302 (sebelum persist). Verifikasi persist tenant/role/permission menunggu env dengan DB.

## Sisa gap (out of scope sesuai plan)

- Operasi tulis (`save.do`, `delete.do`, bulk, dp, manual-close).
- ~65 modul Accurate lainnya (POS, produksi, fixed-asset, report khusus).
- Webhook Accurate.
- Migrasi data permission di DB produksi (belum ada produksi).

## Komitmen

```
479673b fix(mock-accurate): rename sales-entry → sales-invoice sesuai API asli
2445452 fix(mock-accurate): hapus ping.do tidak resmi; test session pakai customer/list.do
d2cfdc5 fix(api): adapter+catalog salesInvoice.list path /sales-invoice & permission accurate:sales-invoice.view
9327035 feat(mock-accurate): modul item/vendor/glaccount/sales-order/sales-receipt/purchase-invoice + factory list/detail + query resmi
6c88e9c feat(api): query builder resmi (fields/keywords/sp/filter) + 8 tool read Accurate baru
5837818 test(api): golden set +3 prompt (item, COA, vendor)
```
