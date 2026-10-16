import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { isBillingEnabled, billingServerKey, verifyWebhookSignature, type MidtransNotification } from "../billing/midtrans.js";
import { isEntitled } from "../billing/entitlement.js";
import { generateQrMpm, midtransSnapReady, verifyMidtransNotification } from "../billing/midtrans-snap.js";
import { paymentSettings, verifyWinpayCallback } from "../billing/winpay.js";
import { finalizeWaTopup } from "../wa/service.js";

export const billingRouter = Router();

billingRouter.get(
  "/billing/status",
  requireUser,
  asyncHandler(async (req, res) => {
    const enabled = isBillingEnabled();
    const entitled = await isEntitled(req.user!.tenant.id);
    const sub = await prisma.subscription.findFirst({
      where: { tenantId: req.user!.tenant.id },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      enabled,
      entitled,
      plan: sub?.plan ?? "free",
      expiresAt: sub?.expiresAt ?? null,
      clientKey: enabled ? (process.env.MIDTRANS_CLIENT_KEY ?? "") : "",
    });
  })
);

billingRouter.post(
  "/billing/subscribe",
  requireUser,
  asyncHandler(async (req, res) => {
    if (!isBillingEnabled()) return res.status(503).json({ error: "billing_dormant" });
    if (!midtransSnapReady()) return res.status(503).json({ error: "billing_dormant" });
    const tenantId = req.user!.tenant.id;
    const amount = Number(process.env.MIDTRANS_PRO_PRICE ?? 49000);
    const orderId = `sub-${randomBytes(8).toString("hex")}`;
    await prisma.payment.create({ data: { tenantId, orderId, amount, status: "pending" } });
    try {
      const qr = await generateQrMpm(orderId, amount);
      await prisma.payment.update({ where: { orderId }, data: { paymentMethod: "qris", fraudStatus: qr.referenceNo } });
      return res.json({ orderId, amount, plan: "pro", qris: qr });
    } catch (e) {
      return res.status(502).json({
        error: "qris_gagal",
        detail: String(e instanceof Error ? e.message : e).slice(0, 200),
        orderId,
      });
    }
  })
);

/** Status pembayaran utk polling UI. */
billingRouter.get(
  "/billing/payment/:orderId",
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
      paymentMethod: payment.paymentMethod,
    });
  })
);

billingRouter.post(
  "/billing/webhook",
  asyncHandler(async (req, res) => {
    if (!isBillingEnabled()) return res.status(403).json({ error: "billing_dormant" });
    const body = z
      .object({
        order_id: z.string(),
        status_code: z.string(),
        gross_amount: z.string(),
        transaction_status: z.string(),
        payment_type: z.string().optional(),
        fraud_status: z.string().optional(),
        transaction_time: z.string().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const signature = String(req.header("x-signature-key") ?? "");
    if (!verifyWebhookSignature(body.data, billingServerKey(), signature)) {
      return res.status(401).json({ error: "signature_tidak_valid" });
    }
    const n: MidtransNotification = body.data;
    const payment = await prisma.payment.findUnique({ where: { orderId: n.order_id } });
    if (!payment) return res.status(404).json({ error: "order_tidak_ditemukan" });
    const paid = n.transaction_status === "settlement" || n.transaction_status === "capture";
    const failed = ["deny", "cancel", "expire", "failure"].includes(n.transaction_status);
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: n.transaction_status,
        paymentMethod: n.payment_type ?? "",
        fraudStatus: n.fraud_status ?? "",
      },
    });
    if (paid || failed) {
      await prisma.subscription.updateMany({
        where: { tenantId: payment.tenantId, status: "active" },
        data: { status: paid ? "active" : "expired" },
      });
    }
    res.json({ ok: true });
  })
);

/** Notifikasi QRIS MPM BI-SNAP (qr-mpm-notify). Tanpa sesi — keamanan via signature RSA.
 *  Satu router utk semua provider SNAP: dispatch by prefix orderId
 *  (`wa-` → Winpay topup, `sub-` → Midtrans subscription). */
export const snapNotifyRouter = Router();

snapNotifyRouter.post(
  "/v1.0/qr/qr-mpm-notify",
  asyncHandler(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ref = typeof b.originalPartnerReferenceNo === "string" ? b.originalPartnerReferenceNo : "";
    const trx = typeof b.latestTransactionStatus === "string" ? b.latestTransactionStatus : "";
    if (!ref || !trx) return res.status(400).json({ responseCode: "4005200", responseMessage: "Invalid payload" });

    const path = req.originalUrl.split("?")[0] ?? "";
    const raw = req.rawBody ?? JSON.stringify(req.body);
    const timestamp = String(req.header("x-timestamp") ?? "");
    const signature = String(req.header("x-signature") ?? "");

    // ── Winpay (WA topup) ──
    if (ref.startsWith("wa-")) {
      const cfg = await paymentSettings();
      if (!verifyWinpayCallback(cfg.winpay.publicKey, "POST", path, raw, timestamp, signature)) {
        console.warn("[winpay] notifikasi signature tidak valid / public key belum diisi:", path);
        return res.status(401).json({ responseCode: "4014700", responseMessage: "Invalid signature" });
      }
      const paid = trx === "00";
      const failed = ["04", "05", "06"].includes(trx);
      if (paid || failed) await finalizeWaTopup(ref, paid, paid ? "settlement" : "cancel", "winpay");
      return res.json({ responseCode: "2005200", responseMessage: "Successful" });
    }

    // ── Midtrans BI-SNAP ──
    const pubKey = process.env.MIDTRANS_PUBLIC_KEY ?? "";
    if (!pubKey || !verifyMidtransNotification(pubKey, "POST", path, raw, timestamp, signature)) {
      console.warn("[midtrans-snap] notifikasi signature tidak valid / public key belum diisi:", path);
      return res.status(401).json({ responseCode: "4015200", responseMessage: "Invalid signature" });
    }

    const paid = trx === "00";
    const failed = ["04", "05", "06", "08", "09"].includes(trx);

    // ── Topup WA via Midtrans ──
    if (ref.startsWith("mt-")) {
      if (paid || failed) await finalizeWaTopup(ref, paid, paid ? "settlement" : "cancel", "midtrans");
      return res.json({ responseCode: "2005200", responseMessage: "Request has been processed successfully" });
    }

    // ── Langganan subscription ──
    const payment = await prisma.payment.findUnique({ where: { orderId: ref } });
    if (!payment) {
      console.warn("[midtrans-snap] order tidak dikenal:", ref);
      return res.status(404).json({ responseCode: "4045200", responseMessage: "Order not found" });
    }
    const status = paid ? "settlement" : failed ? "cancel" : trx;
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status, paymentMethod: "qris" },
    });
    if (paid || failed) {
      const expiresAt = paid ? new Date(Date.now() + 30 * 86400_000) : null;
      const existing = await prisma.subscription.findFirst({
        where: { tenantId: payment.tenantId },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        await prisma.subscription.update({
          where: { id: existing.id },
          data: { status: paid ? "active" : "expired", expiresAt },
        });
      } else {
        await prisma.subscription.create({
          data: { tenantId: payment.tenantId, plan: "pro", status: paid ? "active" : "expired", expiresAt },
        });
      }
    }
    res.json({ responseCode: "2005200", responseMessage: "Request has been processed successfully" });
  })
);
