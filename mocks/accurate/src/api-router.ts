import { Router } from "express";
import { bearerGuard, ok, fail, sp } from "./session.js";
import { createSession, getDb, getUser, isAdminOf, listDbs } from "./store.js";
import { accessPrivilegeRouter } from "./modules/access-privilege.js";
import { customerRouter } from "./modules/customer.js";
import { salesInvoiceRouter } from "./modules/sales-invoice.js";
import { makeListRouter } from "./modules/list-factory.js";

export const accountApiRouter = Router(); // API dasar account.accurate.id (Bearer)
export const apiRouter = Router(); // API modul {host}/accurate/api (Bearer + X-Session-ID)

apiRouter.use("/access-privilege", accessPrivilegeRouter);
apiRouter.use("/customer", customerRouter);
apiRouter.use("/sales-invoice", salesInvoiceRouter);
apiRouter.use("/item", makeListRouter({
  module: "item", rows: (db) => db.data.items,
  fieldsForDetail: ["id", "code", "name", "unit", "sellingPrice"],
}));
apiRouter.use("/vendor", makeListRouter({
  module: "vendor", rows: (db) => db.data.vendors,
  fieldsForDetail: ["id", "code", "name"],
}));
apiRouter.use("/glaccount", makeListRouter({
  module: "glaccount", rows: (db) => db.data.glAccounts,
  fieldsForDetail: ["id", "code", "name", "type"],
}));
apiRouter.use("/sales-order", makeListRouter({ module: "sales-order", rows: (db) => db.data.salesOrders }));
apiRouter.use("/sales-receipt", makeListRouter({ module: "sales-receipt", rows: (db) => db.data.salesReceipts }));
apiRouter.use("/purchase-invoice", makeListRouter({ module: "purchase-invoice", rows: (db) => db.data.purchaseInvoices }));

accountApiRouter.get("/api/userinfo.do", bearerGuard, (req, res) => {
  const u = getUser(req.mockUserId!)!;
  res.json(ok({ id: u.id, email: u.email, name: u.name }));
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
