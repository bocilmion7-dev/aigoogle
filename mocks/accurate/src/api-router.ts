import { Router } from "express";
import { bearerGuard, ok } from "./session.js";
import { getUser } from "./store.js";

export const accountApiRouter = Router(); // API dasar account.accurate.id (Bearer)

accountApiRouter.get("/api/userinfo.do", bearerGuard, (req, res) => {
  const u = getUser(req.mockUserId!)!;
  res.json(ok({ id: u.id, email: u.email, name: u.name }));
});
