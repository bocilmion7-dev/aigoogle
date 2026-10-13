import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requirePerm, loadPermissionSet } from "../permissions.js";
import { requirePlatform } from "../middleware/session.js";
import { writeAudit } from "../audit.js";
import { APP_FEATURES, isValidPermissionKey } from "../app-features.js";
import { accurateProvider } from "../providers/accounting/index.js";
import { accurateCtxFor } from "../providers/accounting/connection.js";

export const adminRouter = Router();

function normalizeModule(name: string): string {
  return name.toLowerCase().replace(/[\s_]+/g, "-");
}

/** Admin Platform (sesi psid, tabel PlatformUser terpisah) mengelola lintas perusahaan dgn ?tenantId=;
 *  Admin Accurate selalu terkunci di perusahaannya sendiri. */
async function tenantScope(req: import("express").Request): Promise<{
  isPlatform: boolean;
  tenantId: string;
}> {
  if (req.platform) {
    const q = req.query.tenantId;
    const tenantId = typeof q === "string" && q ? q : "";
    return { isPlatform: true, tenantId };
  }
  return { isPlatform: false, tenantId: req.user!.tenant.id };
}

/** guard gabungan: operator platform (psid) ATAU user perusahaan dgn permission tertentu */
function requireAdminAccess(perm: string) {
  return (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    if (req.platform) return next();
    return requirePerm(perm)(req, res, next);
  };
}

// GET /api/admin/tenants — daftar perusahaan pelanggan sistem ini (khusus Admin Platform).
// Hanya tenant dengan koneksi Accurate Online ASLI (host *.accurate.id) — data test/mock (host lokal) disembunyikan.
adminRouter.get(
  "/admin/tenants",
  requirePlatform,
  asyncHandler(async (_req, res) => {
    const cons = await prisma.connection.findMany({
      where: { provider: "accurate", host: { contains: "accurate.id" } },
      select: { tenantId: true },
    });
    const ids = [...new Set(cons.map((c) => c.tenantId))];
    if (!ids.length) return res.json([]);
    const tenants = await prisma.tenant.findMany({
      where: { id: { in: ids } },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, alias: true },
    });
    res.json(tenants);
  })
);

adminRouter.get(
  "/admin/roles",
  requireAdminAccess("app:users.manage"),
  asyncHandler(async (req, res) => {
    const scope = await tenantScope(req);
    const roles = await prisma.role.findMany({
      // platform-admin bukan role perusahaan — Admin Platform memakai tabel PlatformUser terpisah
      where: { tenantId: scope.tenantId, key: { not: "platform-admin" } },
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
  requireAdminAccess("app:users.manage"),
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
  requireAdminAccess("app:users.manage"),
  asyncHandler(async (req, res) => {
    const body = z.object({ permissions: z.array(z.string().min(1)).max(100) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    if (!body.data.permissions.every(isValidPermissionKey)) {
      return res.status(400).json({ error: "permission_key_tidak_valid" });
    }
    const scope = await tenantScope(req);
    const role = await prisma.role.findFirst({
      where: { id: req.params.id, tenantId: scope.tenantId },
    });
    if (!role) return res.status(404).json({ error: "role_tidak_ditemukan" });
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({
        data: body.data.permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })),
        skipDuplicates: true,
      }),
    ]);
    await writeAudit(scope.tenantId, req.user!.id, "role.permissions.update", {
      roleKey: role.key,
      permissions: body.data.permissions,
    });
    res.json({ ok: true });
  })
);

adminRouter.get(
  "/admin/users",
  requireAdminAccess("app:users.manage"),
  asyncHandler(async (req, res) => {
    const scope = await tenantScope(req);
    const users = await prisma.user.findMany({
      where: { tenantId: scope.tenantId },
      include: { role: { select: { key: true } } },
      orderBy: { name: "asc" },
    });
    res.json(users.map((u) => ({ id: u.id, name: u.name, email: u.email, roleKey: u.role.key })));
  })
);

adminRouter.put(
  "/admin/users/:id/role",
  requireAdminAccess("app:users.manage"),
  asyncHandler(async (req, res) => {
    const body = z.object({ roleKey: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    if (req.params.id === req.user!.id) {
      return res.status(400).json({ error: "tidak_boleh_ubah_role_sendiri" });
    }
    const scope = await tenantScope(req);
    const user = await prisma.user.findFirst({ where: { id: req.params.id, tenantId: scope.tenantId } });
    if (!user) return res.status(404).json({ error: "user_tidak_ditemukan" });
    const role = await prisma.role.findFirst({
      where: { tenantId: scope.tenantId, key: body.data.roleKey },
    });
    if (!role) return res.status(404).json({ error: "role_tidak_ditemukan" });
    await prisma.user.update({ where: { id: user.id }, data: { roleId: role.id } });
    await writeAudit(scope.tenantId, req.user!.id, "user.role.update", {
      userId: user.id,
      roleKey: role.key,
    });
    res.json({ ok: true });
  })
);

adminRouter.get(
  "/admin/audit",
  requireAdminAccess("app:audit.view"),
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        action: z.string().max(100).optional(),
        tenantId: z.string().max(64).optional(),
      })
      .safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: "bad_request" });
    const scope = await tenantScope(req);
    const rows = await prisma.auditLog.findMany({
      where: { tenantId: scope.tenantId, ...(q.data.action ? { action: q.data.action } : {}) },
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
