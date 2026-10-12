import { Router } from "express";
import { bearerGuard, ok, fail, sp } from "./session.js";
import { createSession, getDb, getUser, isAdminOf, listDbs } from "./store.js";
import { ACCURATE_MODULES, ACCURATE_UTILS } from "./manifest.js";
import { accessPrivilegeRouter } from "./modules/access-privilege.js";
import { customerRouter } from "./modules/customer.js";
import { salesInvoiceRouter } from "./modules/sales-invoice.js";
import { makeListRouter } from "./modules/list-factory.js";
import { makeModuleRouter } from "./module-factory.js";

export const accountApiRouter = Router(); // API dasar account.accurate.id (Bearer)
export const apiRouter = Router(); // API modul {host}/accurate/api (Bearer + X-Session-ID)

// Router khusus (shape khusus) menang utk aksinya sendiri; router generik
// di bawah melengkapi seluruh aksi manifest modul yang belum terdaftar.
apiRouter.use("/access-privilege", accessPrivilegeRouter);
apiRouter.use("/customer", customerRouter);
apiRouter.use("/sales-invoice", salesInvoiceRouter);
apiRouter.use("/item", makeListRouter({
  module: "item", rows: (db) => db.data.item,
  fieldsForDetail: ["id", "code", "name", "unit", "sellingPrice"],
}));
apiRouter.use("/vendor", makeListRouter({
  module: "vendor", rows: (db) => db.data.vendor,
  fieldsForDetail: ["id", "code", "name"],
}));
apiRouter.use("/glaccount", makeListRouter({
  module: "glaccount", rows: (db) => db.data.glaccount,
  fieldsForDetail: ["id", "code", "name", "type"],
}));
apiRouter.use("/sales-order", makeListRouter({ module: "sales-order", rows: (db) => db.data["sales-order"] }));
apiRouter.use("/sales-receipt", makeListRouter({ module: "sales-receipt", rows: (db) => db.data["sales-receipt"], addable: true }));
apiRouter.use("/purchase-invoice", makeListRouter({ module: "purchase-invoice", rows: (db) => db.data["purchase-invoice"] }));

for (const mod of Object.keys(ACCURATE_MODULES)) {
  apiRouter.use(`/${mod}`, makeModuleRouter(mod));
}

accountApiRouter.get("/api/userinfo.do", bearerGuard, (req, res) => {
  const u = getUser(req.mockUserId!)!;
  res.json(ok({ id: u.id, email: u.email, name: u.name, phone: u.phone ?? "" }));
});

accountApiRouter.get("/api/db-list.do", bearerGuard, (req, res) => {
  const userId = req.mockUserId!;
  const rows = listDbs().map((db) => ({
    id: Number(db.id),
    alias: db.alias,
    name: db.name,
    admin: isAdminOf(db.id, userId),
    dataAccessType: isAdminOf(db.id, userId) ? "ADMIN" : "USER",
    trial: false,
    expired: false,
  }));
  res.json(ok(rows, { sp: sp(rows.length) }));
});

accountApiRouter.get("/api/open-db.do", bearerGuard, (req, res) => {
  const userId = req.mockUserId!;
  const dbId = String(req.query.id ?? "");
  const db = getDb(dbId);
  if (!db) return res.json(fail(["Database tidak ditemukan"]));
  res.json(ok(["Proses Berhasil Dilakukan"], {
    session: createSession(dbId, userId),
    host: `${req.protocol}://${req.get("host")}`,
    admin: isAdminOf(dbId, userId),
  }));
});

// ── Util Accurate lain (sesuai manifest.utils — Bearer saja) ──────────────
accountApiRouter.get("/api/approved-scope.do", bearerGuard, (_req, res) => {
  res.json(ok([{ clientId: "mock-client", scopes: ["item_view", "customer_view"] }]));
});
accountApiRouter.get("/api/auth-info.do", bearerGuard, (req, res) => {
  res.json(ok([{ userId: req.mockUserId, authenticated: true }]));
});
accountApiRouter.get("/api/db-check-session.do", bearerGuard, (_req, res) => {
  res.json(ok(["Proses Berhasil Dilakukan"]));
});
accountApiRouter.get("/api/db-detail.do", bearerGuard, (req, res) => {
  const db = getDb(String(req.query.id ?? ""));
  if (!db) return res.json(fail(["Database tidak ditemukan"]));
  res.json(ok([{ id: Number(db.id), name: db.name, alias: db.alias, admin: isAdminOf(db.id, req.mockUserId!) }]));
});
accountApiRouter.get("/api/db-refresh-session.do", bearerGuard, (req, res) => {
  const db = getDb(String(req.query.id ?? ""));
  if (!db) return res.json(fail(["Database tidak ditemukan"]));
  res.json(ok(["Proses Berhasil Dilakukan"], {
    session: createSession(db.id, req.mockUserId!),
    host: `${req.protocol}://${req.get("host")}`,
  }));
});
accountApiRouter.get("/api/db-status.do", bearerGuard, (_req, res) => {
  res.json(ok([{ status: "connected", trial: false, expired: false }]));
});
accountApiRouter.get("/api/webhook-history.do", bearerGuard, (_req, res) => {
  res.json(ok([], { sp: sp(0) }));
});
accountApiRouter.get("/api/webhook-renew.do", bearerGuard, (_req, res) => {
  res.json(ok("Proses Berhasil Dilakukan"));
});

// pastikan util terdaftar (doc-sync) — digunakan test manifest mock
void ACCURATE_UTILS;
