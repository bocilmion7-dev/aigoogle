import { Router } from "express";
import { asyncHandler } from "../asyncHandler.js";
import { prisma } from "../db.js";
import { requireUser } from "../middleware/session.js";
import { requirePerm } from "../permissions.js";
import { ACCURATE_WEBHOOK_EVENTS } from "../providers/accounting/accurate-paths.js";
import { ACCURATE_REDIRECT_URI, realAccurateProvider } from "../providers/accounting/index.js";
import { invalidateTenantCache, EVENT_TO_CACHE_PREFIX } from "../cache.js";
import { sendWaText } from "../wa/service.js";

export const webhookAccurateRouter = Router();

// CTA OAuth: redirect ke authorize Accurate dgn scope penuh (196 scope resmi dari manifest).
// State SELALU kosong: /api/callback/accurate pakai requireState:false; state kustom
// akan ditolak pending map (/ (?error=state)).
webhookAccurateRouter.get("/integrations/accurate/authorize", (_req, res) => {
  res.redirect(302, realAccurateProvider().authorizeUrl({ redirectUri: ACCURATE_REDIRECT_URI, state: "" }));
});

/**
 * tenant utk event masuk: tenantId eksplisit (proses internal) → petakan dbId ke
 * tenant (provider+providerDbId) → TOLAK bila tak terpetakan.
 * JANGAN jatuh ke "tenant pertama": payload perusahaan lain akan tercatat sbg
 * event (dan notifikasi WA) milik tenant yang salah → bocor antar-tenant.
 */
async function resolveTenant(explicit: string | undefined, dbId: string | undefined): Promise<string | null> {
  if (explicit) {
    const t = await prisma.tenant.findUnique({ where: { id: explicit } });
    if (t) return t.id;
  }
  if (dbId) {
    const t = await prisma.tenant.findFirst({
      where: { provider: "accurate", providerDbId: dbId },
    });
    if (t) return t.id;
  }
  return null;
}

/**
 * Notifikasi WhatsApp otomatis saat event yang diikuti masuk.
 * Config per tenant di appSetting: wa:webhook_events (JSON array event),
 * wa:webhook_rate (menit antar-kirim per event, default 10), wa:owner_phone (tujuan).
 * Rate-limit/dedup via wa:webhook_last_sent:{tenantId}:{event}.
 */
async function handleWebhookNotification(
  tenantId: string,
  event: string,
  payload: unknown,
  eventCreatedAt: Date,
  dbId: string
): Promise<void> {
  try {
    const keys = [
      `wa:webhook_events:${tenantId}`,
      `wa:webhook_rate:${tenantId}`,
      `wa:owner_phone:${tenantId}`,
      `wa:webhook_last_sent:${tenantId}:${event}`,
    ];
    const rows = await prisma.appSetting.findMany({ where: { key: { in: keys } } });
    const m = new Map(rows.map((r) => [r.key, r.value]));
    const follow: string[] = (() => {
      const v = m.get(`wa:webhook_events:${tenantId}`);
      try { return JSON.parse(v ?? "[]"); } catch { return []; }
    })();
    if (!follow.includes(event)) return;
    const rateMin = Number(m.get(`wa:webhook_rate:${tenantId}`) ?? 10) || 10;
    const lastKey = `wa:webhook_last_sent:${tenantId}:${event}`;
    const lastSent = m.get(lastKey);
    if (lastSent) {
      const ms = eventCreatedAt.getTime() - new Date(lastSent).getTime();
      if (ms < rateMin * 60000) return;
    }
    const to = String(m.get(`wa:owner_phone:${tenantId}`) ?? "");
    if (!to) return;
    const body = webhookNotificationBody(event, payload, dbId);
    // sendWaText sudah mencatat waMessageLog (sent/failed + alasan) sendiri
    const sent = await sendWaText(tenantId, to, body);
    await prisma.appSetting.upsert({
      where: { key: lastKey },
      create: { key: lastKey, value: eventCreatedAt.toISOString() },
      update: { value: eventCreatedAt.toISOString() },
    });
    if (!sent.ok) console.warn(`[webhook-notif] kirim WA gagal: ${sent.error}`);
  } catch (e) {
    // notifikasi = opsional; gagal jangan sampai memblokir webhook
    console.error("[webhook-notif] gagal", String(e).slice(0, 300));
  }
}

function webhookNotificationBody(event: string, payload: unknown, dbId: string): string {
  const data = (payload as Record<string, unknown>)?.data ?? payload;
  const d = data as Record<string, unknown>;
  const parts: string[] = [];
  parts.push(`[${event}]${dbId ? " DB " + dbId : ""} Accurate Online`);
  if (event === "CUSTOMER") {
    parts.push(`Pelanggan ${String(d.name ?? "")}`);
  } else if (event === "SALES_INVOICE") {
    parts.push(
      `Faktur ${String(d.no ?? "")} ke ${String(d.customerName ?? d.customer ?? "")} ` +
        `Rp${Number(d.totalAmount ?? d.total ?? 0).toLocaleString("id-ID")}`
    );
  } else if (event === "PURCHASE_INVOICE") {
    parts.push(`Faktur pembelian ${String(d.no ?? "")} dari ${String(d.vendorName ?? "")} Rp${Number(d.totalAmount ?? d.total ?? 0).toLocaleString("id-ID")}`);
  } else if (event === "SALES_ORDER") {
    parts.push(`Pesanan penjualan ${String(d.no ?? "")} ke ${String(d.customerName ?? "")}`);
  } else if (event === "PURCHASE_ORDER") {
    parts.push(`Pesanan pembelian ${String(d.no ?? "")} dari ${String(d.vendorName ?? "")}`);
  } else if (event === "VENDOR") {
    parts.push(`Pemasok ${String(d.name ?? "")}`);
  } else if (event === "ITEM") {
    parts.push(`Barang/jasa ${String(d.name ?? "")}`);
  } else if (event === "JOURNAL_VOUCHER") {
    parts.push(`Buku jurnal ${String(d.no ?? "")}`);
  } else {
    parts.push(`Data ${event} berubah`);
  }
  return parts.filter(Boolean).join(" | ");
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
  const tenantId = await resolveTenant(b.tenantId, b.dbId ? String(b.dbId) : undefined);
  if (!tenantId) {
    // dbId tidak dikenal → JANGAN jatuh ke tenant lain (mencegah bocor antar-tenant)
    res.status(404).json({ error: "tenant_tidak_dikenal" });
    return;
  }
  const evt = await prisma.accurateWebhookEvent.create({
    data: {
      tenantId,
      event: b.event,
      dbId: String(b.dbId ?? ""),
      // payload + _meta (appKey & header mentah) utk audit format push asli
      payload: JSON.stringify({ data: b.data ?? b, _meta: { appKey: appKey.status, headers: req.headers } }),
    },
  });
  // tindak lanjut: notifikasi WA + invalidasi cache (asinkron, jangan blokir respons)
  void handleWebhookNotification(tenantId, b.event, b.data ?? b, evt.createdAt, evt.dbId)
    .catch(console.error);
  void invalidateTenantCache(tenantId, EVENT_TO_CACHE_PREFIX[b.event] ?? "accurate:");
  res.json({ ok: true });
}

// POST /api/integrations/accurate/webhook — PUBLIK (Accurate tidak mengirim cookie).
// Body: { event, tenantId?, dbId?, data? }. Header opsional x-webhook-secret bila ACCURATE_WEBHOOK_SECRET diset.
webhookAccurateRouter.post("/integrations/accurate/webhook", asyncHandler(webhookAccurateHandler));

// POST /webhook — alias utk target URL yang terdaftar di Area Developer Accurate
// (https://103.253.244.13/webhook). Di-mount di app.ts tanpa prefix /api.
export const webhookRootRouter = Router();
webhookRootRouter.post("/webhook", asyncHandler(webhookAccurateHandler));

// GET /api/accurate/webhook-events?event=&take= — tenant-scoped (activity feed Admin Accurate)
// (requireUser ikut di route ini saja — .use() tanpa path akan menangkap semua path router ini)
webhookAccurateRouter.get(
  "/accurate/webhook-events",
  requireUser,
  requirePerm("app:audit.view"), // staf tidak melihat aktivitas; admin perusahaan & platform boleh
  asyncHandler(async (req, res) => {
    const take = Math.min(500, Number(req.query.take ?? 50) || 50);
    const rows = await prisma.accurateWebhookEvent.findMany({
      where: {
        tenantId: req.user!.tenant.id,
        ...(req.query.event ? { event: String(req.query.event) } : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, event: true, dbId: true, payload: true, createdAt: true },
    });
    const enriched = rows.map((r) => {
      let payload: unknown = r.payload;
      try { payload = JSON.parse(r.payload); } catch { /* raw string */ }
      return { ...r, payload };
    });
    res.json({ s: true, d: enriched });
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
