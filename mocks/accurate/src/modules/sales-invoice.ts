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
