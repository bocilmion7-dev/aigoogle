import { Router } from "express";
import { asyncHandler } from "../asyncHandler.js";
import { prisma } from "../db.js";
import { requirePerm } from "../permissions.js";
import { ACCURATE_WEBHOOK_EVENTS } from "../providers/accounting/accurate-paths.js";
import { ACCURATE_REDIRECT_URI, realAccurateProvider } from "../providers/accounting/index.js";

export const webhookAccurateRouter = Router();

// CTA OAuth: redirect ke authorize Accurate dgn scope penuh (196 scope resmi dari manifest).
// State SELALU kosong: /api/callback/accurate pakai requireState:false; state kustom
// akan ditolak pending map (/ (?error=state)).
webhookAccurateRouter.get("/integrations/accurate/authorize", (_req, res) => {
  res.redirect(302, realAccurateProvider().authorizeUrl({ redirectUri: ACCURATE_REDIRECT_URI, state: "" }));
});

/** tenant utk event masuk: tenantId eksplisit (proses internal) → tenant pertama → default baru */
async function resolveTenant(explicit?: string): Promise<string> {
  if (explicit) {
    const t = await prisma.tenant.findUnique({ where: { id: explicit } });
    if (t) return t.id;
  }
  const first = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (first) return first.id;
  const created = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: "default", name: "Default", alias: "DEFAULT" },
  });
  return created.id;
}

// POST /api/integrations/accurate/webhook — PUBLIK (Accurate tidak mengirim cookie).
// Body: { event, tenantId?, dbId?, data? }. Header opsional x-webhook-secret bila ACCURATE_WEBHOOK_SECRET diset.
webhookAccurateRouter.post(
  "/integrations/accurate/webhook",
  asyncHandler(async (req, res) => {
    const b = (req.body ?? {}) as { event?: string; tenantId?: string; dbId?: string; data?: unknown };
    if (!b.event || !ACCURATE_WEBHOOK_EVENTS.includes(b.event)) {
      return res.status(400).json({ error: "event_tidak_dikenal", known: ACCURATE_WEBHOOK_EVENTS.length });
    }
    const secret = process.env.ACCURATE_WEBHOOK_SECRET;
    if (secret && req.get("x-webhook-secret") !== secret) {
      return res.status(401).json({ error: "secret_salah" });
    }
    const tenantId = await resolveTenant(b.tenantId);
    await prisma.accurateWebhookEvent.create({
      data: {
        tenantId,
        event: b.event,
        dbId: String(b.dbId ?? ""),
        payload: JSON.stringify(b.data ?? b),
      },
    });
    res.json({ ok: true });
  })
);

// GET /api/integrations/accurate/webhook-events?event=&take= — admin (audit view)
webhookAccurateRouter.get(
  "/integrations/accurate/webhook-events",
  requirePerm("app:audit.view"),
  asyncHandler(async (req, res) => {
    const take = Math.min(500, Number(req.query.take ?? 100) || 100);
    const rows = await prisma.accurateWebhookEvent.findMany({
      where: {
        tenantId: req.user!.tenant.id,
        ...(req.query.event ? { event: String(req.query.event) } : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
    });
    res.json({ s: true, d: rows });
  })
);
