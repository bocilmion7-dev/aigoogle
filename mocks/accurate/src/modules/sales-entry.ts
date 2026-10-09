import { Router } from "express";
import { sessionGuard, ok, fail, sp } from "../session.js";
import { getDb, privilegeOf } from "../store.js";

export const salesEntryRouter = Router();

salesEntryRouter.get("/list.do", sessionGuard, (req, res) => {
  const { dbId, userId } = req.mockCtx!;
  if (!privilegeOf(dbId, userId, "sales-entry")?.AllowView) {
    return res.json(fail(["Anda tidak punya akses modul sales-entry"]));
  }
  const rows = getDb(dbId)!.data.salesEntries;
  res.json(ok(rows, { sp: sp(rows.length) }));
});
