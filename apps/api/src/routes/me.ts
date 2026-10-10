import { Router } from "express";
import { prisma } from "../db.js";
import { requireUser } from "../middleware/session.js";
import { asyncHandler } from "../asyncHandler.js";

export const meRouter = Router();

meRouter.get("/me", requireUser, (req, res) => {
  res.json(req.user);
});

meRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const sid = req.cookies?.sid;
    if (sid) await prisma.session.deleteMany({ where: { id: sid } });
    res.clearCookie("sid").json({ ok: true });
  })
);
