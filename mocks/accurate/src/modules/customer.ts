import { Router } from "express";
import { sessionGuard, ok, fail, sp } from "../session.js";
import { getDb, privilegeOf } from "../store.js";

export const customerRouter = Router();

customerRouter.get("/list.do", sessionGuard, (req, res) => {
  const { dbId, userId } = req.mockCtx!;
  if (!privilegeOf(dbId, userId, "customer")?.AllowView) {
    return res.json(fail(["Anda tidak punya akses modul customer"]));
  }
  const rows = getDb(dbId)!.data.customers;
  res.json(ok(rows, { sp: sp(rows.length) }));
});
