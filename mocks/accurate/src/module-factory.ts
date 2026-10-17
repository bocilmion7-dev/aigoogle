import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { sessionGuard, ok, fail } from "./session.js";
import { getDb, privilegeOf, normalizeRow, type MockDb, type Row } from "./store.js";
import { ACCURATE_MODULES } from "./manifest.js";

function guard(req: Request, res: Response, mod: string, need: "view" | "create" | "delete"): boolean {
  const p = privilegeOf(req.mockCtx!.dbId, req.mockCtx!.userId, mod);
  const allowed =
    p && (need === "view" ? p.AllowView : need === "create" ? p.AllowCreate : p.AllowDelete);
  if (!allowed) {
    res.json(fail([`Anda tidak punya akses modul ${mod}`]));
    return false;
  }
  return true;
}

function rowsOf(db: MockDb, mod: string): Row[] {
  db.data[mod] ??= [];
  return db.data[mod];
}

/** Router utk SEMUA aksi satu modul sesuai manifest (list/detail/save/delete/khusus). */
export function makeModuleRouter(mod: string): Router {
  const r = Router();
  const acts = ACCURATE_MODULES[mod] ?? [];
  for (const a of acts) {
    if (a.action === "list") {
      r.get("/list.do", sessionGuard, (req, res) => {
        if (!guard(req, res, mod, "view")) return;
        let rows = rowsOf(getDb(req.mockCtx!.dbId)!, mod);
        const kw = String(req.query.keywords ?? "");
        if (kw) {
          rows = rows.filter((row) =>
            Object.values(row).some((v) => String(v ?? "").toLowerCase().includes(kw.toLowerCase()))
          );
        }
        const fields = String(req.query.fields ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (fields.length) {
          rows = rows.map((row) =>
            Object.fromEntries(fields.filter((f) => f in row).map((f) => [f, row[f]]))
          );
        }
        const page = Math.max(1, Number(req.query["sp.page"] ?? 1) || 1);
        const pageSize = Math.max(1, Number(req.query["sp.pageSize"] ?? 20) || 20);
        const start = (page - 1) * pageSize;
        const paged = rows.slice(start, start + pageSize);
        res.json(
          ok(paged, {
            sp: {
              page,
              pageSize,
              rowCount: rows.length,
              pageCount: Math.ceil(rows.length / pageSize),
              start,
              sort: null,
              limit: null,
            },
          })
        );
      });
    } else if (a.action === "detail") {
      r.get("/detail.do", sessionGuard, (req, res) => {
        if (!guard(req, res, mod, "view")) return;
        const row = rowsOf(getDb(req.mockCtx!.dbId)!, mod).find(
          (x) => String(x.id) === String(req.query.id ?? "")
        );
        if (!row) return res.json(fail(["Data tidak ditemukan"]));
        res.json(ok([row]));
      });
    } else if (a.method === "DELETE") {
      r.delete(`/${a.action}.do`, sessionGuard, (req, res) => {
        if (!guard(req, res, mod, "delete")) return;
        const rows = rowsOf(getDb(req.mockCtx!.dbId)!, mod);
        const i = rows.findIndex((x) => String(x.id) === String(req.query.id ?? ""));
        if (i < 0) return res.json(fail(["Data tidak ditemukan"]));
        rows.splice(i, 1);
        res.json(ok("Proses Berhasil Dilakukan"));
      });
    } else if (a.method === "POST") {
      r.post(`/${a.action}.do`, sessionGuard, (req, res) => {
        if (!guard(req, res, mod, "create")) return;
        const body =
          req.body && typeof req.body === "object" && !Array.isArray(req.body)
            ? (req.body as Row)
            : {};
        const prefix = mod.replace(/[^a-zA-Z]/g, "").slice(0, 3).toUpperCase();
        const row: Row = { id: `${prefix}-${randomUUID().slice(0, 8)}`, ...normalizeRow(body) };
        rowsOf(getDb(req.mockCtx!.dbId)!, mod).push(row);
        res.json(ok(row.id));
      });
    } else {
      // aksi GET khusus (balance, mutation, stock, …) — balas row pertama sbg representasi
      r.get(`/${a.action}.do`, sessionGuard, (req, res) => {
        if (!guard(req, res, mod, "view")) return;
        const row = rowsOf(getDb(req.mockCtx!.dbId)!, mod)[0] ?? { id: "" };
        res.json(ok([row]));
      });
    }
  }
  return r;
}
