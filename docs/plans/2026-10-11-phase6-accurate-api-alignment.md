# Phase 6: Perbaikan Nama Modul + Perluasan Tool Accurate — Implementation Plan

> **Status: SELESAI (2026-10-11)** — semua task dikerjakan di branch `phase6-api-alignment`. Hasil: `docs/spikes/2026-10-11-phase6-api-alignment-check.md` (suite mock 26/26, api offline 34/34, smoke 12/12, typecheck OK).

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task (inline only — subagent mati di workspace ini). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Samakan nama modul mock/adapter dengan API Accurate asli (`sales-invoice`, `purchase-invoice`, `glaccount`), dukung query param resmi (`fields`, `sp.*`, `filter.*`, `keywords`), dan perluas `ACCURATE_CATALOG` + mock dengan tool read inti agar chat AI bisa menjawab pertanyaan akuntansi umum.

**Architecture:** Rename menyeluruh mock module path + store privileges + adapter path + permission key. Adapter `execute()` membangun query string resmi dari `args`. Mock modul baru mengikuti pola `list.do`/`detail.do` + proteksi `AllowView` yang sudah ada. Catalog bertambah tool `*.list`/`*.detail` dengan `jsonSchema` yang meneruskan argumen ke provider.

**Tech Stack:** pnpm monorepo (apps/api Express+Prisma, apps/web React+Vite, mocks/accurate Express), Vitest, TypeScript ESM NodeNext.

**Sumber kebenaran:** `docs/spikes/accurate-api-docs-modules.json` + `docs/spikes/accurate-openapi.json` (filter = `filter.{field}.op` + `filter.{field}.val`; paging = `sp.page`, `sp.pageSize`, `sp.sort`; `fields` koma; `keywords`).

---

## Scope

**In scope**
1. Rename: `sales-entry`→`sales-invoice`, `purchase-entry`→`purchase-invoice`, `account`→`glaccount` (mock path, store, fixtures, adapter path, permission key, semua test/seed terkait).
2. Hapus mock `/api/ping.do` (tidak ada di API asli) — ganti test session pakai endpoint nyata.
3. Adapter: dukung query resmi `fields`, `keywords`, `page`, `pageSize`, `sort`, `filter` dari `args`.
4. Tool catalog baru (read-only): `customer.detail`, `salesInvoice.list`, `salesInvoice.detail`, `salesOrder.list`, `item.list`, `vendor.list`, `glAccount.list`, `purchaseInvoice.list`, `salesReceipt.list` (+ rename `salesEntry.list`→`salesInvoice.list`).
5. Mock modul baru: `item`, `vendor`, `glaccount`, `sales-order`, `sales-receipt`, `purchase-invoice` (+ `detail.do` untuk modul yang punya tool detail).
6. Seed privileges admin launch otomatis ikut catalog (sudah map `capabilityCatalog()` — cukup catalog benar).
7. Golden set + tool-loop + chat tests disesuaikan nama tool/permission.

**Out of scope (YAGNI / risiko tinggi)**
- Operasi tulis (`save.do`, `delete.do`, bulk, dp, manual-close).
- ~65 modul lain (POS, produksi, fixed-asset, report khusus, dst.).
- Webhook Accurate.
- Migrasi data permission di DB produksi (belum ada produksi; permission di-seed saat launch).

**Naming convention (KEPUTUSAN)**
- Path mock & adapter = nama modul resmi (`sales-invoice`, dst.).
- Permission key app = `accurate:{modul-resmi}.view` (mis. `accurate:sales-invoice.view`) agar `normalizeModule()` di admin mirror match scope `sales_invoice_view`.
- Nama tool AI = camelCase (`salesInvoice.list`, `glAccount.list`) — deskripsi tetap Bahasa Indonesia.

---

## File map

| Aksi | Path |
|---|---|
| Rename/delete | `mocks/accurate/src/modules/sales-entry.ts` → `sales-invoice.ts` |
| Create | `mocks/accurate/src/modules/{item,vendor,glaccount,sales-order,sales-receipt,purchase-invoice}.ts` |
| Create | `mocks/accurate/src/modules/list-factory.ts` (helper list+detail+privilege, DRY 6 modul baru) |
| Modify | `mocks/accurate/src/store.ts` (ALL_MODULES, data, priv-staff) |
| Modify | `mocks/accurate/src/api-router.ts` (mount path, hapus ping) |
| Modify | `mocks/accurate/test/{modules,access-privilege,db-session}.test.ts` |
| Modify | `apps/api/src/providers/accounting/accurate.ts` (path, query builder, detail) |
| Modify | `apps/api/src/providers/accounting/catalog.ts` (10 tool) |
| Modify | `apps/api/test/{accurate-execute,golden-set,tool-loop,chat-stream,chat-gemini-live,admin,oauth-launch}.test.ts` |
| Modify | `mocks/accurate/README.md` |
| Create | `docs/spikes/2026-10-11-phase6-api-alignment-check.md` |

---

## Task 1: Rename mock `sales-entry` → `sales-invoice` + store

**Files:** `mocks/accurate/src/modules/sales-invoice.ts` (baru, ganti file lama), `mocks/accurate/src/store.ts`, `mocks/accurate/src/api-router.ts`, `mocks/accurate/test/modules.test.ts`, `mocks/accurate/test/access-privilege.test.ts`

- [x] **Step 1: Tulis test gagal dulu**

Edit `mocks/accurate/test/modules.test.ts` — ganti nama test & path:

```ts
  it("staff db 1001: sales-invoice boleh", async () => {
    const { sid, bearer } = await session("1001", "user-staff");
    const res = await request(app).get("/accurate/api/sales-invoice/list.do")
      .set("Authorization", bearer).set("X-Session-ID", sid);
    expect(res.body.s).toBe(true);
    expect(res.body.d[0].total).toBe(2500000);
  });
```

Edit `mocks/accurate/test/access-privilege.test.ts` — ganti `sales-entry`→`sales-invoice`, `account`→`glaccount` di assertions:

```ts
  it("detail.do staff → sales-invoice true, glaccount false", async () => {
    // ... setup sama ...
    expect(byMod["sales-invoice"]).toBe(true);
    expect(byMod["glaccount"]).toBe(false);
  });
```

- [x] **Step 2: Jalankan test — EXPECT FAIL (404 path)**

Run: `pnpm --filter @mock/accurate test`
Expected: FAIL di test sales-invoice & access-privilege.

- [x] **Step 3: Rename file module + store + router**

`git mv mocks/accurate/src/modules/sales-entry.ts mocks/accurate/src/modules/sales-invoice.ts` lalu edit isi:

```ts
import { Router } from "express";
import { sessionGuard, ok, fail, sp } from "../session.js";
import { getDb, privilegeOf } from "../store.js";

export const salesInvoiceRouter = Router();

salesInvoiceRouter.get("/list.do", sessionGuard, (req, res) => {
  const { dbId, userId } = req.mockCtx!;
  if (!privilegeOf(dbId, userId, "sales-invoice")?.AllowView) {
    return res.json(fail(["Anda tidak punya akses modul sales-invoice"]));
  }
  const rows = getDb(dbId)!.data.salesInvoices;
  res.json(ok(rows, { sp: sp(rows.length) }));
});
```

Edit `store.ts`:
- `SalesEntry` → `SalesInvoice` dengan field `no`, `customerName`, `date`, `total`, `status`.
- `ALL_MODULES = ["customer", "sales-invoice", "purchase-invoice", "glaccount"]`.
- `priv-staff`: `priv(["sales-invoice"], true)`.
- data key `salesEntries` → `salesInvoices`; fixture: `{ id: "SI-001", no: "FJ/2026/0001", customerName: "Budi Santoso", date: "2026-10-01", total: 2500000, status: "Posted" }` dan db 1002 serupa.
- Tambah placeholder data kosong untuk modul baru (Task 4): `items: []`, `vendors: []`, `glAccounts: []`, `salesOrders: []`, `salesReceipts: []`, `purchaseInvoices: []` — boleh diisi fixture di Task 4; untuk Task 1 cukup type + array kosong agar compile.

Edit `api-router.ts`:

```ts
import { salesInvoiceRouter } from "./modules/sales-invoice.js";
// ...
apiRouter.use("/sales-invoice", salesInvoiceRouter);
```

- [x] **Step 4: Jalankan test mock — EXPECT PASS**

Run: `pnpm --filter @mock/accurate test`
Expected: semua PASS.

- [x] **Step 5: Commit**

```bash
git -C /root/aigoogle add mocks/accurate
git -C /root/aigoogle -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "fix(mock-accurate): rename sales-entry → sales-invoice sesuai API asli"
```

---

## Task 2: Hapus `ping.do` + perbaiki test session

**Files:** `mocks/accurate/src/api-router.ts`, `mocks/accurate/test/db-session.test.ts`

- [x] **Step 1: Edit test session — pakai `customer/list.do`**

Ganti blok terakhir `db-session.test.ts`:

```ts
  it("modul butuh Bearer + X-Session-ID; session harus milik token yang sama", async () => {
    const tanpaAuth = await request(app).get("/accurate/api/customer/list.do");
    expect(tanpaAuth.status).toBe(401);
    const { body: open } = await request(app).get("/api/open-db.do?id=1001").set("Authorization", bearer());
    const okRes = await request(app).get("/accurate/api/customer/list.do")
      .set("Authorization", bearer()).set("X-Session-ID", open.session);
    expect(okRes.status).toBe(200);
    expect(okRes.body.s).toBe(true);
    const mismatch = await request(app).get("/accurate/api/customer/list.do")
      .set("Authorization", bearerStaff()).set("X-Session-ID", open.session);
    expect(mismatch.status).toBe(401);
  });
```

- [x] **Step 2: Hapus route ping**

`api-router.ts` — hapus:

```ts
apiRouter.get("/ping.do", sessionGuard, (req, res) => {
  res.json(ok([{ ...req.mockCtx }]));
});
```

- [x] **Step 3: Test PASS → Commit**

Run: `pnpm --filter @mock/accurate test` → PASS.
```bash
git -C /root/aigoogle add mocks/accurate
git -C /root/aigoogle -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "fix(mock-accurate): hapus ping.do tidak resmi; test session pakai customer/list.do"
```

---

## Task 3: Rename adapter path + catalog tool + permission key

**Files:** `apps/api/src/providers/accounting/accurate.ts`, `catalog.ts`, `apps/api/test/accurate-execute.test.ts`, `golden-set.test.ts`, `tool-loop.test.ts`, `chat-stream.test.ts`, `chat-gemini-live.test.ts`, `admin.test.ts`, `oauth-launch.test.ts`

- [x] **Step 1: Edit test dulu (ganti string)**

`accurate-execute.test.ts`:
- `adapter.execute("salesEntry.list", …)` → `"salesInvoice.list"`.
- `expect(admin.allowViewModules).toEqual(expect.arrayContaining(["customer", "sales-entry"]))` → `["customer", "sales-invoice"]`.
- capabilityCatalog expectation tetap `["customer.list", "salesInvoice.list"]` setelah rename.

`golden-set.test.ts`:
- TOOLS entry: `{ name: "salesInvoice.list", …, requiredPermission: "accurate:sales-invoice.view", … }`.
- cases: tool `salesInvoice.list`, permissions `["accurate:customer.view", "accurate:sales-invoice.view"]`.
- negative case: functionCall name `salesInvoice.list`, expect trace tool `salesInvoice.list`.

`tool-loop.test.ts`: semua `salesEntry.list`→`salesInvoice.list`, `accurate:sales-entry.view`→`accurate:sales-invoice.view`.

`chat-stream.test.ts`, `chat-gemini-live.test.ts`: seed permission `accurate:sales-invoice.view`.

`admin.test.ts`: seed + expect `accurate:sales-invoice.view`.

`oauth-launch.test.ts`: expect arrayContaining `accurate:sales-invoice.view`.

- [x] **Step 2: Jalankan API test — EXPECT FAIL**

Run: `pnpm --filter @aigoogle/api test` (atau `pnpm --filter api test` — cek nama package di `apps/api/package.json`).
Expected: FAIL (tool/permission lama di src).

- [x] **Step 3: Edit src**

`catalog.ts` — rename entry:

```ts
  {
    name: "salesInvoice.list",
    description: "Ambil daftar faktur penjualan: nomor, pelanggan, tanggal, total, status",
    jsonSchema: { type: "object", properties: {} },
    requiredPermission: "accurate:sales-invoice.view",
    label: "Mengambil data faktur penjualan…",
  },
```

`accurate.ts` — path map:

```ts
    const paths: Record<string, string> = {
      "customer.list": "/accurate/api/customer/list.do",
      "salesInvoice.list": "/accurate/api/sales-invoice/list.do",
    };
```

- [x] **Step 4: Test PASS → Commit**

Run: `pnpm --filter @aigoogle/api test` → PASS.
```bash
git -C /root/aigoogle add apps/api
git -C /root/aigoogle -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "fix(api): adapter+catalog salesInvoice.list path /sales-invoice & permission accurate:sales-invoice.view"
```

---

## Task 4: Mock modul baru (list+detail) + fixture

**Files:** `mocks/accurate/src/modules/list-factory.ts` (baru), 6 modul baru, `store.ts`, `api-router.ts`, `mocks/accurate/test/modules.test.ts`

- [x] **Step 1: Helper factory**

`list-factory.ts`:

```ts
import { Router } from "express";
import { sessionGuard, ok, fail, sp } from "../session.js";
import { getDb, privilegeOf, type MockDb } from "../store.js";

export type Row = Record<string, unknown>;

export function makeListRouter(opts: {
  module: string;
  rows: (db: MockDb) => Row[];
  fieldsForDetail?: string[];
}): Router {
  const r = Router();
  r.get("/list.do", sessionGuard, (req, res) => {
    const { dbId, userId } = req.mockCtx!;
    if (!privilegeOf(dbId, userId, opts.module)?.AllowView) {
      return res.json(fail([`Anda tidak punya akses modul ${opts.module}`]));
    }
    let rows = opts.rows(getDb(dbId)!);
    const kw = String(req.query.keywords ?? "");
    if (kw) {
      rows = rows.filter((row) =>
        Object.values(row).some((v) => String(v ?? "").toLowerCase().includes(kw.toLowerCase()))
      );
    }
    const fields = String(req.query.fields ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (fields.length) {
      rows = rows.map((row) => Object.fromEntries(fields.filter((f) => f in row).map((f) => [f, row[f]])));
    }
    const page = Math.max(1, Number(req.query["sp.page"] ?? 1) || 1);
    const pageSize = Math.max(1, Number(req.query["sp.pageSize"] ?? 20) || 20);
    const start = (page - 1) * pageSize;
    const paged = rows.slice(start, start + pageSize);
    res.json(ok(paged, { sp: { page, pageSize, rowCount: rows.length, pageCount: Math.ceil(rows.length / pageSize), start, sort: null, limit: null } }));
  });
  if (opts.fieldsForDetail?.length) {
    r.get("/detail.do", sessionGuard, (req, res) => {
      const { dbId, userId } = req.mockCtx!;
      if (!privilegeOf(dbId, userId, opts.module)?.AllowView) {
        return res.json(fail([`Anda tidak punya akses modul ${opts.module}`]));
      }
      const id = String(req.query.id ?? "");
      const row = opts.rows(getDb(dbId)!).find((x) => String(x.id) === id);
      if (!row) return res.json(fail(["Data tidak ditemukan"]));
      res.json(ok([row]));
    });
  }
  return r;
}
```

- [x] **Step 2: Isi fixture store + type**

`store.ts` tambah interface & data fixture (db 1001 + 1002):

```ts
export interface Item { id: string; code: string; name: string; unit: string; sellingPrice: number; }
export interface Vendor { id: string; code: string; name: string; }
export interface GlAccount { id: string; code: string; name: string; type: "Asset" | "Liability" | "Equity" | "Revenue" | "Expense"; }
export interface SalesOrder { id: string; no: string; customerName: string; date: string; total: number; status: string; }
export interface SalesReceipt { id: string; no: string; customerName: string; date: string; amount: number; }
export interface PurchaseInvoice { id: string; no: string; vendorName: string; date: string; total: number; status: string; }
```

Fixture db 1001 (db 1002 minimal 1–2 row serupa):

```ts
      items: [
        { id: "I-01", code: "BRG-001", name: "Kertas A4", unit: "Rim", sellingPrice: 55000 },
        { id: "I-02", code: "BRG-002", name: "Tinta Printer", unit: "Botol", sellingPrice: 120000 },
      ],
      vendors: [
        { id: "V-01", code: "SUP-001", name: "CV Sentosa Mandiri" },
        { id: "V-02", code: "SUP-002", name: "PT Bahan Bangunan" },
      ],
      glAccounts: [
        { id: "G-1000", code: "1000", name: "Kas", type: "Asset" },
        { id: "G-1100", code: "1100", name: "Bank", type: "Asset" },
        { id: "G-4000", code: "4000", name: "Penjualan", type: "Revenue" },
        { id: "G-5000", code: "5000", name: "Harga Pokok Penjualan", type: "Expense" },
      ],
      salesOrders: [
        { id: "SO-001", no: "SJ/2026/0001", customerName: "Budi Santoso", date: "2026-09-28", total: 2500000, status: "Posted" },
      ],
      salesReceipts: [
        { id: "SR-001", no: "PK/2026/0001", customerName: "Budi Santoso", date: "2026-10-02", amount: 2500000 },
      ],
      purchaseInvoices: [
        { id: "PI-001", no: "FB/2026/0001", vendorName: "CV Sentosa Mandiri", date: "2026-10-03", total: 800000, status: "Posted" },
      ],
```

Tambah `detail.do` ke customer & sales-invoice (router existing — tambah handler serupa factory, atau refactor pakai factory; refactor: `customer.ts` & `sales-invoice.ts` ganti isi dengan `export const customerRouter = makeListRouter({ module: "customer", rows: (db) => db.data.customers, fieldsForDetail: ["id","name"] })` dst.)

- [x] **Step 3: Mount router + test baru**

`api-router.ts`:

```ts
import { makeListRouter } from "./modules/list-factory.js";
import { customerRouter } from "./modules/customer.js";
import { salesInvoiceRouter } from "./modules/sales-invoice.js";

apiRouter.use("/customer", customerRouter);
apiRouter.use("/sales-invoice", salesInvoiceRouter);
apiRouter.use("/item", makeListRouter({ module: "item", rows: (db) => db.data.items, fieldsForDetail: ["id","code","name","unit","sellingPrice"] }));
apiRouter.use("/vendor", makeListRouter({ module: "vendor", rows: (db) => db.data.vendors, fieldsForDetail: ["id","code","name"] }));
apiRouter.use("/glaccount", makeListRouter({ module: "glaccount", rows: (db) => db.data.glAccounts, fieldsForDetail: ["id","code","name","type"] }));
apiRouter.use("/sales-order", makeListRouter({ module: "sales-order", rows: (db) => db.data.salesOrders }));
apiRouter.use("/sales-receipt", makeListRouter({ module: "sales-receipt", rows: (db) => db.data.salesReceipts }));
apiRouter.use("/purchase-invoice", makeListRouter({ module: "purchase-invoice", rows: (db) => db.data.purchaseInvoices }));
```

Test tambah di `modules.test.ts`:

```ts
  it("admin: item/list.do & glaccount/list.do OK; staff ditolak item", async () => {
    const a = await session("1001");
    const item = await request(app).get("/accurate/api/item/list.do")
      .set("Authorization", a.bearer).set("X-Session-ID", a.sid);
    expect(item.body.s).toBe(true);
    expect(item.body.d.length).toBeGreaterThan(0);
    const s = await session("1001", "user-staff");
    const itemStaff = await request(app).get("/accurate/api/item/list.do")
      .set("Authorization", s.bearer).set("X-Session-ID", s.sid);
    expect(itemStaff.body.s).toBe(false);
  });

  it("fields & keywords & sp.page bekerja di item/list.do", async () => {
    const a = await session("1001");
    const res = await request(app)
      .get("/accurate/api/item/list.do?fields=code,name&keywords=A4&sp.page=1&sp.pageSize=1")
      .set("Authorization", a.bearer).set("X-Session-ID", a.sid);
    expect(res.body.d).toEqual([{ code: "BRG-001", name: "Kertas A4" }]);
    expect(res.body.sp).toMatchObject({ page: 1, pageSize: 1, rowCount: 1 });
  });
```

- [x] **Step 4: Test PASS → Commit**

Run: `pnpm --filter @mock/accurate test` → PASS.
```bash
git -C /root/aigoogle add mocks/accurate
git -C /root/aigoogle -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(mock-accurate): modul item/vendor/glaccount/sales-order/sales-receipt/purchase-invoice + factory list/detail + query resmi"
```

---

## Task 5: Adapter query builder + tool baru

**Files:** `apps/api/src/providers/accounting/accurate.ts`, `catalog.ts`, `apps/api/test/accurate-execute.test.ts`

- [x] **Step 1: Test execute dengan args**

Tambah di `accurate-execute.test.ts`:

```ts
  it("salesInvoice.list dengan fields+keywords → row terfilter", async () => {
    const d = (await adapter.execute("salesInvoice.list", { fields: "no,total", keywords: "FJ/2026" }, adminCtx)) as Array<Record<string, unknown>>;
    expect(d[0]).toEqual({ no: "FJ/2026/0001", total: 2500000 });
  });

  it("item.list & glAccount.list admin → ada data", async () => {
    const items = (await adapter.execute("item.list", {}, adminCtx)) as Array<{ name: string }>;
    expect(items.map((i) => i.name)).toContain("Kertas A4");
    const accounts = (await adapter.execute("glAccount.list", {}, adminCtx)) as Array<{ code: string }>;
    expect(accounts.map((a) => a.code)).toContain("1000");
  });

  it("customer.detail id C-001 → Budi Santoso; id salah → throw", async () => {
    const d = (await adapter.execute("customer.detail", { id: "C-001" }, adminCtx)) as Array<{ name: string }>;
    expect(d[0].name).toBe("Budi Santoso");
    await expect(adapter.execute("customer.detail", { id: "XXX" }, adminCtx)).rejects.toThrow();
  });
```

- [x] **Step 2: Jalankan — EXPECT FAIL**

Run test file: `pnpm --filter @aigoogle/api test accurate-execute`
Expected: FAIL.

- [x] **Step 3: Implementasi query builder + path map + detail**

`accurate.ts` — tambah helper di dalam class (atau module scope):

```ts
  private buildQuery(args: Record<string, unknown>): string {
    const qs = new URLSearchParams();
    if (typeof args.fields === "string" && args.fields) qs.set("fields", args.fields);
    if (typeof args.keywords === "string" && args.keywords) qs.set("keywords", args.keywords);
    if (typeof args.page === "number") qs.set("sp.page", String(args.page));
    if (typeof args.pageSize === "number") qs.set("sp.pageSize", String(args.pageSize));
    if (typeof args.sort === "string" && args.sort) qs.set("sp.sort", args.sort);
    const filter = args.filter;
    if (filter && typeof filter === "object") {
      for (const [field, cond] of Object.entries(filter as Record<string, unknown>)) {
        if (cond && typeof cond === "object") {
          const { op, value } = cond as { op?: string; value?: unknown };
          if (op) qs.set(`filter.${field}.op`, String(op));
          if (value !== undefined) {
            const vals = Array.isArray(value) ? value : [value];
            vals.forEach((v, i) => qs.set(`filter.${field}.val${vals.length > 1 ? `[${i}]` : ""}`, String(v)));
          }
        }
      }
    }
    const s = qs.toString();
    return s ? `?${s}` : "";
  }
```

Ganti `execute`:

```ts
  async execute(tool: string, args: Record<string, unknown>, ctx: ProviderCtx): Promise<unknown> {
    const listPaths: Record<string, string> = {
      "customer.list": "/accurate/api/customer/list.do",
      "salesInvoice.list": "/accurate/api/sales-invoice/list.do",
      "salesOrder.list": "/accurate/api/sales-order/list.do",
      "item.list": "/accurate/api/item/list.do",
      "vendor.list": "/accurate/api/vendor/list.do",
      "glAccount.list": "/accurate/api/glaccount/list.do",
      "purchaseInvoice.list": "/accurate/api/purchase-invoice/list.do",
      "salesReceipt.list": "/accurate/api/sales-receipt/list.do",
    };
    const detailPaths: Record<string, string> = {
      "customer.detail": "/accurate/api/customer/detail.do",
      "salesInvoice.detail": "/accurate/api/sales-invoice/detail.do",
    };
    const listPath = listPaths[tool];
    if (listPath) {
      const j = await this.moduleGet(`${listPath}${this.buildQuery(args)}`, ctx);
      return j.d;
    }
    const detailPath = detailPaths[tool];
    if (detailPath) {
      const id = args.id;
      if (typeof id !== "string" || !id) throw new Error("args.id wajib string untuk tool detail");
      const j = await this.moduleGet(`${detailPath}?id=${encodeURIComponent(id)}`, ctx);
      return j.d;
    }
    throw new Error(`tool tidak dikenal: ${tool}`);
  }
```

- [x] **Step 4: Expand catalog (9 entry baru)**

`catalog.ts` — helper + daftar:

```ts
const listProps = {
  fields: { type: "string", description: "Field yang ditampilkan, dipisah koma (contoh: id,name)" },
  keywords: { type: "string", description: "Kata kunci pencarian" },
  page: { type: "number", description: "Nomor halaman (default 1)" },
  pageSize: { type: "number", description: "Ukuran halaman (default 20)" },
  sort: { type: "string", description: 'Urutan "field|asc;field2|desc"' },
  filter: {
    type: "object",
    description: "Filter per field: { \"<field>\": { \"op\": \"EQUAL|CONTAIN|…\", \"value\": … } }",
    additionalProperties: true,
  },
} as const;

const listTool = (
  name: string,
  description: string,
  requiredPermission: string,
  label: string
): ToolSpec => ({
  name,
  description,
  jsonSchema: { type: "object", properties: listProps },
  requiredPermission,
  label,
});

export const ACCURATE_CATALOG: ToolSpec[] = [
  listTool("customer.list", "Daftar pelanggan (id, name)", "accurate:customer.view", "Mengambil data pelanggan…"),
  {
    name: "customer.detail",
    description: "Detail satu pelanggan berdasarkan id",
    jsonSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    requiredPermission: "accurate:customer.view",
    label: "Mengambil detail pelanggan…",
  },
  listTool("salesInvoice.list", "Daftar faktur penjualan (no, customerName, date, total, status)", "accurate:sales-invoice.view", "Mengambil data faktur penjualan…"),
  {
    name: "salesInvoice.detail",
    description: "Detail satu faktur penjualan berdasarkan id",
    jsonSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    requiredPermission: "accurate:sales-invoice.view",
    label: "Mengambil detail faktur penjualan…",
  },
  listTool("salesOrder.list", "Daftar pesanan penjualan (SO)", "accurate:sales-order.view", "Mengambil data pesanan jual…"),
  listTool("item.list", "Daftar item/barang (code, name, sellingPrice)", "accurate:item.view", "Mengambil data item…"),
  listTool("vendor.list", "Daftar vendor/supplier", "accurate:vendor.view", "Mengambil data vendor…"),
  listTool("glAccount.list", "Daftar akun COA (code, name, type)", "accurate:glaccount.view", "Mengambil data akun…"),
  listTool("purchaseInvoice.list", "Daftar faktur pembelian", "accurate:purchase-invoice.view", "Mengambil data faktur beli…"),
  listTool("salesReceipt.list", "Daftar penerimaan kas/penjualan", "accurate:sales-receipt.view", "Mengambil data penerimaan…"),
];
```

- [x] **Step 5: Update capabilityCatalog assertion + seed test admin**

`accurate-execute.test.ts` capabilityCatalog:

```ts
  it("capabilityCatalog → 10 tool teranotasi permission", () => {
    const cat = adapter.capabilityCatalog();
    expect(cat.map((t) => t.name).sort()).toEqual([
      "customer.detail", "customer.list", "glAccount.list", "item.list",
      "purchaseInvoice.list", "salesInvoice.detail", "salesInvoice.list",
      "salesOrder.list", "salesReceipt.list", "vendor.list",
    ]);
    expect(cat.every((t) => t.requiredPermission.startsWith("accurate:"))).toBe(true);
  });
```

`admin.test.ts` — expect `accurate:item.view` ikut arrayContaining (launch seed map catalog).

- [x] **Step 6: Test PASS → Commit**

Run: `pnpm --filter @aigoogle/api test` → PASS (cek golden-set masih cocok — TOOLS lokal golden-set hanya 2 tool, tidak otomatis dari catalog; tetap valid).
```bash
git -C /root/aigoogle add apps/api
git -C /root/aigoogle -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(api): query builder resmi (fields/keywords/sp/filter) + 8 tool read Accurate baru"
```

---

## Task 6: Golden set perluas 3 prompt baru (offline)

**Files:** `apps/api/test/golden-set.test.ts`

- [x] **Step 1: Tambah TOOLS lokal + cases**

Ekstend TOOLS array dengan (salinan singkat spec — jangan import catalog agar golden set tetap independen):

```ts
  { name: "item.list", description: "Daftar item", jsonSchema: { type: "object", properties: {} }, requiredPermission: "accurate:item.view", label: "Mengambil data item…" },
  { name: "glAccount.list", description: "Daftar akun", jsonSchema: { type: "object", properties: {} }, requiredPermission: "accurate:glaccount.view", label: "Mengambil data akun…" },
  { name: "vendor.list", description: "Daftar vendor", jsonSchema: { type: "object", properties: {} }, requiredPermission: "accurate:vendor.view", label: "Mengambil data vendor…" },
```

Cases tambah:

```ts
    { prompt: "daftar item yang dijual", tool: "item.list", permissions: ["accurate:item.view"] },
    { prompt: "saldo akun kas 1000", tool: "glAccount.list", permissions: ["accurate:glaccount.view"] },
    { prompt: "siapa saja vendor saya", tool: "vendor.list", permissions: ["accurate:vendor.view"] },
```

Negative case pertama tetap salesInvoice.list.

- [x] **Step 2: Test PASS → Commit**

Run: `pnpm --filter @aigoogle/api test golden-set` → PASS.
```bash
git -C /root/aigoogle add apps/api/test/golden-set.test.ts
git -C /root/aigoogle -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "test(api): golden set +3 prompt (item, COA, vendor)"
```

---

## Task 7: Regresi penuh + smoke live mock + dokumen

**Files:** `/tmp/opencode/e2e-smoke-phase6.sh`, `docs/spikes/2026-10-11-phase6-api-alignment-check.md`, `mocks/accurate/README.md`

- [x] **Step 1: Suite penuh + typecheck + build**

```bash
pnpm --filter @mock/accurate test && pnpm --filter @aigoogle/api test && pnpm --filter @aigoogle/web exec tsc --noEmit && pnpm --filter @aigoogle/api exec tsc --noEmit
```
Expected: semua PASS/Done. Jika gagal → perbaiki sebelum lanjut.

- [x] **Step 2: Smoke live mock**

Buat `/tmp/opencode/e2e-smoke-phase6.sh` (salin pola phase4; trap cleanup pola bracket `dist/cli[.]mjs`, `vit[e].js`): launch mock 4010 + API 3001 dengan `ACCURATE_API_BASE=http://localhost:4010`, login launch admin, POST chat offline? — chat butuh Gemini; cukup:
1. `GET /api/me` → 200 + permissions mengandung `accurate:sales-invoice.view` & `accurate:item.view`.
2. `GET /api/admin/privileges` (cookie admin) → modules list berisi key baru.
3. Mock langsung: `GET /accurate/api/sales-invoice/list.do` 200 s true; `ping.do` 404.
Jalankan 3× retry jika port bentrok/P1001.

- [x] **Step 3: README mock**

`mocks/accurate/README.md` — daftar modul: customer (list+detail), sales-invoice (list+detail), item, vendor, glaccount, sales-order, sales-receipt, purchase-invoice, access-privilege; staff hanya sales-invoice; hapus baris ping jika ada; ganti `sales-entry`→`sales-invoice`.

- [x] **Step 4: Spike check doc**

Buat `docs/spikes/2026-10-11-phase6-api-alignment-check.md`: tabel sebelum/sesudah, hasil suite, hasil smoke, sisa gap (write ops, 65 modul, webhook).

- [x] **Step 5: Commit akhir**

```bash
git -C /root/aigoogle add -A docs mocks/accurate/README.md
git -C /root/aigoogle -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "docs(phase6): hasil alignment API Accurate — smoke & suite hijau"
```

---

## Self-review (penulis plan)

- Rename covered di Task 1–3 (mock, store, adapter, catalog, 7 file test).
- ping.do dihapus di Task 2.
- Query resmi di Task 5 (fields/keywords/sp/filter — pola `filter.{f}.op`/`.val` sesuai openapi).
- 8 tool baru + 2 detail di Task 5; golden set Task 6.
- Mock 6 modul + factory di Task 4; priv-staff tetap sales-invoice saja (staff tidak dapat item/glaccount — test keamanan ada).
- Type konsisten: `MockDb.data.*`, `salesInvoices`, `SalesInvoice`, `makeListRouter`, `buildQuery`, `listTool`.
- Permission key `accurate:{module}.view` match `normalizeModule` admin (`sales-invoice` ↔ `sales_invoice_view`).
