import { Router } from "express";
import { asyncHandler } from "../asyncHandler.js";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { metricsSnapshot } from "../metrics.js";
import { requirePerm } from "../permissions.js";
import { requirePlatform, requireUser } from "../middleware/session.js";

export const opsRouter = Router();

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; detail?: string }> {
  const t0 = Date.now();
  try {
    await fn();
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message.slice(0, 120) : "error" };
  }
}

/**
 * GET /api/health            → shallow (utk uptime monitor)
 * GET /api/health?deep=1     → cek DB, provider AI, koneksi Google & Accurate
 * Hanya boolean + waktu; tidak membocorkan data/kredensial.
 */
opsRouter.get(
  "/health",
  asyncHandler(async (req, res) => {
    if (req.query.deep !== "1") {
      res.json({ ok: true, uptimeSec: Math.round(process.uptime()) });
      return;
    }
    const [db, ai] = await Promise.all([
      timed(() => prisma.$queryRaw`SELECT 1`),
      timed(async () => {
        const override = Boolean(env.LLM_OVERRIDE_BASE_URL && env.LLM_OVERRIDE_API_KEY && env.LLM_OVERRIDE_MODEL);
        if (override) return;
        const n = await prisma.aiProvider.count({ where: { isActive: true } });
        if (n === 0) throw new Error("tidak ada provider AI aktif");
      }),
    ]);
    const [google, accurate] = await Promise.all([
      timed(async () => {
        const c = await prisma.connection.findFirst({ where: { provider: "google" } });
        if (!c) throw new Error("google belum terhubung");
      }),
      timed(async () => {
        const c = await prisma.connection.findFirst({ where: { provider: "accurate" } });
        if (!c) throw new Error("accurate belum terhubung");
      }),
    ]);
    const checks = { db, ai, google, accurate };
    const ok = Object.values(checks).every((c) => c.ok);
    res.status(ok ? 200 : 503).json({ ok, uptimeSec: Math.round(process.uptime()), checks });
  })
);

/** GET /api/metrics — ringkasan latensi/error/LLM (admin audit) */
opsRouter.get(
  "/metrics",
  requireUser,
  requirePerm("app:audit.view"),
  asyncHandler(async (_req, res) => {
    res.json(metricsSnapshot());
  })
);

/** GET /api/usage — pemakaian AI tenant ini (hari ini + 30 hari) */
opsRouter.get(
  "/usage",
  requireUser,
  asyncHandler(async (req, res) => {
    const tenantId = req.user!.tenant.id;
    const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const [rows, today, limit] = await Promise.all([
      prisma.llmUsage.findMany({ where: { tenantId, day: { gte: since } }, orderBy: { day: "asc" } }),
      prisma.llmUsage.findMany({ where: { tenantId, day: new Date().toISOString().slice(0, 10) } }),
      prisma.appSetting.findMany({ where: { key: { in: [`llm:daily_token_limit:${tenantId}`, "llm:daily_token_limit"] } } }),
    ]);
    const lim = Number(rows.find(() => false)?.id ?? 0);
    void lim;
    const byDay = new Map<string, { day: string; calls: number; tokens: number }>();
    for (const r of rows) {
      const e = byDay.get(r.day) ?? { day: r.day, calls: 0, tokens: 0 };
      e.calls += r.calls;
      e.tokens += r.promptTokens + r.completionTokens;
      byDay.set(r.day, e);
    }
    const limitVal = Number(
      limit.find((r) => r.key.endsWith(`:${tenantId}`))?.value ?? limit.find((r) => r.key === "llm:daily_token_limit")?.value ?? 0
    );
    res.json({
      today: {
        calls: today.reduce((a, r) => a + r.calls, 0),
        tokens: today.reduce((a, r) => a + r.promptTokens + r.completionTokens, 0),
      },
      limit: Number.isFinite(limitVal) && limitVal > 0 ? limitVal : 0,
      days: [...byDay.values()],
    });
  })
);

/** GET /api/platform/analytics — pemakaian per tenant (operator platform) */
opsRouter.get(
  "/platform/analytics",
  requirePlatform,
  asyncHandler(async (_req, res) => {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const [usage, tenants, sessions, users] = await Promise.all([
      prisma.llmUsage.groupBy({
        by: ["tenantId"],
        where: { day: { gte: since } },
        _sum: { calls: true, promptTokens: true, completionTokens: true },
        _max: { day: true },
      }),
      prisma.tenant.findMany({ select: { id: true, name: true, alias: true } }),
      prisma.chatSession.groupBy({ by: ["tenantId"], _count: { _all: true } }),
      prisma.user.groupBy({ by: ["tenantId"], _count: { _all: true } }),
    ]);
    const tName = new Map(tenants.map((t) => [t.id, t.name]));
    const tAlias = new Map(tenants.map((t) => [t.id, t.alias]));
    const sCount = new Map(sessions.map((s) => [s.tenantId, s._count._all]));
    const uCount = new Map(users.map((u) => [u.tenantId, u._count._all]));
    const rows = usage
      .map((u) => {
        const prompt = u._sum.promptTokens ?? 0;
        const completion = u._sum.completionTokens ?? 0;
        return {
          tenantId: u.tenantId,
          name: tName.get(u.tenantId) ?? u.tenantId,
          alias: tAlias.get(u.tenantId) ?? "",
          calls: u._sum.calls ?? 0,
          tokens: prompt + completion,
          promptTokens: prompt,
          completionTokens: completion,
          sessions: sCount.get(u.tenantId) ?? 0,
          users: uCount.get(u.tenantId) ?? 0,
          lastDay: u._max.day ?? "",
        };
      })
      .sort((a, b) => b.tokens - a.tokens);
    res.json({
      since,
      totals: {
        tenants: rows.length,
        calls: rows.reduce((a, r) => a + r.calls, 0),
        tokens: rows.reduce((a, r) => a + r.tokens, 0),
      },
      tenants: rows,
    });
  })
);
