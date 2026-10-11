import type { NextFunction, Request, Response } from "express";
import { prisma } from "./db.js";
import { asyncHandler } from "./asyncHandler.js";

export async function loadPermissionSet(roleId: string): Promise<Set<string>> {
  const rows = await prisma.rolePermission.findMany({ where: { roleId } });
  return new Set(rows.map((r) => r.permissionKey));
}

export function requirePerm(key: string) {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "belum_login" });
    const set = await loadPermissionSet(req.user.roleId);
    if (!set.has(key)) return res.status(403).json({ error: "tidak_punya_hak" });
    next();
  });
}
