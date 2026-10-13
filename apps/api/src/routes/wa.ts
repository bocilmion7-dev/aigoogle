import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { encryptToken } from "../crypto.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { requirePerm } from "../permissions.js";
import { writeAudit } from "../audit.js";
import { isBillingEnabled, billingServerKey, verifyWebhookSignature, type MidtransNotification } from "../billing/midtrans.js";
import {
  WA_COST_CREDITS_PER_MESSAGE,
  creditsFromRupiah,
  embeddedSignupUrl,
  getOrCreateBalance,
  getWaSettings,
  getWaProviderGlobal,
  getWaWebhookSettings,
  setWaWebhookSettings,
  WA_WEBHOOK_EVENT_OPTIONS,
  metaConfigured,
  setWaSettings,
  waPricePerCredit,
} from "../wa/service.js";

export const waRouter = Router();

waRouter.get(
  "/wa/status",
  requireUser,
  asyncHandler(async (req, res) => {
    const tenantId = req.user!.tenant.id;
    const acct = await prisma.waAccount.findUnique({ where: { tenantId } });
    const balance = await getOrCreateBalance(tenantId);
    const settings = await getWaSettings(tenantId);
    const recent = await prisma.waMessageLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, to: true, body: true, status: true, error: true, createdAt: true },
    });
    res.json({
      connected:
        (!!acct && acct.status === "connected" && (!!acct.phoneNumberId || acct.provider === "d360")) ||
        ((await getWaProviderGlobal()).provider === "d360" && !!(await prisma.appSetting.findUnique({ where: { key: "waD360ApiKey" } }))?.value),
      waProvider: (await getWaProviderGlobal()).provider,
      accountProvider: acct?.provider ?? null,
      waD360PartnerId:
        (await prisma.appSetting.findUnique({ where: { key: "waD360PartnerId" } }))?.value ?? "",
      account: acct
        ? {
            wabaId: acct.wabaId,
            phoneNumberId: acct.phoneNumberId,
            displayName: acct.displayName,
            status: acct.status,
          }
        : null,
      balance,
      costPerMessage: WA_COST_CREDITS_PER_MESSAGE,
      rupiahPerCredit: await waPricePerCredit(),
      settings,
      metaConfigured: metaConfigured(),
      embedUrl: embeddedSignupUrl(`${env.APP_ORIGIN}/wa/embed-callback`),
      billingEnabled: isBillingEnabled(),
      recent,
    });
  })
);

waRouter.put(
  "/wa/settings",
  requirePerm("app:settings.manage"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        autoDueDate: z.boolean().optional(),
        dailyReport: z.boolean().optional(),
        ownerPhone: z.string().max(32).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    await setWaSettings(req.user!.tenant.id, body.data);
    await writeAudit(req.user!.tenant.id, req.user!.id, "wa.settings", body.data);
    res.json(await getWaSettings(req.user!.tenant.id));
  })
);

// Callback Integrated Onboarding (Connect Button 360dialog): simpan client/channel,
// generate API key channel via Partner API, simpan sbg akun WhatsApp perusahaan.
// Model "managed by partner": kunci perusahaan dibuat otomatis — tanpa input manual.
waRouter.post(
  "/wa/d360/onboard",
  requirePerm("app:users.manage"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({ client: z.string().min(1).max(100), channels: z.array(z.string().min(1).max(100)).max(20) })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const partnerId = (await prisma.appSetting.findUnique({ where: { key: "waD360PartnerId" } }))?.value ?? "";
    const partnerKey = (await prisma.appSetting.findUnique({ where: { key: "waD360PartnerKey" } }))?.value ?? "";
    if (!partnerId || !partnerKey) return res.status(409).json({ error: "partner_belum_dikonfigurasi" });

    const channelId = body.data.channels[0];
    if (!channelId) return res.status(400).json({ error: "channel_kosong" });
    const kr = await fetch(
      `https://hub.360dialog.io/api/v2/partners/${encodeURIComponent(partnerId)}/channels/${encodeURIComponent(channelId)}/api_keys`,
      { method: "POST", headers: { "X-API-Key": partnerKey } }
    );
    if (!kr.ok) {
      const t = await kr.text().catch(() => "");
      // channel belum "running" (onboarding Meta masih diproses) → user klik lagi nanti
      return res.status(502).json({ error: `d360_${kr.status}:${t.slice(0, 220)}` });
    }
    const kj = (await kr.json()) as { api_key?: string; address?: string };
    if (!kj.api_key) return res.status(502).json({ error: "api_key_tidak_ada" });

    await prisma.waAccount.upsert({
      where: { tenantId: req.user!.tenant.id },
      create: {
        tenantId: req.user!.tenant.id,
        provider: "d360",
        wabaId: body.data.client,
        phoneNumberId: channelId,
        tokenEnc: encryptToken(kj.api_key),
        status: "connected",
      },
      update: {
        provider: "d360",
        wabaId: body.data.client,
        phoneNumberId: channelId,
        tokenEnc: encryptToken(kj.api_key),
        status: "connected",
      },
    });
    await writeAudit(req.user!.tenant.id, req.user!.id, "wa.d360.onboard", { client: body.data.client, channel: channelId });
    res.json({ ok: true, channel: channelId });
  })
);

// Notifikasi WhatsApp dari webhook Accurate: event yang diikuti + jeda antar-kirim + nomor tujuan
waRouter.get(
  "/wa/webhook-events",
  requirePerm("app:users.manage"),
  asyncHandler(async (req, res) => {
    res.json(await getWaWebhookSettings(req.user!.tenant.id));
  })
);

waRouter.put(
  "/wa/webhook-events",
  requirePerm("app:users.manage"),
  asyncHandler(async (req, res) => {
    const valid = new Set(WA_WEBHOOK_EVENT_OPTIONS.map((o) => o.key));
    const body = z
      .object({
        events: z.array(z.string().refine((v) => valid.has(v))).max(WA_WEBHOOK_EVENT_OPTIONS.length).optional(),
        rateMin: z.number().int().min(1).max(1440).optional(),
        ownerPhone: z.string().max(32).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    await setWaWebhookSettings(req.user!.tenant.id, body.data);
    await writeAudit(req.user!.tenant.id, req.user!.id, "wa.webhook_events", body.data);
    res.json(await getWaWebhookSettings(req.user!.tenant.id));
  })
);

waRouter.post(
  "/wa/topup",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = z.object({ amount: z.number().int().min(2000).max(10_000_000) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const tenantId = req.user!.tenant.id;
    const price = await waPricePerCredit();
    const credits = creditsFromRupiah(body.data.amount, price);
    if (credits < 1) return res.status(400).json({ error: "minimal_topup", min: price });
    const orderId = `wa-${randomBytes(8).toString("hex")}`;
    await prisma.waTopup.create({
      data: { tenantId, orderId, amount: body.data.amount, credits },
    });
    if (!isBillingEnabled()) {
      return res.status(503).json({ error: "billing_dormant", orderId, credits, amount: body.data.amount });
    }
    // Midtrans Snap — implementasi penuh menyusul; untuk sekarang order tercatat
    res.json({ orderId, credits, amount: body.data.amount, snapRedirect: null });
  })
);

waRouter.post(
  "/wa/webhook",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        order_id: z.string(),
        status_code: z.string(),
        gross_amount: z.string(),
        transaction_status: z.string(),
        payment_type: z.string().optional(),
        fraud_status: z.string().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    if (!isBillingEnabled()) return res.status(403).json({ error: "billing_dormant" });
    const signature = String(req.header("x-signature-key") ?? "");
    if (!verifyWebhookSignature(body.data as MidtransNotification, billingServerKey(), signature)) {
      return res.status(401).json({ error: "signature_tidak_valid" });
    }
    const topup = await prisma.waTopup.findUnique({ where: { orderId: body.data.order_id } });
    if (!topup) return res.status(404).json({ error: "order_tidak_ditemukan" });
    const paid = body.data.transaction_status === "settlement" || body.data.transaction_status === "capture";
    const failed = ["deny", "cancel", "expire", "failure"].includes(body.data.transaction_status);
    await prisma.waTopup.update({
      where: { id: topup.id },
      data: { status: body.data.transaction_status, paymentMethod: body.data.payment_type ?? "" },
    });
    if (paid && topup.status !== "settlement") {
      await prisma.waBalance.upsert({
        where: { tenantId: topup.tenantId },
        create: { tenantId: topup.tenantId, amount: topup.credits },
        update: { amount: { increment: topup.credits } },
      });
      await writeAudit(topup.tenantId, "system", "wa.topup_settled", { orderId: topup.orderId, credits: topup.credits });
    } else if (failed) {
      await writeAudit(topup.tenantId, "system", "wa.topup_failed", { orderId: topup.orderId, status: body.data.transaction_status });
    }
    res.json({ ok: true });
  })
);

/** Dev/mock: selesaikan topup tanpa Midtrans (hanya bila billing dormant). */
waRouter.post(
  "/wa/topup/:orderId/mock-settle",
  requireUser,
  asyncHandler(async (req, res) => {
    if (isBillingEnabled()) return res.status(409).json({ error: "billing_aktif" });
    const topup = await prisma.waTopup.findFirst({
      where: { orderId: req.params.orderId, tenantId: req.user!.tenant.id },
    });
    if (!topup) return res.status(404).json({ error: "tidak_ditemukan" });
    if (topup.status === "settlement") return res.status(409).json({ error: "sudah_settle" });
    await prisma.waTopup.update({ where: { id: topup.id }, data: { status: "settlement", paymentMethod: "mock" } });
    await prisma.waBalance.upsert({
      where: { tenantId: topup.tenantId },
      create: { tenantId: topup.tenantId, amount: topup.credits },
      update: { amount: { increment: topup.credits } },
    });
    res.json({ ok: true, credits: topup.credits, balance: await getOrCreateBalance(topup.tenantId) });
  })
);

/** Simpan hasil embedded signup (code → token) — credential Meta menyusul. */
waRouter.post(
  "/wa/embed-callback",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        code: z.string().optional(),
        wabaId: z.string().optional(),
        phoneNumberId: z.string().optional(),
        displayName: z.string().optional(),
        accessToken: z.string().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    if (!body.data.accessToken && !metaConfigured()) {
      return res.status(501).json({ error: "meta_app_belum_diset" });
    }
    const tenantId = req.user!.tenant.id;
    await prisma.waAccount.upsert({
      where: { tenantId },
      create: {
        tenantId,
        wabaId: body.data.wabaId ?? env.META_WABA_ID,
        phoneNumberId: body.data.phoneNumberId ?? "",
        displayName: body.data.displayName ?? "",
        tokenEnc: body.data.accessToken ? encryptToken(body.data.accessToken) : "",
        status: body.data.phoneNumberId && body.data.accessToken ? "connected" : "pending",
      },
      update: {
        wabaId: body.data.wabaId ?? env.META_WABA_ID,
        phoneNumberId: body.data.phoneNumberId ?? "",
        displayName: body.data.displayName ?? "",
        tokenEnc: body.data.accessToken ? encryptToken(body.data.accessToken) : undefined,
        status: body.data.phoneNumberId && body.data.accessToken ? "connected" : "pending",
      },
    });
    await writeAudit(tenantId, req.user!.id, "wa.embed_signup", {
      wabaId: body.data.wabaId,
      phoneNumberId: body.data.phoneNumberId,
    });
    res.json({ ok: true });
  })
);

waRouter.post(
  "/wa/send",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = z.object({ to: z.string().min(8).max(20), text: z.string().min(1).max(4000) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const { sendWaText } = await import("../wa/service.js");
    const r = await sendWaText(req.user!.tenant.id, body.data.to, body.data.text);
    if (!r.ok) return res.status(409).json({ error: r.error });
    res.json({ ok: true, balance: await getOrCreateBalance(req.user!.tenant.id) });
  })
);
