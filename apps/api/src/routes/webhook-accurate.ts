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

/**
 * Verifikasi App Key webhook (terdaftar di Area Developer Accurate).
 * Dicari fleksibel di header umum + query + body — format resmi Accurate belum
 * terdokumentasi publik; kalau key tak ditemukan di posisi mana pun, request
 * TETAP diterima (dicatat "tidak_dikenali" di _meta) supaya push nyata tidak
 * terblokir saat format aslinya berbeda.
 */
function checkAppKey(req: { get: (h: string) => string | undefined; query: Record<string, unknown>; body?: unknown }): {
  ok: boolean;
  status: "cocok" | "salah" | "tidak_dikenali" | "tidak_diset";
} {
  const expect = process.env.ACCURATE_WEBHOOK_APP_KEY;
  if (!expect) return { ok: true, status: "tidak_diset" };
  const cand: string[] = [];
  for (const h of ["x-app-key", "x-accurate-app-key", "x-webhook-key", "x-appkey"]) {
    const v = req.get(h);
    if (v) cand.push(v);
  }
  for (const q of ["appKey", "key"]) {
    const v = req.query[q];
    if (typeof v === "string" && v) cand.push(v);
  }
  const b = (req.body ?? {}) as { appKey?: unknown; key?: unknown };
  for (const v of [b.appKey, b.key]) if (typeof v === "string" && v) cand.push(v);
  if (!cand.length) return { ok: true, status: "tidak_dikenali" };
  return cand.includes(expect) ? { ok: true, status: "cocok" } : { ok: false, status: "salah" };
}

/** handler penerima push webhook Accurate — dipakai di /api/... dan /webhook (target URL developer) */
export async function webhookAccurateHandler(
  req: Parameters<Parameters<Router["post"]>[1]>[0],
  res: Parameters<Parameters<Router["post"]>[1]>[1]
): Promise<void> {
  const b = (req.body ?? {}) as { event?: string; tenantId?: string; dbId?: string; data?: unknown };
  if (!b.event || !ACCURATE_WEBHOOK_EVENTS.includes(b.event)) {
    res.status(400).json({ error: "event_tidak_dikenal", known: ACCURATE_WEBHOOK_EVENTS.length });
    return;
  }
  const secret = process.env.ACCURATE_WEBHOOK_SECRET;
  if (secret && req.get("x-webhook-secret") !== secret) {
    res.status(401).json({ error: "secret_salah" });
    return;
  }
  const appKey = checkAppKey(req);
  if (!appKey.ok) {
    res.status(401).json({ error: "app_key_salah" });
    return;
  }
  const tenantId = await resolveTenant(b.tenantId);
  await prisma.accurateWebhookEvent.create({
    data: {
      tenantId,
      event: b.event,
      dbId: String(b.dbId ?? ""),
      // payload + _meta (appKey & header mentah) utk audit format push asli
      payload: JSON.stringify({ data: b.data ?? b, _meta: { appKey: appKey.status, headers: req.headers } }),
    },
  });
  res.json({ ok: true });
}

// POST /api/integrations/accurate/webhook — PUBLIK (Accurate tidak mengirim cookie).
// Body: { event, tenantId?, dbId?, data? }. Header opsional x-webhook-secret bila ACCURATE_WEBHOOK_SECRET diset.
webhookAccurateRouter.post("/integrations/accurate/webhook", asyncHandler(webhookAccurateHandler));

// POST /webhook — alias utk target URL yang terdaftar di Area Developer Accurate
// (https://103.253.244.13/webhook). Di-mount di app.ts tanpa prefix /api.
export const webhookRootRouter = Router();
webhookRootRouter.post("/webhook", asyncHandler(webhookAccurateHandler));

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
