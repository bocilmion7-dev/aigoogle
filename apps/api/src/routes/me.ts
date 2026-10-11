import { Router } from "express";
import { prisma } from "../db.js";
import { requireUser } from "../middleware/session.js";
import { asyncHandler } from "../asyncHandler.js";
import { loadPermissionSet } from "../permissions.js";

export const meRouter = Router();

meRouter.get(
  "/me",
  requireUser,
  asyncHandler(async (req, res) => {
    const permissions = [...(await loadPermissionSet(req.user!.roleId))];
    res.json({ ...req.user, permissions });
  })
);

meRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const sid = req.cookies?.sid;
    if (sid) await prisma.session.deleteMany({ where: { id: sid } });
    res.clearCookie("sid").json({ ok: true });
  })
);
