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
import { generateQrMpm, midtransSnapReady, midtransEnv } from "../billing/midtrans-snap.js";
import { applyShopPaymentResult } from "../wa/shop-settle.js";
import { listShopOrders } from "../wa/shop-order.js";
import {
  WA_COST_CREDITS_PER_MESSAGE,
  creditsFromRupiah,
  embeddedSignupUrl,
  getOrCreateBalance,
  getWaSettings,
  getWaProviderGlobal,
  getWaMetaTopups,
  getWaSubPlans,
  getWaWebhookSettings,
  setWaWebhookSettings,
  WA_WEBHOOK_EVENT_OPTIONS,
  metaConfigured,
  setWaSettings,
  waPricePerCredit,
  finalizeWaTopup,
  ensureWaserverSession,
  getWaserverSession,
  handleWaserverEvent,
  reconnectWaserverSession,
  removeWaserverSession,
  syncWaserverAccount,
  waserverReady,
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
    const sub = await prisma.subscription.findFirst({
      where: { tenantId: req.user!.tenant.id, plan: "wa_gateway" },
      orderBy: { createdAt: "desc" },
    });
    const subActive = !!sub && sub.status === "active" && (!sub.expiresAt || sub.expiresAt > new Date());
    res.json({
      // terhubung = akun milik PERUSAHAAN sendiri (hasil onboarding/embedded signup),
      // BUKAN sekadar key sandbox platform tersedia — nomor (phoneNumberId) juga wajib ada,
      // baris setengah jadi (token ada, nomor kosong) dianggap belum terhubung
      connected:
        !!acct &&
        acct.status === "connected" &&
        // waserver: koneksi dipegang gateway Baileys — tak butuh tokenEnc/phoneNumberId Meta
        (acct.provider === "waserver" || (!!acct.tokenEnc && !!acct.phoneNumberId)),
      waProvider: (await getWaProviderGlobal()).provider,
      waserverReady: waserverReady(),
      accountProvider: acct?.provider ?? null,
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
      billingEnabled: isBillingEnabled() && midtransSnapReady(),
      subPlans: await getWaSubPlans(),
      metaTopups: await getWaMetaTopups(),
      waSubscription: sub
        ? {
            plan: sub.plan,
            status: sub.status,
            expiresAt: sub.expiresAt?.toISOString() ?? null,
            active: subActive,
          }
        : null,
      recent,
    });
  })
);

/** Daftar percakapan WhatsApp (dikelompokkan per nomor lawan bicara). */
waRouter.get(
  "/wa/chats",
  requireUser,
  asyncHandler(async (req, res) => {
    const tenantId = req.user!.tenant.id;
    const groups = await prisma.waMessageLog.groupBy({
      by: ["to"],
      // nomor semu sandbox (sandbox:<userId>) tidak ditampilkan sebagai chat asli
      where: { tenantId, to: { not: "" }, NOT: { to: { startsWith: "sandbox:" } } },
      _max: { createdAt: true },
      _count: { _all: true },
    });
    const sorted = groups
      .filter((g) => g.to)
      .sort((a, b) => (b._max.createdAt?.getTime() ?? 0) - (a._max.createdAt?.getTime() ?? 0))
      .slice(0, 100);
    const peers = sorted.map((g) => g.to);
    const latest = peers.length
      ? await prisma.waMessageLog.findMany({
          where: { tenantId, to: { in: peers } },
          orderBy: { createdAt: "desc" },
          select: { to: true, body: true, direction: true, status: true, createdAt: true, error: true },
        })
      : [];
    const lastByPeer = new Map<string, (typeof latest)[number]>();
    for (const row of latest) if (!lastByPeer.has(row.to)) lastByPeer.set(row.to, row);
    res.json(
      sorted.map((g) => {
        const last = lastByPeer.get(g.to);
        return {
          peer: g.to,
          lastMessage: last?.body ?? "",
          lastAt: last?.createdAt ?? g._max.createdAt,
          direction: last?.direction ?? "out",
          status: last?.status ?? "",
          error: last?.error ?? "",
          count: g._count._all,
        };
      })
    );
  })
);

/** Isi percakapan dengan satu nomor WhatsApp. */
waRouter.get(
  "/wa/chats/:peer/messages",
  requireUser,
  asyncHandler(async (req, res) => {
    const peer = String(req.params.peer ?? "").slice(0, 32);
    if (!peer) return res.status(400).json({ error: "bad_request" });
    const rows = await prisma.waMessageLog.findMany({
      where: { tenantId: req.user!.tenant.id, to: peer },
      orderBy: { createdAt: "asc" },
      take: 500,
      select: { id: true, body: true, direction: true, status: true, error: true, createdAt: true },
    });
    res.json(rows);
  })
);

/**
 * Pesanan toko (AI penjaga toko) utk satu percakapan — dipakai halaman chat
 * utk menampilkan status QRIS dan tombol simulator pembayaran.
 * `simulator` hanya true di lingkungan non-produksi (MIDTRANS_ENV != production).
 */
waRouter.get(
  "/wa/shop/orders",
  requireUser,
  asyncHandler(async (req, res) => {
    const peer = String(req.query.peer ?? "").slice(0, 32);
    const orders = await listShopOrders(req.user!.tenant.id, peer || undefined);
    res.json({ simulator: midtransEnv() !== "production", orders });
  })
);

/**
 * Simulator pembayaran pesanan toko — menandai pesanan LUNAS lewat jalur yang
 * sama dengan notifikasi BI-SNAP (payment → order → WA pemilik/pembeli → audit),
 * sehingga datanya nyata, bukan baris uji terpisah.
 * Dibuka utk billing aktif; hanya sandbox/non-produksi dan admin perusahaan.
 */
waRouter.post(
  "/wa/shop/orders/:orderId/settle-test",
  requireUser,
  requirePerm("app:users.manage"),
  asyncHandler(async (req, res) => {
    if (midtransEnv() === "production") return res.status(409).json({ error: "bukan_sandbox" });
    const orderId = String(req.params.orderId ?? "").slice(0, 64);
    const payment = await prisma.payment.findFirst({ where: { orderId, tenantId: req.user!.tenant.id } });
    if (!payment) return res.status(404).json({ error: "tidak_ditemukan" });
    if (payment.status === "settlement") return res.status(409).json({ error: "sudah_settle" });
    const r = await applyShopPaymentResult({
      orderId,
      paymentStatus: "settlement",
      source: "simulator",
      actor: req.user!.id,
    });
    if (!r.found) return res.status(404).json({ error: "tidak_ditemukan" });
    await writeAudit(req.user!.tenant.id, req.user!.id, "wa.shop_order_settle_test", {
      orderId,
      amount: payment.amount,
    });
    res.json({ ok: true, orderId, status: "paid" });
  })
);

waRouter.put(
  "/wa/settings",
  requirePerm("app:users.manage"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        autoDueDate: z.boolean().optional(),
        dailyReport: z.boolean().optional(),
        ownerPhone: z.string().max(32).optional(),
        shopAi: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    await setWaSettings(req.user!.tenant.id, body.data);
    await writeAudit(req.user!.tenant.id, req.user!.id, "wa.settings", body.data);
    res.json(await getWaSettings(req.user!.tenant.id));
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
    // Biaya admin service charges 0.2% ditambah pada total yang dibayar;
    // kredit dihitung dari jumlah pokok (tanpa biaya admin).
    const baseAmount = body.data.amount;
    const feeAmount = Math.floor(baseAmount * 0.002);
    const totalAmount = baseAmount + feeAmount;
    const credits = creditsFromRupiah(baseAmount, price);
    if (credits < 1) return res.status(400).json({ error: "minimal_topup", min: price });

    if (!isBillingEnabled() || !midtransSnapReady()) {
      return res.status(503).json({ error: "billing_dormant", credits, amount: totalAmount, feeAmount, baseAmount });
    }
    const orderId = `mt-${randomBytes(8).toString("hex")}`;
    await prisma.waTopup.create({
      data: { tenantId, orderId, amount: totalAmount, credits },
    });
    try {
      const qr = await generateQrMpm(orderId, totalAmount);
      await prisma.waTopup.update({
        where: { orderId },
        data: { paymentMethod: "midtrans", providerRef: qr.referenceNo },
      });
      return res.json({ orderId, credits, amount: totalAmount, feeAmount, baseAmount, provider: "midtrans", qris: qr });
    } catch (e) {
      return res.status(502).json({
        error: "qris_gagal",
        detail: String(e instanceof Error ? e.message : e).slice(0, 200),
        orderId,
        credits,
      });
    }
  })
);

/** Langganan gateway WhatsApp waserver via Midtrans — paket diatur Admin Platform (3 paket). */
waRouter.post(
  "/wa/subscribe",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = z.object({ plan: z.string().min(1).max(40) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const plans = await getWaSubPlans();
    const plan = plans.find((p) => p.id === body.data.plan);
    if (!plan) return res.status(400).json({ error: "paket_tidak_ditemukan" });
    if (!isBillingEnabled() || !midtransSnapReady()) {
      return res.status(503).json({ error: "billing_dormant", amount: plan.price, plan });
    }
    const tenantId = req.user!.tenant.id;
    // durasi bulan disimpan di orderId (`wg-<bulan>m-<ref>`) agar callback tahu paketnya
    const orderId = `wg-${plan.months}m-${randomBytes(8).toString("hex")}`;
    await prisma.payment.create({ data: { tenantId, orderId, amount: plan.price, status: "pending" } });
    try {
      const qr = await generateQrMpm(orderId, plan.price);
      await prisma.payment.update({ where: { orderId }, data: { paymentMethod: "qris", fraudStatus: qr.referenceNo } });
      return res.json({ orderId, amount: plan.price, plan, months: plan.months, qris: qr });
    } catch (e) {
      return res.status(502).json({
        error: "qris_gagal",
        detail: String(e instanceof Error ? e.message : e).slice(0, 200),
        orderId,
      });
    }
  })
);

waRouter.get(
  "/wa/subscribe/:orderId/status",
  requireUser,
  asyncHandler(async (req, res) => {
    const payment = await prisma.payment.findFirst({
      where: { orderId: req.params.orderId, tenantId: req.user!.tenant.id },
    });
    if (!payment) return res.status(404).json({ error: "tidak_ditemukan" });
    res.json({
      orderId: payment.orderId,
      amount: payment.amount,
      status: payment.status,
      settled: payment.status === "settlement",
    });
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
        /** standar notifikasi HTTP Midtrans: signature ada di body, bukan header */
        signature_key: z.string().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    if (!isBillingEnabled()) return res.status(403).json({ error: "billing_dormant" });
    const signature = String(body.data.signature_key ?? req.header("x-signature-key") ?? "");
    if (!verifyWebhookSignature(body.data as MidtransNotification, billingServerKey(), signature)) {
      return res.status(401).json({ error: "signature_tidak_valid" });
    }
    const topup = await prisma.waTopup.findUnique({ where: { orderId: body.data.order_id } });
    if (!topup) return res.status(404).json({ error: "order_tidak_ditemukan" });
    // Idempoten: replay notifikasi yang sama tidak boleh memproses ulang.
    if (topup.status === body.data.transaction_status) {
      return res.json({ ok: true, ignored: true });
    }
    if (topup.status === "settlement" && !["settlement", "capture"].includes(body.data.transaction_status)) {
      return res.json({ ok: true, ignored: true });
    }
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

/** Status topup utk polling UI. */
waRouter.get(
  "/wa/topup/:orderId/status",
  requireUser,
  asyncHandler(async (req, res) => {
    const order = await prisma.waTopup.findFirst({
      where: { orderId: req.params.orderId, tenantId: req.user!.tenant.id },
    });
    if (!order) return res.status(404).json({ error: "tidak_ditemukan" });
    res.json({
      status: order.status,
      settled: order.status === "settlement",
      credits: order.credits,
      balance: await getOrCreateBalance(order.tenantId),
    });
  })
);

/** Dev/mock: selesaikan topup tanpa Midtrans (hanya bila billing dormant). */
waRouter.post(
  "/wa/topup/:orderId/mock-settle",
  requireUser,
  asyncHandler(async (req, res) => {
    if (isBillingEnabled() && midtransSnapReady()) return res.status(409).json({ error: "billing_aktif" });
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

// ── Aktivasi Waserver (gateway WhatsApp multi-tenant berbasis Baileys) ──
// Dipakai perusahaan utk men-scan QR dari HP, tanpa perlu akses ke panel gateway.

waRouter.get(
  "/wa/waserver/session",
  requireUser,
  asyncHandler(async (req, res) => {
    if (!waserverReady()) return res.status(503).json({ error: "waserver_belum_dikonfigurasi" });
    const tenantId = req.user!.tenant.id;
    const session = await ensureWaserverSession(tenantId, req.user!.tenant.alias ?? "");
    if (!session) return res.status(502).json({ error: "waserver_tidak_terjangkau" });
    await syncWaserverAccount(tenantId, session);
    res.json({
      ready: true,
      state: session.state,
      phone: session.phone,
      qr: session.qr,
      connected: session.state === "connected",
    });
  })
);

waRouter.post(
  "/wa/waserver/reconnect",
  requireUser,
  asyncHandler(async (req, res) => {
    if (!waserverReady()) return res.status(503).json({ error: "waserver_belum_dikonfigurasi" });
    const tenantId = req.user!.tenant.id;
    const ok = await reconnectWaserverSession(tenantId);
    if (!ok) return res.status(502).json({ error: "waserver_tidak_terjangkau" });
    await writeAudit(tenantId, req.user!.id, "wa.waserver_reconnect", {});
    res.json({ ok: true });
  })
);

waRouter.delete(
  "/wa/waserver/session",
  requireUser,
  asyncHandler(async (req, res) => {
    if (!waserverReady()) return res.status(503).json({ error: "waserver_belum_dikonfigurasi" });
    const tenantId = req.user!.tenant.id;
    const ok = await removeWaserverSession(tenantId);
    if (ok) {
      await prisma.waAccount.updateMany({
        where: { tenantId, provider: "waserver" },
        data: { status: "pending" },
      });
      await writeAudit(tenantId, req.user!.id, "wa.waserver_disconnected", {});
    }
    res.json({ ok });
  })
);

// Event balikan dari gateway (pesan masuk, status kirim, status sesi).
// Tanpa sesi login — diverifikasi lewat kunci bersama X-Events-Key; fail-closed
// bila WASERVER_EVENTS_KEY belum diisi agar endpoint tak jadi terbuka.
waRouter.post(
  "/wa/waserver/events",
  asyncHandler(async (req, res) => {
    const key = req.header("x-events-key") ?? "";
    if (!env.WASERVER_EVENTS_KEY || key !== env.WASERVER_EVENTS_KEY) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const r = await handleWaserverEvent(req.body);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  })
);

waRouter.post(
  "/wa/send",
  requireUser,
  requirePerm("app:wa.send"),
  asyncHandler(async (req, res) => {
    const body = z.object({ to: z.string().min(8).max(20), text: z.string().min(1).max(4000) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const { sendWaText } = await import("../wa/service.js");
    const r = await sendWaText(req.user!.tenant.id, body.data.to, body.data.text);
    if (!r.ok) return res.status(409).json({ error: r.error });
    res.json({ ok: true, balance: await getOrCreateBalance(req.user!.tenant.id) });
  })
);
