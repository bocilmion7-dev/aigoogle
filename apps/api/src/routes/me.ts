import { Router } from "express";
import { prisma } from "../db.js";
import { requireUser } from "../middleware/session.js";
import { asyncHandler } from "../asyncHandler.js";
import { loadPermissionSet } from "../permissions.js";

export const meRouter = Router();

meRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    // identitas platform (cookie psid) menang atas sesi perusahaan di browser yg sama
    if (req.platform) {
      return res.json({
        id: req.platform.id,
        userId: req.platform.id,
        email: req.platform.email,
        name: req.platform.name,
        tenant: { id: "platform", name: "AIGoogle Platform", alias: "PLATFORM", provider: "platform" },
        roleKey: "platform-admin",
        permissions: ["app:users.manage", "app:settings.manage", "app:audit.view"],
        needsPassword: false,
      });
    }
    if (!req.user) return res.status(401).json({ error: "belum_login" });
    const permissions = [...(await loadPermissionSet(req.user.roleId))];
    res.json({ ...req.user, permissions });
  })
);

meRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const sid = req.cookies?.sid;
    if (sid) await prisma.session.deleteMany({ where: { id: sid } });
    const psid = req.cookies?.psid;
    if (psid) await prisma.platformSession.deleteMany({ where: { id: psid } });
    res.clearCookie("sid").clearCookie("psid").json({ ok: true });
  })
);
