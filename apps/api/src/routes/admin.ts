import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { createToken } from "../auth/tokens.js";
import { sendMail, escapeHtml } from "../mail.js";
import { renderMailLayout } from "../mail/templates.js";
import { clearImpersonationCookie, readImpersonationId, setImpersonationCookie } from "../cookies.js";
import { asyncHandler } from "../asyncHandler.js";
import { requirePerm, loadPermissionSet } from "../permissions.js";
import { requirePlatform, requireUserOrPlatform } from "../middleware/session.js";
import { writeAudit } from "../audit.js";
import { APP_FEATURES, COMPANY_APP_FEATURES, PLATFORM_ONLY_PERMISSIONS, isValidPermissionKey } from "../app-features.js";
import { accurateProvider } from "../providers/accounting/index.js";
import { accurateCtxFor } from "../providers/accounting/connection.js";
import { reconcileSalesWallet, salesWalletSummary } from "../sales/wallet.js";
import { usageToday, dailyLimit } from "../ai/usage.js";

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
    // platform session tak punya req.user → pakai tenantScope (?tenantId= bila ada);
    // tanpa pilihan tenant, mirror Accurate dilewati (mirrorChecked tetap false)
    const scope = await tenantScope(req);
    const ctx = scope.tenantId ? await accurateCtxFor(scope.tenantId) : null;
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
    res.json({ modules, appFeatures: scope.isPlatform ? APP_FEATURES : COMPANY_APP_FEATURES });
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
    if (!scope.isPlatform && body.data.permissions.some((p) => PLATFORM_ONLY_PERMISSIONS.has(p))) {
      return res.status(400).json({ error: "permission_platform_tidak_boleh" });
    }
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
    // actor: user perusahaan ATAU platform admin (req.platform — req.user undefined utk psid)
    await writeAudit(scope.tenantId, req.user?.id ?? req.platform?.id ?? "platform", "role.permissions.update", {
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
    // pembanding id: req.user undefined utk sesi platform → jangan dibaca paksa
    if (req.user && req.params.id === req.user.id) {
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
    await writeAudit(scope.tenantId, req.user?.id ?? req.platform?.id ?? "platform", "user.role.update", {
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
      where: {
        // platform & tanpa pilihan tenant → SEMUA audit lintas perusahaan
        ...(scope.isPlatform && !scope.tenantId ? {} : { tenantId: scope.tenantId }),
        ...(q.data.action ? { action: q.data.action } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: q.data.limit,
      include: { tenant: { select: { name: true } } },
    });
    const ids = [...new Set(rows.map((r) => r.userId))];
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
    const emailById = new Map(users.map((u) => [u.id, u.email]));
    res.json(
      rows.map((r) => ({
        id: r.id,
        action: r.action,
        userEmail: emailById.get(r.userId) ?? r.userId,
        tenantName: r.tenant.name,
        detail: r.detail,
        createdAt: r.createdAt,
      }))
    );
  })
);

function csvCell(value: unknown): string {
  let s = String(value ?? "");
  // Cegah CSV injection saat dibuka di Excel/Sheets.
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

adminRouter.get(
  "/admin/audit/export",
  requireAdminAccess("app:audit.view"),
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        action: z.string().max(100).optional(),
        tenantId: z.string().max(64).optional(),
        limit: z.coerce.number().int().min(1).max(5000).default(2000),
      })
      .safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: "bad_request" });
    const scope = await tenantScope(req);
    const rows = await prisma.auditLog.findMany({
      where: {
        ...(scope.isPlatform && !scope.tenantId ? {} : { tenantId: scope.tenantId }),
        ...(q.data.action ? { action: q.data.action } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: q.data.limit,
      include: { tenant: { select: { name: true } } },
    });
    const ids = [...new Set(rows.map((r) => r.userId))];
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
    const emailById = new Map(users.map((u) => [u.id, u.email]));
    const header = ["waktu", "tenant", "user", "action", "detail"].map(csvCell).join(",");
    const body = rows
      .map((r) =>
        [
          r.createdAt.toISOString(),
          r.tenant.name,
          emailById.get(r.userId) ?? r.userId,
          r.action,
          r.detail,
        ].map(csvCell).join(",")
      )
      .join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`\uFEFF${header}\n${body}\n`);
  })
);

/* ── Status Accurate & monitoring ────────────────────────────────────────── */

adminRouter.get(
  "/admin/accurate/status",
  requireAdminAccess("app:audit.view"),
  asyncHandler(async (req, res) => {
    const scope = await tenantScope(req);
    if (!scope.tenantId) return res.status(400).json({ error: "tenant_wajib" });
    const [tenant, conn, lastMetric, webhookCount, lastWebhook, wallet, usage, limit] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: scope.tenantId },
        select: { id: true, name: true, alias: true, providerDbId: true },
      }),
      prisma.connection.findUnique({
        where: { tenantId_provider: { tenantId: scope.tenantId, provider: "accurate" } },
      }),
      prisma.dailyMetric.findFirst({ where: { tenantId: scope.tenantId }, orderBy: { date: "desc" } }),
      prisma.accurateWebhookEvent.count({
        where: { tenantId: scope.tenantId, createdAt: { gte: new Date(Date.now() - 86400_000) } },
      }),
      prisma.accurateWebhookEvent.findFirst({
        where: { tenantId: scope.tenantId },
        orderBy: { createdAt: "desc" },
        select: { event: true, createdAt: true },
      }),
      salesWalletSummary(scope.tenantId),
      usageToday(scope.tenantId),
      dailyLimit(scope.tenantId),
    ]);
    res.json({
      tenant,
      connection: conn
        ? {
            status: conn.status,
            host: conn.host,
            expiresAt: conn.expiresAt,
            updatedAt: conn.updatedAt,
          }
        : null,
      lastMetric: lastMetric ? { date: lastMetric.date, updatedAt: lastMetric.updatedAt } : null,
      webhookCount24h: webhookCount,
      lastWebhook,
      wallet: {
        balance: wallet.balance,
        pendingWithdrawal: wallet.pendingWithdrawal,
        available: wallet.available,
      },
      ai: { calls: usage.calls, tokens: usage.tokens, limit },
    });
  })
);

adminRouter.post(
  "/admin/accurate/reconcile",
  requireAdminAccess("app:audit.view"),
  asyncHandler(async (req, res) => {
    const scope = await tenantScope(req);
    if (!scope.tenantId) return res.status(400).json({ error: "tenant_wajib" });
    const credited = await reconcileSalesWallet(scope.tenantId, true);
    await writeAudit(scope.tenantId, req.user?.id ?? req.platform?.id ?? "platform", "sales.wallet_reconcile_manual", {
      credited,
    });
    res.json({ ok: true, credited });
  })
);

/* ── Undang user baru (self-service admin perusahaan / platform) ─────────── */

adminRouter.post(
  "/admin/users/invite",
  requireAdminAccess("app:users.manage"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        email: z.string().email(),
        name: z.string().trim().min(1).max(120),
        roleKey: z.string().min(1).max(60),
        tenantId: z.string().max(64).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });

    const scope = await tenantScope(req);
    const tenantId = scope.isPlatform ? (body.data.tenantId || scope.tenantId) : scope.tenantId;
    if (!tenantId) return res.status(400).json({ error: "tenant_wajib" });
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } });
    if (!tenant) return res.status(404).json({ error: "tenant_tidak_ditemukan" });
    const role = await prisma.role.findFirst({ where: { tenantId, key: body.data.roleKey } });
    if (!role) return res.status(404).json({ error: "role_tidak_ditemukan" });

    const email = body.data.email.toLowerCase();
    const existing = await prisma.user.findFirst({ where: { tenantId, email } });
    if (existing?.passwordHash) return res.status(409).json({ error: "email_sudah_terdaftar" });

    const user =
      existing ??
      (await prisma.user.create({
        data: {
          tenantId,
          providerUserId: `invite:${randomBytes(16).toString("hex")}`,
          email,
          name: body.data.name,
          roleId: role.id,
        },
      }));
    if (existing && existing.roleId !== role.id) {
      await prisma.user.update({ where: { id: existing.id }, data: { roleId: role.id, name: body.data.name } });
    }

    const token = await createToken("reset", { userId: user.id, tenantId }, 7 * 86400_000);
    const link = `${env.APP_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;
    void sendMail({
      to: email,
      subject: `Undangan bergabung ke ${tenant.name} — AI Asisten`,
      text:
        `Halo ${body.data.name},\n\nAnda diundang bergabung ke ${tenant.name} sebagai ${role.name}.\n` +
        `Buat password Anda melalui tautan berikut (berlaku 7 hari):\n${link}\n\n` +
        `Jika Anda tidak merasa diundang, abaikan email ini.`,
      html: renderMailLayout({
        heading: `Undangan ke ${tenant.name}`,
        preheader: `Anda diundang bergabung sebagai ${role.name}`,
        intro: `Halo ${escapeHtml(body.data.name)}, Anda diundang bergabung ke ${escapeHtml(tenant.name)} sebagai ${escapeHtml(role.name)}.`,
        bodyHtml:
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e7e5e4;border-radius:12px;background:#fafaf9;padding:2px 18px;margin:6px 0 0">` +
          `<tr><td style="padding:10px 0;font-size:12.5px;color:#78716c;width:38%">Perusahaan</td>` +
          `<td style="padding:10px 0;font-size:13px;font-weight:600;color:#1c1917;text-align:right">${escapeHtml(tenant.name)}</td></tr>` +
          `<tr><td style="padding:10px 0 10px;font-size:12.5px;color:#78716c;border-top:1px solid #e7e5e4">Peran</td>` +
          `<td style="padding:10px 0;font-size:13px;font-weight:600;color:#1c1917;text-align:right;border-top:1px solid #e7e5e4">${escapeHtml(role.name)}</td></tr>` +
          `</table>`,
        cta: { label: "Buat password & bergabung", url: link },
        note: "Tautan undangan berlaku 7 hari. Jika Anda tidak merasa diundang, abaikan email ini.",
      }),
    });
    await writeAudit(tenantId, req.user?.id ?? req.platform?.id ?? "platform", "user.invite", {
      userId: user.id,
      email,
      roleKey: role.key,
    });
    res.json({ ok: true, userId: user.id });
  })
);

/* ── Suspend / aktifkan tenant (khusus platform) ──────────────────────────── */

adminRouter.post(
  "/admin/tenants/:id/suspend",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const body = z.object({ suspended: z.boolean() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) return res.status(404).json({ error: "tenant_tidak_ditemukan" });
    const key = `tenant:suspended:${tenant.id}`;
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: body.data.suspended ? "1" : "0" },
      update: { value: body.data.suspended ? "1" : "0" },
    });
    await writeAudit(tenant.id, req.platform!.id, "tenant.suspend", { suspended: body.data.suspended });
    res.json({ ok: true, suspended: body.data.suspended });
  })
);

/* ── Feature flags sederhana (kill switch rollout) ───────────────────────── */

const FEATURE_KEYS = [
  "ai_chat",
  "voice",
  "drive",
  "insight",
  "whatsapp",
  "push",
  "ads",
  "billing",
] as const;

async function featureSnapshot(): Promise<Record<string, boolean>> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: FEATURE_KEYS.map((k) => `feature:${k}`) } },
  });
  const map = new Map(rows.map((r) => [r.key.replace(/^feature:/, ""), r.value === "1"]));
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, map.get(k) ?? true]));
}

adminRouter.get(
  "/features",
  requireUserOrPlatform,
  asyncHandler(async (_req, res) => {
    res.json(await featureSnapshot());
  })
);

adminRouter.get(
  "/admin/features",
  requirePlatform,
  asyncHandler(async (_req, res) => {
    res.json(await featureSnapshot());
  })
);

adminRouter.put(
  "/admin/features",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const body = z.record(z.string(), z.boolean()).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const unknown = Object.keys(body.data).filter((k) => !FEATURE_KEYS.includes(k as (typeof FEATURE_KEYS)[number]));
    if (unknown.length) return res.status(400).json({ error: "feature_tidak_dikenal", keys: unknown });
    for (const [key, value] of Object.entries(body.data)) {
      const k = `feature:${key}`;
      await prisma.appSetting.upsert({
        where: { key: k },
        create: { key: k, value: value ? "1" : "0" },
        update: { value: value ? "1" : "0" },
      });
    }
    await writeAudit("platform", req.platform!.id, "features.update", body.data);
    res.json(await featureSnapshot());
  })
);

/* ── Impersonation platform (debug user) ─────────────────────────────────── */

adminRouter.post(
  "/admin/impersonate/:userId",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: { id: true, tenantId: true, email: true },
    });
    if (!user) return res.status(404).json({ error: "user_tidak_ditemukan" });
    const sid = randomBytes(32).toString("hex");
    await prisma.session.create({
      data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 3600_000) },
    });
    setImpersonationCookie(res, sid, 3600_000);
    await writeAudit(user.tenantId, req.platform!.id, "platform.impersonate", { userId: user.id, email: user.email });
    res.json({ ok: true, userId: user.id });
  })
);

adminRouter.post(
  "/admin/impersonate/end",
  requireUserOrPlatform,
  asyncHandler(async (req, res) => {
    const imp = readImpersonationId(req);
    if (imp) {
      await prisma.session.deleteMany({ where: { id: imp } });
      if (req.user) {
        await writeAudit(req.user.tenant.id, req.platform?.id ?? "platform", "platform.impersonate_end", {
          userId: req.user.id,
        });
      }
    }
    clearImpersonationCookie(res);
    res.json({ ok: true });
  })
);
