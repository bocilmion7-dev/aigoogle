import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { isBillingEnabled, billingServerKey, verifyWebhookSignature, type MidtransNotification } from "../billing/midtrans.js";
import { isEntitled } from "../billing/entitlement.js";
import { generateQrMpm, midtransSnapReady, verifyMidtransNotification } from "../billing/midtrans-snap.js";
import { finalizeWaTopup } from "../wa/service.js";
import { applyShopPaymentResult } from "../wa/shop-settle.js";
import { creditTokens, finalizeAiTopup, tenantOwnerId } from "../ai/billing.js";
import { writeAudit } from "../audit.js";
import { buildInvoicePdf } from "../doc/invoice-pdf.js";
import { sendMail } from "../mail.js";
import { renderInvoiceMail } from "../mail/templates.js";
import { env } from "../env.js";
import { isAutoRenewEnabled, setAutoRenew } from "../billing/recurring.js";

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

billingRouter.get(
  "/billing/invoices",
  requireUser,
  asyncHandler(async (req, res) => {
    const tenantId = req.user!.tenant.id;
    const takeRaw = typeof req.query.take === "string" ? Number(req.query.take) : 10;
    const skipRaw = typeof req.query.skip === "string" ? Number(req.query.skip) : 0;
    const pageSize = Number.isFinite(takeRaw) ? Math.min(50, Math.max(1, Math.floor(takeRaw))) : 10;
    const skip = Number.isFinite(skipRaw) ? Math.max(0, Math.floor(skipRaw)) : 0;
    // Ambil cukup baris dari tiap sumber untuk menutup halaman ini setelah
    // merge+sort. fetchN >= skip+pageSize+1 agar `hasMore` akurat.
    const fetchN = Math.min(1000, skip + pageSize + 1);
    const [payments, waTopups, aiTopups] = await Promise.all([
      prisma.payment.findMany({
        // Riwayat billing add-on; pesanan toko punya halaman sendiri.
        where: { tenantId, NOT: { orderId: { startsWith: "shop-" } } },
        orderBy: { createdAt: "desc" },
        take: fetchN,
      }),
      prisma.waTopup.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: fetchN }),
      prisma.aiTopup.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: fetchN }),
    ]);
    const rows = [
      ...payments.map((p) => ({
        orderId: p.orderId,
        kind: paymentLabel(p.orderId),
        amount: p.amount,
        status: p.status,
        paymentMethod: p.paymentMethod,
        createdAt: p.createdAt,
      })),
      ...waTopups.map((p) => ({
        orderId: p.orderId,
        kind: "Top up WhatsApp",
        amount: p.amount,
        status: p.status,
        paymentMethod: p.paymentMethod,
        createdAt: p.createdAt,
      })),
      ...aiTopups.map((p) => ({
        orderId: p.orderId,
        kind: "Top up token AI",
        amount: p.amount,
        status: p.status,
        paymentMethod: p.paymentMethod,
        createdAt: p.createdAt,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    res.json({
      items: rows.slice(skip, skip + pageSize),
      hasMore: rows.length > skip + pageSize,
      page: Math.floor(skip / pageSize) + 1,
      pageSize,
    });
  })
);

billingRouter.get(
  "/billing/auto-renew",
  requireUser,
  asyncHandler(async (req, res) => {
    res.json({ enabled: await isAutoRenewEnabled(req.user!.tenant.id) });
  })
);

billingRouter.put(
  "/billing/auto-renew",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    await setAutoRenew(req.user!.tenant.id, body.data.enabled);
    await writeAudit(req.user!.tenant.id, req.user!.id, "billing.auto_renew", { enabled: body.data.enabled });
    res.json({ ok: true, enabled: body.data.enabled });
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
        /** standar notifikasi HTTP Midtrans: signature ada di body, bukan header */
        signature_key: z.string().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const signature = String(body.data.signature_key ?? req.header("x-signature-key") ?? "");
    if (!verifyWebhookSignature(body.data, billingServerKey(), signature)) {
      return res.status(401).json({ error: "signature_tidak_valid" });
    }
    const n: MidtransNotification = body.data;
    const payment = await prisma.payment.findUnique({ where: { orderId: n.order_id } });
    if (!payment) return res.status(404).json({ error: "order_tidak_ditemukan" });
    // Idempoten: replay notifikasi yang sama tidak boleh memproses ulang.
    if (payment.status === n.transaction_status) {
      return res.json({ ok: true, ignored: true });
    }
    // Pembayaran yang sudah settlement tidak boleh diturunkan oleh replay gagal.
    if (payment.status === "settlement" && !["settlement", "capture"].includes(n.transaction_status)) {
      return res.json({ ok: true, ignored: true });
    }
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

function paymentLabel(orderId: string): string {
  if (orderId.startsWith("wg-")) return "Langganan WhatsApp Gateway";
  if (orderId.startsWith("subl-") || orderId.startsWith("sub-")) return "Langganan AI Asisten";
  if (orderId.startsWith("shop-")) return "Pesanan toko WhatsApp";
  return "Langganan / layanan AI Asisten";
}

async function invoiceFor(tenantId: string, orderId: string) {
  const payment = await prisma.payment.findFirst({ where: { orderId, tenantId } });
  if (payment) {
    return {
      amount: payment.amount,
      label: paymentLabel(payment.orderId),
      status: payment.status,
      createdAt: payment.createdAt,
    };
  }
  const wa = await prisma.waTopup.findFirst({ where: { orderId, tenantId } });
  if (wa) {
    return { amount: wa.amount, label: "Top up saldo WhatsApp", status: wa.status, createdAt: wa.createdAt };
  }
  const ai = await prisma.aiTopup.findFirst({ where: { orderId, tenantId } });
  if (ai) {
    return { amount: ai.amount, label: "Top up token AI", status: ai.status, createdAt: ai.createdAt };
  }
  return null;
}

function invoiceDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Teks badge status utk PDF (LUNAS / MENUNGGU PEMBAYARAN / PEMBAYARAN GAGAL). */
function invoiceStatusBadge(status: string): string {
  const s = status.toLowerCase();
  if (["settlement", "capture"].includes(s)) return "LUNAS";
  if (["deny", "cancel", "expire", "failure"].includes(s)) return "PEMBAYARAN GAGAL";
  return "MENUNGGU PEMBAYARAN";
}

async function invoicePdfFor(tenantId: string, orderId: string, tenantName: string) {
  const inv = await invoiceFor(tenantId, orderId);
  if (!inv) return null;
  const pdf = await buildInvoicePdf({
    docType: "nota",
    companyName: "AI Asisten",
    no: orderId,
    date: invoiceDate(inv.createdAt),
    customerName: tenantName,
    partyLabel: "Ditagihkan kepada",
    items: [{ name: inv.label, qty: 1, price: inv.amount }],
    note: `Dokumen ini dibuat otomatis untuk pesanan ${orderId}.`,
    status: invoiceStatusBadge(inv.status),
  });
  return { pdf, inv };
}

billingRouter.get(
  "/billing/invoice/:orderId",
  requireUser,
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.user!.tenant.id }, select: { name: true } });
    const out = await invoicePdfFor(req.user!.tenant.id, req.params.orderId, tenant?.name ?? "Perusahaan");
    if (!out) return res.status(404).json({ error: "tidak_ditemukan" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${req.params.orderId}.pdf"`);
    res.send(Buffer.from(out.pdf));
  })
);

billingRouter.post(
  "/billing/invoice/:orderId/email",
  requireUser,
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.user!.tenant.id }, select: { name: true } });
    const out = await invoicePdfFor(req.user!.tenant.id, req.params.orderId, tenant?.name ?? "Perusahaan");
    if (!out) return res.status(404).json({ error: "tidak_ditemukan" });
    const mail = renderInvoiceMail({
      invoiceNo: req.params.orderId,
      date: invoiceDate(out.inv.createdAt),
      customerName: tenant?.name ?? "Perusahaan",
      label: out.inv.label,
      amount: out.inv.amount,
      status: out.inv.status,
      ctaUrl: `${env.APP_ORIGIN}/subscription`,
    });
    const sent = await sendMail({
      to: req.user!.email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: [
        {
          filename: `invoice-${req.params.orderId}.pdf`,
          content: Buffer.from(out.pdf).toString("base64"),
        },
      ],
    });
    res.json({ ok: true, sent });
  })
);

/** Notifikasi QRIS MPM BI-SNAP (qr-mpm-notify). Tanpa sesi — keamanan via signature RSA.
 *  Dispatch berdasarkan prefix orderId (`ai-`/`mt-`/`wg-`/`sub-`). */
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

    // ── Midtrans BI-SNAP ──
    const pubKey = process.env.MIDTRANS_PUBLIC_KEY ?? "";
    // Path yg ditandatangani Midtrans bisa berupa endpoint API (`/v1.0/...`) atau
    // URL notifikasi lengkap (mis. `/api/billing/webhook/v1.0/...`). Coba keduanya.
    const sigPaths = new Set<string>([path]);
    const v1At = path.indexOf("/v1.0/");
    if (v1At >= 0) sigPaths.add(path.slice(v1At));
    const signatureValid =
      !!pubKey &&
      [...sigPaths].some((p) => verifyMidtransNotification(pubKey, "POST", p, raw, timestamp, signature));
    if (!signatureValid) {
      console.warn("[midtrans-snap] notifikasi signature tidak valid / public key belum diisi:", path);
      return res.status(401).json({ responseCode: "4015200", responseMessage: "Invalid signature" });
    }

    const paid = trx === "00";
    const failed = ["04", "05", "06", "08", "09"].includes(trx);

    // ── Topup saldo AI via Midtrans ──
    if (ref.startsWith("ai-")) {
      if (paid || failed) await finalizeAiTopup(ref, paid, paid ? "settlement" : "cancel", "midtrans");
      return res.json({ responseCode: "2005200", responseMessage: "Request has been processed successfully" });
    }

    // ── Topup WA via Midtrans ──
    if (ref.startsWith("mt-")) {
      if (paid || failed) await finalizeWaTopup(ref, paid, paid ? "settlement" : "cancel", "midtrans");
      return res.json({ responseCode: "2005200", responseMessage: "Request has been processed successfully" });
    }

    // ── Langganan Waserver Gateway (prefix wg-) ──
    if (ref.startsWith("wg-")) {
      const payment = await prisma.payment.findUnique({ where: { orderId: ref } });
      if (!payment) {
        console.warn("[midtrans-snap] order waserver tidak dikenal:", ref);
        return res.status(404).json({ responseCode: "4045200", responseMessage: "Order not found" });
      }
      // notifikasi berulang setelah lunas jangan memperpanjang langganan lagi
      if (payment.status === "settlement") {
        return res.json({ responseCode: "2005200", responseMessage: "Request has been processed successfully" });
      }
      const status = paid ? "settlement" : failed ? "cancel" : trx;
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status, paymentMethod: "qris" },
      });
      if (paid) {
        // durasi dari orderId baru (`wg-<bulan>m-...`); order lama fallback ke nominal
        const fromId = /^wg-(\d+)m-/.exec(ref);
        const months = fromId
          ? Math.min(36, Math.max(1, Number(fromId[1])))
          : payment.amount >= 75000
            ? 3
            : payment.amount >= 50000
              ? 2
              : 1;
        const expiresAt = new Date(Date.now() + months * 30 * 86400_000);
        const existing = await prisma.subscription.findFirst({
          where: { tenantId: payment.tenantId },
          orderBy: { createdAt: "desc" },
        });
        if (existing) {
          await prisma.subscription.update({
            where: { id: existing.id },
            data: { status: "active", plan: "wa_gateway", expiresAt },
          });
        } else {
          await prisma.subscription.create({
            data: { tenantId: payment.tenantId, plan: "wa_gateway", status: "active", expiresAt },
          });
        }
        await writeAudit(payment.tenantId, "system", "wa.subscribe_settled", {
          orderId: payment.orderId,
          amount: payment.amount,
          months,
        });
      } else if (failed) {
        await writeAudit(payment.tenantId, "system", "wa.subscribe_failed", {
          orderId: payment.orderId,
          status: trx,
        });
      }
      return res.json({ responseCode: "2005200", responseMessage: "Request has been processed successfully" });
    }

    // ── Langganan AI bulanan (prefix subl-) ──
    if (ref.startsWith("subl-")) {
      const m = /^subl-(.+?)-(\d+)m-(\d+)-[a-f0-9]+$/.exec(ref);
      if (!m) return res.status(400).json({ responseCode: "4005200", responseMessage: "Invalid order id" });
      const planId = m[1]!;
      const months = Math.min(36, Math.max(1, Number(m[2])));
      const tokens = Math.max(0, Number(m[3]));
      const payment = await prisma.payment.findUnique({ where: { orderId: ref } });
      if (!payment) {
        console.warn("[midtrans-snap] order langganan AI tidak dikenal:", ref);
        return res.status(404).json({ responseCode: "4045200", responseMessage: "Order not found" });
      }
      if (paid && payment.status === "settlement") {
        return res.json({ responseCode: "2005200", responseMessage: "Request has been processed successfully" });
      }
      const status = paid ? "settlement" : failed ? "cancel" : trx;
      await prisma.payment.update({ where: { id: payment.id }, data: { status, paymentMethod: "qris" } });
      if (paid) {
        const ownerId = await tenantOwnerId(payment.tenantId);
        if (ownerId) {
          await creditTokens({
            userId: ownerId,
            tenantId: payment.tenantId,
            tokens,
            refId: ref,
            meta: `langganan ${planId} · ${months} bulan`,
          });
        }
        const existing = await prisma.subscription.findFirst({
          where: { tenantId: payment.tenantId, plan: { startsWith: "ai:" } },
          orderBy: { createdAt: "desc" },
        });
        const base = existing?.expiresAt && existing.expiresAt > new Date() ? existing.expiresAt : new Date();
        const expiresAt = new Date(base.getTime() + months * 30 * 86400_000);
        if (existing) {
          await prisma.subscription.update({
            where: { id: existing.id },
            data: { status: "active", plan: `ai:${planId}`, expiresAt },
          });
        } else {
          await prisma.subscription.create({
            data: { tenantId: payment.tenantId, plan: `ai:${planId}`, status: "active", expiresAt },
          });
        }
        await writeAudit(payment.tenantId, "system", "ai.subscribe_settled", {
          orderId: ref,
          planId,
          months,
          tokens,
          ownerId,
        });
      } else if (failed) {
        await writeAudit(payment.tenantId, "system", "ai.subscribe_failed", { orderId: ref, status: trx });
      }
      return res.json({ responseCode: "2005200", responseMessage: "Request has been processed successfully" });
    }

    // ── Pesanan toko WhatsApp (prefix shop-) ──
    if (ref.startsWith("shop-")) {
      const status = paid ? "settlement" : failed ? "cancel" : trx;
      const r = await applyShopPaymentResult({ orderId: ref, paymentStatus: status, source: "midtrans" });
      if (!r.found) {
        console.warn("[midtrans-snap] order toko tidak dikenal:", ref);
        return res.status(404).json({ responseCode: "4045200", responseMessage: "Order not found" });
      }
      return res.json({ responseCode: "2005200", responseMessage: "Request has been processed successfully" });
    }

    // ── Langganan subscription ──
    const payment = await prisma.payment.findUnique({ where: { orderId: ref } });
    if (!payment) {
      console.warn("[midtrans-snap] order tidak dikenal:", ref);
      return res.status(404).json({ responseCode: "4045200", responseMessage: "Order not found" });
    }
    // notifikasi settlement berulang jangan memperpanjang masa aktif terus-menerus
    if (paid && payment.status === "settlement") {
      return res.json({ responseCode: "2005200", responseMessage: "Request has been processed successfully" });
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
