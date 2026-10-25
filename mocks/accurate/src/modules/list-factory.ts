import { Router } from "express";
import { randomUUID } from "node:crypto";
import { sessionGuard, ok, fail } from "../session.js";
import { getDb, privilegeOf, normalizeRow, type MockDb } from "../store.js";

export type Row = Record<string, unknown>;

/**
 * filter.outstanding → baris dianggap BELUM LUNAS bila tak ada info pembayaran
 * (data demo) atau outstanding=true; LUNAS bila outstanding=false/paid=true/paidAmount penuh.
 */
function isOutstanding(row: Row): boolean {
  if (row.outstanding !== undefined && row.outstanding !== null) return String(row.outstanding) === "true";
  if (typeof row.paid === "boolean") return !row.paid;
  if (typeof row.paidAmount === "number") return row.paidAmount < Number(row.totalAmount ?? 0);
  return true;
}

/** parse tanggal dd/mm/yyyy → timestamp (null bila format lain) */
function parseD(s: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s ?? "").trim());
  return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}

/** perbandingan tanggal dd/mm/yyyy (fallback: banding teks) */
function dateCmp(a: string, b: string): number {
  const pa = parseD(a);
  const pb = parseD(b);
  if (pa !== null && pb !== null) return pa - pb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * nilai filterable sebuah baris — bila field tak ada di root (mis. vendorNo di
 * purchaseInvoice), ambil dari objek anak (row.vendor.vendorNo) — sama dgn cara
 * API asli memfilter lewat relasi.
 */
function pickField(row: Row, field: string): unknown {
  if (row[field] !== undefined) return row[field];
  for (const v of Object.values(row)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = (v as Row)[field];
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

/** terapkan query filter Accurate (value langsung & .op/.val) ke baris */
function applyFilters(query: Record<string, unknown>, rows: Row[]): Row[] {
  let out = rows;
  const plain: Record<string, string> = {};
  const ops: Array<{ field: string; op: string; vals: string[] }> = [];
  const val = (v: unknown) => (Array.isArray(v) ? String(v[0]) : String(v ?? ""));
  for (const [k, v] of Object.entries(query)) {
    if (!k.startsWith("filter.")) continue;
    const opM = /^filter\.(.+)\.op$/.exec(k);
    if (opM) {
      let f = ops.find((x) => x.field === opM[1]);
      if (!f) { f = { field: opM[1], op: val(v), vals: [] }; ops.push(f); }
      else f.op = val(v);
      continue;
    }
    const valM = /^filter\.(.+)\.val(?:\[\d+\])?$/.exec(k);
    if (valM) {
      let f = ops.find((x) => x.field === valM[1]);
      if (!f) { f = { field: valM[1], op: "EQUAL", vals: [] }; ops.push(f); }
      // parser query Express (qs) mengubah filter.x.val[0]&filter.x.val[1] jadi
      // SATU kunci bernilai array — tanpa ini BETWEEN selalu kehilangan val[2]
      const add = Array.isArray(v) ? v.map((x) => val(x)) : [val(v)];
      for (const x of add) f.vals.push(x);
      continue;
    }
    plain[k.slice(7)] = val(v);
  }
  for (const [field, want] of Object.entries(plain)) {
    if (field === "outstanding") {
      const b = want === "true";
      out = out.filter((r) => isOutstanding(r) === b);
    } else {
      out = out.filter((r) => String(pickField(r, field) ?? "") === want);
    }
  }
  for (const f of ops) {
    if (!f.vals.length) continue;
    out = out.filter((row) => {
      const actual = String(pickField(row, f.field) ?? "");
      return f.vals.some((v) => {
        switch (f.op) {
          case "CONTAIN": return actual.toLowerCase().includes(v.toLowerCase());
          case "NOT_EQUAL": return actual !== v;
          case "EMPTY": return actual === "";
          case "NOT_EMPTY": return actual !== "";
          // operator tanggal (salesInvoice.summary / purchaseInvoice.summary / perCustomer)
          case "BETWEEN": return f.vals.length >= 2 && dateCmp(actual, f.vals[0]) >= 0 && dateCmp(actual, f.vals[1]) <= 0;
          case "GREATER_EQUAL_THAN": return dateCmp(actual, v) >= 0;
          case "LESS_EQUAL_THAN": return dateCmp(actual, v) <= 0;
          default: return actual === v;
        }
      });
    });
  }
  return out;
}

export function makeListRouter(opts: {
  module: string;
  rows: (db: MockDb) => readonly unknown[];
  fieldsForDetail?: string[];
  addable?: boolean;
}): Router {
  const r = Router();
  const rowsOf = (dbId: string): Row[] => opts.rows(getDb(dbId)!).map((x) => x as Row);
  r.get("/list.do", sessionGuard, (req, res) => {
    const { dbId, userId } = req.mockCtx!;
    if (!privilegeOf(dbId, userId, opts.module)?.AllowView) {
      return res.json(fail([`Anda tidak punya akses modul ${opts.module}`]));
    }
    let rows = rowsOf(dbId);
    const kw = String(req.query.keywords ?? "");
    if (kw) {
      rows = rows.filter((row) =>
        Object.values(row).some((v) => String(v ?? "").toLowerCase().includes(kw.toLowerCase()))
      );
    }
    // filter Accurate: filter.<field>=<val> (value langsung) & filter.<field>.op/.val
    rows = applyFilters(req.query as Record<string, unknown>, rows);
    const fields = String(req.query.fields ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (fields.length) {
      rows = rows.map((row) => Object.fromEntries(fields.filter((f) => f in row).map((f) => [f, row[f]])));
    }
    const page = Math.max(1, Number(req.query["sp.page"] ?? 1) || 1);
    const pageSize = Math.max(1, Number(req.query["sp.pageSize"] ?? 20) || 20);
    const start = (page - 1) * pageSize;
    const paged = rows.slice(start, start + pageSize);
    res.json(ok(paged, {
      sp: {
        page, pageSize, rowCount: rows.length,
        pageCount: Math.ceil(rows.length / pageSize),
        start, sort: null, limit: null,
      },
    }));
  });
  if (opts.fieldsForDetail?.length) {
    r.get("/detail.do", sessionGuard, (req, res) => {
      const { dbId, userId } = req.mockCtx!;
      if (!privilegeOf(dbId, userId, opts.module)?.AllowView) {
        return res.json(fail([`Anda tidak punya akses modul ${opts.module}`]));
      }
      const id = String(req.query.id ?? "");
      const row = rowsOf(dbId).find((x) => String(x.id) === id);
      if (!row) return res.json(fail(["Data tidak ditemukan"]));
      res.json(ok([row]));
    });
  }
  if (opts.addable) {
    const create = (req: Parameters<Router["post"]>[1] extends never ? never : any, res: any) => {
      const { dbId, userId } = req.mockCtx!;
      if (!privilegeOf(dbId, userId, opts.module)?.AllowCreate) {
        return res.json(fail([`Anda tidak punya akses create modul ${opts.module}`]));
      }
      const body = (req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? req.body
        : {}) as Record<string, unknown>;
      const prefix = opts.module.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase();
      const id = `${prefix}-${randomUUID().slice(0, 8)}`;
      const row: Row = { id, ...normalizeRow(body), number: String(body.number ?? id) };
      // pelanggan baru selalu punya customerNo (API asli membuatkan otomatis)
      if (opts.module === "customer" && !row.customerNo) row.customerNo = id;
      const db = getDb(dbId)! as unknown as { data?: Record<string, Row[]> };
      if (typeof body.customerNo === "string" && !row.customer) {
        const cust = (db.data?.customer ?? []).find((c) => c.customerNo === body.customerNo);
        if (cust) row.customer = { customerNo: cust.customerNo, name: cust.name };
      }
      if (typeof body.vendorNo === "string" && !row.vendor) {
        const ven = (db.data?.vendor ?? []).find((v) => v.vendorNo === body.vendorNo);
        if (ven) row.vendor = { vendorNo: ven.vendorNo, name: ven.name };
      }
      if (row.totalAmount === undefined && Array.isArray(row.detailItem)) {
        // mirror API asli: total faktur = barang + biaya/expense (mis. ongkos kirim)
        const items = (row.detailItem as Array<Record<string, unknown>>).reduce(
          (s, it) => s + Number(it.quantity ?? 0) * Number(it.unitPrice ?? 0),
          0
        );
        const expense = Array.isArray(row.detailExpense)
          ? (row.detailExpense as Array<Record<string, unknown>>).reduce(
              (s, it) => s + Number(it.expenseAmount ?? 0),
              0
            )
          : 0;
        row.totalAmount = items + expense;
      }
      // pembayaran (sales-receipt) mengurangi piutang faktur — seperti Accurate asli
      if (opts.module === "sales-receipt" && Array.isArray(row.detailInvoice)) {
        const invoices = ((db.data?.["sales-invoice"] ?? []) as Row[]) ?? [];
        for (const inv of invoices) {
          const pay = (row.detailInvoice as Array<Record<string, unknown>>)
            .filter((d) => String(d.invoiceNo ?? "") === String(inv.number))
            .reduce((s, it) => s + Number(it.paymentAmount ?? 0), 0);
          if (pay > 0) inv.paidAmount = Number(inv.paidAmount ?? 0) + pay;
        }
      }
      (opts.rows(db as MockDb) as Row[]).push(row);
      res.json({
        s: true,
        r: { id, number: row.number, ...(row.customerNo ? { customerNo: row.customerNo } : {}) },
      });
    };
    r.post("/add.do", sessionGuard, create);
    r.post("/save.do", sessionGuard, create);
  }
  return r;
}
