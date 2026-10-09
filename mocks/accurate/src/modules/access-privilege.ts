import { Router } from "express";
import { sessionGuard, ok, fail, sp } from "../session.js";
import { getDb, privilegeGroups } from "../store.js";

export const accessPrivilegeRouter = Router();

accessPrivilegeRouter.get("/list.do", sessionGuard, (req, res) => {
  const rows = privilegeGroups(req.mockCtx!.dbId);
  res.json(ok(rows, { sp: sp(rows.length) }));
});

accessPrivilegeRouter.get("/detail.do", sessionGuard, (req, res) => {
  const db = getDb(req.mockCtx!.dbId);
  const id = String(req.query.id ?? "");
  const priv = db?.privileges[id];
  if (!priv) return res.json(fail(["Privilege tidak ditemukan"]));
  const name = id === "priv-admin" ? "Administrator" : "Staff Penjualan";
  res.json(ok([{ id, name, Privilege: priv }]));
});
