import { Router } from "express";
import { randomUUID } from "node:crypto";
import { sessionGuard, ok, fail } from "../session.js";
import { getDb, privilegeOf, type MockDb } from "../store.js";

export type Row = Record<string, unknown>;

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
      const row: Row = { id: `${prefix}-${randomUUID().slice(0, 8)}`, ...body };
      (opts.rows(getDb(dbId)!) as Row[]).push(row);
      res.json(ok(row.id));
    });
  }
  return r;
}
