import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requirePerm } from "../permissions.js";
import { writeAudit } from "../audit.js";
import { APP_FEATURES, isValidPermissionKey } from "../app-features.js";
import { accurateProvider } from "../providers/accounting/index.js";
import { accurateCtxFor } from "../providers/accounting/connection.js";

export const adminRouter = Router();

function normalizeModule(name: string): string {
  return name.toLowerCase().replace(/[\s_]+/g, "-");
}

adminRouter.get(
  "/admin/roles",
  requirePerm("app:users.manage"),
  asyncHandler(async (req, res) => {
    const roles = await prisma.role.findMany({
      where: { tenantId: req.user!.tenant.id },
      include: { permissions: { select: { permissionKey: true } } },
      orderBy: { key: "asc" },
    });
    res.json(
      roles.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        permissions: r.permissions.map((p) => p.permissionKey),
      }))
    );
  })
);

adminRouter.get(
  "/admin/privileges",
  requirePerm("app:users.manage"),
  asyncHandler(async (req, res) => {
    const provider = accurateProvider();
    const catalog = provider.capabilityCatalog();
    const byPerm = new Map<string, string>();
    for (const t of catalog) {
      if (!byPerm.has(t.requiredPermission)) byPerm.set(t.requiredPermission, t.name);
    }
    const modules = [...byPerm.entries()].map(([key, label]) => ({ key, label, mirrorChecked: false }));
    const ctx = await accurateCtxFor(req.user!.tenant.id);
    if (ctx) {
      try {
        const groups = await provider.privilegeCatalog(ctx);
        const allowed = new Set(groups.flatMap((g) => g.allowViewModules.map(normalizeModule)));
        for (const m of modules) {
          const norm = normalizeModule(m.key.replace(/^accurate:/, "").replace(/\.view$/, ""));
          m.mirrorChecked = allowed.has(norm);
        }
      } catch {
        // koneksi bermasalah → mirrorChecked tetap false
      }
    }
    res.json({ modules, appFeatures: APP_FEATURES });
  })
);

adminRouter.put(
  "/admin/roles/:id/permissions",
  requirePerm("app:users.manage"),
  asyncHandler(async (req, res) => {
    const body = z.object({ permissions: z.array(z.string().min(1)).max(100) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    if (!body.data.permissions.every(isValidPermissionKey)) {
      return res.status(400).json({ error: "permission_key_tidak_valid" });
    }
    const role = await prisma.role.findFirst({
      where: { id: req.params.id, tenantId: req.user!.tenant.id },
    });
    if (!role) return res.status(404).json({ error: "role_tidak_ditemukan" });
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({
        data: body.data.permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })),
        skipDuplicates: true,
      }),
    ]);
    await writeAudit(req.user!.tenant.id, req.user!.id, "role.permissions.update", {
      roleKey: role.key,
      permissions: body.data.permissions,
    });
    res.json({ ok: true });
  })
);

adminRouter.get(
  "/admin/users",
  requirePerm("app:users.manage"),
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { tenantId: req.user!.tenant.id },
      include: { role: { select: { key: true } } },
      orderBy: { name: "asc" },
    });
    res.json(users.map((u) => ({ id: u.id, name: u.name, email: u.email, roleKey: u.role.key })));
  })
);

adminRouter.put(
  "/admin/users/:id/role",
  requirePerm("app:users.manage"),
  asyncHandler(async (req, res) => {
    const body = z.object({ roleKey: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    if (req.params.id === req.user!.id) {
      return res.status(400).json({ error: "tidak_boleh_ubah_role_sendiri" });
    }
    const user = await prisma.user.findFirst({ where: { id: req.params.id, tenantId: req.user!.tenant.id } });
    if (!user) return res.status(404).json({ error: "user_tidak_ditemukan" });
    const role = await prisma.role.findFirst({
      where: { tenantId: req.user!.tenant.id, key: body.data.roleKey },
    });
    if (!role) return res.status(404).json({ error: "role_tidak_ditemukan" });
    await prisma.user.update({ where: { id: user.id }, data: { roleId: role.id } });
    await writeAudit(req.user!.tenant.id, req.user!.id, "user.role.update", {
      userId: user.id,
      roleKey: role.key,
    });
    res.json({ ok: true });
  })
);

adminRouter.get(
  "/admin/audit",
  requirePerm("app:audit.view"),
  asyncHandler(async (req, res) => {
    const q = z
      .object({ limit: z.coerce.number().int().min(1).max(200).default(50), action: z.string().max(100).optional() })
      .safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: "bad_request" });
    const rows = await prisma.auditLog.findMany({
      where: { tenantId: req.user!.tenant.id, ...(q.data.action ? { action: q.data.action } : {}) },
      orderBy: { createdAt: "desc" },
      take: q.data.limit,
    });
    const ids = [...new Set(rows.map((r) => r.userId))];
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
    const emailById = new Map(users.map((u) => [u.id, u.email]));
    res.json(
      rows.map((r) => ({
        id: r.id,
        action: r.action,
        userEmail: emailById.get(r.userId) ?? r.userId,
        detail: r.detail,
        createdAt: r.createdAt,
      }))
    );
  })
);
