import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { isBillingEnabled, billingServerKey, verifyWebhookSignature, type MidtransNotification } from "../billing/midtrans.js";
import { isEntitled } from "../billing/entitlement.js";

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

billingRouter.post("/billing/subscribe", requireUser, (_req, res) => {
  if (!isBillingEnabled()) return res.status(503).json({ error: "billing_dormant" });
  res.status(501).json({ error: "belum_diimplementasi" });
});

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
