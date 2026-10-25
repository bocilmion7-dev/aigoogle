import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser, requirePlatform } from "../middleware/session.js";
import { requirePerm } from "../permissions.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { isBillingEnabled } from "../billing/midtrans.js";
import { generateQrMpm, midtransSnapReady } from "../billing/midtrans-snap.js";
import {
  adjustWallet,
  aiAccessStatus,
  billingSettings,
  finalizeAiTopup,
  getAiSubPlans,
  getAiTopupPackages,
  ledgerFor,
  revenueReport,
  rupiahToTokens,
  syncOpenRouterPricing,
  tokensToRupiah,
  topupFee,
  walletSummary,
} from "../ai/billing.js";

export const aiBillingRouter = Router();

/** GET /api/ai/wallet — saldo + ringkasan 30 hari (untuk header & halaman saldo) */
aiBillingRouter.get(
  "/ai/wallet",
  requireUser,
  asyncHandler(async (req, res) => {
    res.json(await walletSummary(req.user!.id, req.user!.tenant.id));
  })
);

/** GET /api/ai/ledger?take=50 — riwayat saldo (usage/topup/adjust/bonus) */
aiBillingRouter.get(
  "/ai/ledger",
  requireUser,
  asyncHandler(async (req, res) => {
    const take = Number(req.query.take ?? 10) || 10;
    const skip = Number(req.query.skip ?? 0) || 0;
    const rows = await ledgerFor(req.user!.id, take, skip);
    const cfg = await billingSettings();
    res.json(
      rows.map((r) => ({
        ...r,
        /** jumlah token: pemakaian = token nyata; topup/bonus/adjust = konversi dari rupiah */
        tokens:
          r.kind === "usage"
            ? r.promptTokens + r.completionTokens
            : Math.sign(r.amount) * rupiahToTokens(Math.abs(r.amount), cfg.rupiahPer1kTokens),
      }))
    );
  })
);

/** POST /api/ai/topup {packageId} → QRIS (Midtrans). `amount` lama tetap didukung. */
aiBillingRouter.post(
  "/ai/topup",
  rateLimit({ name: "ai-topup", windowMs: 60_000, max: 10 }),
  requireUser,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        packageId: z.string().min(1).max(24).optional(),
        amount: z.number().int().min(10_000).max(10_000_000).optional(),
      })
      .refine((b) => !!b.packageId || b.amount !== undefined, { message: "packageId atau amount wajib" })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request", min: 10_000 });

    const cfg = await billingSettings();
    let baseAmount: number;
    let tokenAmount: number;
    if (body.data.packageId) {
      const pkg = (await getAiTopupPackages()).find((p) => p.id === body.data.packageId);
      if (!pkg) return res.status(400).json({ error: "paket_tidak_ditemukan" });
      baseAmount = pkg.price;
      tokenAmount = pkg.tokens;
    } else {
      baseAmount = body.data.amount!;
      tokenAmount = rupiahToTokens(baseAmount, cfg.rupiahPer1kTokens);
    }
    // saldo internal disimpan dalam rupiah; token paket dikonversi agar tampilan token pas
    const credits = body.data.packageId ? tokensToRupiah(tokenAmount, cfg.rupiahPer1kTokens) : baseAmount;
    const feeAmount = topupFee(baseAmount);
    const totalAmount = baseAmount + feeAmount;
    const orderId = `ai-${randomBytes(8).toString("hex")}`;
    const topup = await prisma.aiTopup.create({
      data: {
        orderId,
        userId: req.user!.id,
        tenantId: req.user!.tenant.id,
        amount: totalAmount,
        credits,
      },
    });
    if (!isBillingEnabled() || !midtransSnapReady()) {
      return res.status(503).json({
        error: "billing_dormant",
        orderId: topup.orderId,
        amount: totalAmount,
        feeAmount,
        credits,
        tokens: tokenAmount,
      });
    }
    try {
      const qr = await generateQrMpm(orderId, totalAmount);
      await prisma.aiTopup.update({ where: { id: topup.id }, data: { providerRef: qr.referenceNo } });
      return res.json({
        orderId,
        amount: totalAmount,
        feeAmount,
        credits,
        tokens: tokenAmount,
        provider: "midtrans",
        qris: qr,
      });
    } catch (e) {
      return res.status(502).json({
        error: "qris_gagal",
        detail: String(e instanceof Error ? e.message : e).slice(0, 200),
        orderId,
      });
    }
  })
);

/** GET /api/ai/subscription — paket langganan bulanan + status langganan perusahaan */
aiBillingRouter.get(
  "/ai/subscription",
  requireUser,
  asyncHandler(async (req, res) => {
    const [plans, sub, wallet, access] = await Promise.all([
      getAiSubPlans(),
      prisma.subscription.findFirst({
        where: { tenantId: req.user!.tenant.id, plan: { startsWith: "ai:" } },
        orderBy: { createdAt: "desc" },
      }),
      walletSummary(req.user!.id, req.user!.tenant.id),
      aiAccessStatus(req.user!.id, req.user!.tenant.id),
    ]);
    const active = !!sub && sub.status === "active" && (!sub.expiresAt || sub.expiresAt > new Date());
    res.json({
      plans,
      wallet,
      access,
      subscription: sub
        ? {
            plan: sub.plan.replace(/^ai:/, ""),
            status: sub.status,
            expiresAt: sub.expiresAt?.toISOString() ?? null,
            active,
          }
        : null,
    });
  })
);

/** POST /api/ai/subscription {planId} → QRIS langganan bulanan */
aiBillingRouter.post(
  "/ai/subscription",
  rateLimit({ name: "ai-sub", windowMs: 60_000, max: 10 }),
  requireUser,
  asyncHandler(async (req, res) => {
    const body = z.object({ planId: z.string().min(1).max(24) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const plan = (await getAiSubPlans()).find((p) => p.id === body.data.planId);
    if (!plan) return res.status(400).json({ error: "paket_tidak_ditemukan" });
    if (!isBillingEnabled() || !midtransSnapReady()) {
      return res.status(503).json({ error: "billing_dormant", plan });
    }
    const tenantId = req.user!.tenant.id;
    // durasi & token disimpan di orderId agar callback tetap akurat walau setelan berubah
    const orderId = `subl-${plan.id}-${plan.months}m-${plan.tokens}-${randomBytes(6).toString("hex")}`;
    await prisma.payment.create({ data: { tenantId, orderId, amount: plan.price, status: "pending" } });
    try {
      const qr = await generateQrMpm(orderId, plan.price);
      await prisma.payment.update({ where: { orderId }, data: { paymentMethod: "qris", fraudStatus: qr.referenceNo } });
      return res.json({ orderId, amount: plan.price, plan, months: plan.months, tokens: plan.tokens, qris: qr });
    } catch (e) {
      return res.status(502).json({
        error: "qris_gagal",
        detail: String(e instanceof Error ? e.message : e).slice(0, 200),
        orderId,
      });
    }
  })
);

/** GET /api/ai/topup/:orderId — cek status (frontend polling) */
aiBillingRouter.get(
  "/ai/topup/:orderId",
  requireUser,
  asyncHandler(async (req, res) => {
    const row = await prisma.aiTopup.findFirst({
      where: { orderId: req.params.orderId, userId: req.user!.id },
    });
    if (!row) return res.status(404).json({ error: "tidak_ditemukan" });
    res.json({ orderId: row.orderId, status: row.status, credits: row.credits, amount: row.amount });
  })
);

/** POST /api/ai/topup/:orderId/mock-settle — dev/mock (saat billing dormant) */
aiBillingRouter.post(
  "/ai/topup/:orderId/mock-settle",
  requireUser,
  asyncHandler(async (req, res) => {
    if (isBillingEnabled() && midtransSnapReady()) return res.status(403).json({ error: "billing_aktif" });
    const row = await prisma.aiTopup.findFirst({ where: { orderId: req.params.orderId, userId: req.user!.id } });
    if (!row) return res.status(404).json({ error: "tidak_ditemukan" });
    await finalizeAiTopup(row.orderId, true, "settlement", "mock");
    res.json({ ok: true, orderId: row.orderId, credits: row.credits });
  })
);

/** GET /api/admin/ai/wallets — saldo semua member perusahaan */
aiBillingRouter.get(
  "/admin/ai/wallets",
  requireUser,
  requirePerm("app:users.manage"),
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { tenantId: req.user!.tenant.id },
      select: { id: true, name: true, email: true, role: { select: { name: true } } },
      orderBy: { name: "asc" },
    });
    const wallets = await prisma.aiWallet.findMany({ where: { tenantId: req.user!.tenant.id } });
    const bal = new Map(wallets.map((w) => [w.userId, w.balance]));
    res.json(
      users.map((u) => ({
        userId: u.id,
        name: u.name,
        email: u.email,
        role: u.role?.name ?? "",
        balance: bal.get(u.id) ?? null,
      }))
    );
  })
);

/** POST /api/admin/ai/wallets/:userId/adjust {amount, note} — isi/kurangi saldo member */
aiBillingRouter.post(
  "/admin/ai/wallets/:userId/adjust",
  requireUser,
  requirePerm("app:users.manage"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({ amount: z.number().int().min(-10_000_000).max(10_000_000), note: z.string().max(200).default("") })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const target = await prisma.user.findFirst({
      where: { id: req.params.userId, tenantId: req.user!.tenant.id },
      select: { id: true },
    });
    if (!target) return res.status(404).json({ error: "user_tidak_ditemukan" });
    const out = await adjustWallet({
      userId: target.id,
      tenantId: req.user!.tenant.id,
      amount: body.data.amount,
      note: body.data.note,
      byUserId: req.user!.id,
    });
    res.json({ ok: true, ...out });
  })
);

// ── Platform: harga, setelan, laporan ───────────────────────────────────────

aiBillingRouter.get(
  "/platform/ai/pricing",
  requirePlatform,
  asyncHandler(async (_req, res) => {
    const [rows, cfg] = await Promise.all([prisma.aiModelPrice.findMany({ orderBy: { model: "asc" } }), billingSettings()]);
    res.json({ settings: cfg, models: rows });
  })
);

aiBillingRouter.put(
  "/platform/ai/pricing",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        settings: z
          .object({
            usdIdr: z.number().min(1).max(1_000_000).optional(),
            markup: z.number().min(1).max(20).optional(),
            signupBonus: z.number().min(0).max(10_000_000).optional(),
            minReserve: z.number().min(1).max(1_000_000).optional(),
          })
          .optional(),
        models: z
          .array(
            z.object({
              model: z.string().min(1).max(80),
              openrouterId: z.string().max(120).optional().default(""),
              inputUsdPer1M: z.number().min(0).max(1000),
              outputUsdPer1M: z.number().min(0).max(1000),
              markup: z.number().min(1).max(20).optional(),
            })
          )
          .optional(),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request", issues: body.error.issues });

    const setKey = async (key: string, value: number) => {
      const v = String(value);
      await prisma.appSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
    };
    if (body.data.settings) {
      const s = body.data.settings;
      if (s.usdIdr !== undefined) await setKey("ai:usd_idr", s.usdIdr);
      if (s.markup !== undefined) await setKey("ai:markup", s.markup);
      if (s.signupBonus !== undefined) await setKey("ai:signup_bonus", s.signupBonus);
      if (s.minReserve !== undefined) await setKey("ai:min_reserve", s.minReserve);
    }
    for (const m of body.data.models ?? []) {
      await prisma.aiModelPrice.upsert({
        where: { model: m.model },
        create: {
          model: m.model,
          openrouterId: m.openrouterId,
          inputUsdPer1M: m.inputUsdPer1M,
          outputUsdPer1M: m.outputUsdPer1M,
          markup: m.markup ?? 1.5,
          source: m.openrouterId ? "openrouter" : "manual",
        },
        update: {
          openrouterId: m.openrouterId,
          inputUsdPer1M: m.inputUsdPer1M,
          outputUsdPer1M: m.outputUsdPer1M,
          ...(m.markup !== undefined ? { markup: m.markup } : {}),
        },
      });
    }
    const [rows, cfg] = await Promise.all([prisma.aiModelPrice.findMany({ orderBy: { model: "asc" } }), billingSettings()]);
    res.json({ ok: true, settings: cfg, models: rows });
  })
);

aiBillingRouter.post(
  "/platform/ai/pricing/sync",
  requirePlatform,
  asyncHandler(async (_req, res) => {
    try {
      res.json({ ok: true, ...(await syncOpenRouterPricing()) });
    } catch (e) {
      res.status(502).json({ error: "sync_gagal", detail: e instanceof Error ? e.message.slice(0, 200) : "error" });
    }
  })
);

aiBillingRouter.get(
  "/platform/ai/revenue",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    res.json(await revenueReport(days));
  })
);
