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
      f.vals.push(val(v));
      continue;
    }
    plain[k.slice(7)] = val(v);
  }
  for (const [field, want] of Object.entries(plain)) {
    if (field === "outstanding") {
      const b = want === "true";
      out = out.filter((r) => isOutstanding(r) === b);
    } else {
      out = out.filter((r) => String(r[field] ?? "") === want);
    }
  }
  for (const f of ops) {
    if (!f.vals.length) continue;
    out = out.filter((row) => {
      const actual = String(row[f.field] ?? "");
      return f.vals.some((v) => {
        switch (f.op) {
          case "CONTAIN": return actual.toLowerCase().includes(v.toLowerCase());
          case "NOT_EQUAL": return actual !== v;
          case "EMPTY": return actual === "";
          case "NOT_EMPTY": return actual !== "";
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
    r.post("/add.do", sessionGuard, (req, res) => {
      const { dbId, userId } = req.mockCtx!;
      if (!privilegeOf(dbId, userId, opts.module)?.AllowCreate) {
        return res.json(fail([`Anda tidak punya akses create modul ${opts.module}`]));
      }
      const body = (req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? req.body
        : {}) as Record<string, unknown>;
      const prefix = opts.module.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase();
      const row: Row = { id: `${prefix}-${randomUUID().slice(0, 8)}`, ...normalizeRow(body) };
      (opts.rows(getDb(dbId)!) as Row[]).push(row);
      res.json(ok(row.id));
    });
  }
  return r;
}
