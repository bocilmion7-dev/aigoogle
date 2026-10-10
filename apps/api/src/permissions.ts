import { prisma } from "./db.js";

export async function loadPermissionSet(roleId: string): Promise<Set<string>> {
  const rows = await prisma.rolePermission.findMany({ where: { roleId } });
  return new Set(rows.map((r) => r.permissionKey));
}
