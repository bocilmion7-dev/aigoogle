import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { loadPermissionSet, requirePerm } from "../permissions.js";
import { writeAudit } from "../audit.js";
import { accurateProvider } from "../providers/accounting/index.js";
import { accurateCtxFor } from "../providers/accounting/connection.js";
import { getShopOrder, listShopOrders, patchShopOrder, type ShopOrder } from "../wa/shop-order.js";
import { accurateItems, customerNameFor, ensureOrderCustomer, syncShopOrderPaid } from "../wa/shop-accurate.js";
import { biteshipKeyMode, biteshipReady, createShipment, defaultCouriers, searchAreas, track } from "../shipping/biteship.js";
import { getShippingOrigin, setShippingOrigin } from "../wa/shipping-settings.js";
import { applyShippingUpdate, indexBiteshipOrder, notifyShipmentCreated } from "../wa/shipping-notify.js";

export const ordersRouter = Router();

/** tahap pesanan utk badge di UI */
function stageOf(order: ShopOrder): string {
  const a = order.accurate ?? {};
  if (a.salesReceipt) return "selesai";
  if (a.salesInvoice) return "difakturkan";
  if (a.salesOrder) return "pesanan-acc";
  if (order.status === "paid") return "lunas";
  if (order.status === "failed") return "gagal";
  return "menunggu";
}

const DOC_PERM = {
  customer: "accurate:customer.save",
  "sales-order": "accurate:sales-order.save",
  "sales-invoice": "accurate:sales-invoice.save",
  "sales-receipt": "accurate:sales-receipt.save",
  "close-order": "accurate:sales-order.save",
  retry: "accurate:sales-invoice.save",
} as const;

const ActionBody = z.object({
  doc: z.enum(["customer", "sales-order", "sales-invoice", "sales-receipt", "close-order", "retry"]),
  /** pelanggan Accurate: pilih yg sudah ada, atau isi nama utk dibuat baru */
  customerNo: z.string().max(60).optional(),
  customerName: z.string().max(200).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().max(300).optional(),
  bankNo: z.string().max(40).optional(),
});

/** Daftar pesanan toko WhatsApp (semua percakapan) utk halaman Pesanan. */
ordersRouter.get(
  "/orders",
  requireUser,
  asyncHandler(async (req, res) => {
    const tenantId = req.user!.tenant.id;
    const status = String(req.query.status ?? "");
    const peer = String(req.query.peer ?? "").slice(0, 32);
    const q = String(req.query.q ?? "").trim().toLowerCase();
    let orders = await listShopOrders(tenantId, peer || undefined, 200);
    if (status) orders = orders.filter((o) => o.status === status || stageOf(o) === status);
    if (q) {
      orders = orders.filter(
        (o) =>
          o.orderId.toLowerCase().includes(q) ||
          o.buyerPhone.includes(q) ||
          o.buyerName.toLowerCase().includes(q)
      );
    }
    res.json({
      accurateConnected: !!(await accurateCtxFor(tenantId)),
      orders: orders.map((o) => ({ ...o, stage: stageOf(o) })),
    });
  })
);

/** Cari pelanggan Accurate (autocomplete dialog "input pesanan"). */
ordersRouter.get(
  "/orders/customers",
  requireUser,
  asyncHandler(async (req, res) => {
    const perms = await loadPermissionSet(req.user!.roleId);
    if (!perms.has("accurate:customer.view")) return res.status(403).json({ error: "tidak_punya_hak" });
    const ctx = await accurateCtxFor(req.user!.tenant.id);
    if (!ctx) return res.status(409).json({ error: "belum_connect" });
    const keywords = String(req.query.q ?? "").slice(0, 60);
    res.json(await accurateProvider().listCustomers(ctx, { keywords, limit: 20 }));
  })
);

/**
 * Aksi Accurate utk satu pesanan:
 *  - customer      : cari/buat pelanggan (by nomor HP, fallback nama)
 *  - sales-order   : input pesanan penjualan (SO)
 *  - sales-invoice : buat faktur penjualan
 *  - sales-receipt : catat penerimaan kas (butuh nomor faktur)
 *  - close-order   : tutup SO
 *  - retry         : ulangi sinkron otomatis faktur+kas
 */
ordersRouter.post(
  "/orders/:orderId/accurate",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = ActionBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request", issues: body.error.issues });
    const perms = await loadPermissionSet(req.user!.roleId);
    if (!perms.has(DOC_PERM[body.data.doc])) return res.status(403).json({ error: "tidak_punya_hak" });

    const tenantId = req.user!.tenant.id;
    const order = await getShopOrder(String(req.params.orderId ?? "").slice(0, 64));
    if (!order || order.tenantId !== tenantId) return res.status(404).json({ error: "tidak_ditemukan" });
    const ctx = await accurateCtxFor(tenantId);
    if (!ctx) return res.status(409).json({ error: "belum_connect" });
    const provider = accurateProvider();
    const b = body.data;

    try {
      if (b.doc === "retry") {
        if (order.status !== "paid") return res.status(409).json({ error: "belum_dibayar" });
        const updated = await syncShopOrderPaid(order.orderId);
        await writeAudit(tenantId, req.user!.id, "orders.accurate_retry", { orderId: order.orderId });
        return res.json({ ok: true, order: updated ? { ...updated, stage: stageOf(updated) } : null });
      }

      const cust = await ensureOrderCustomer(provider, ctx, order, {
        customerNo: b.customerNo,
        customerName: b.customerName,
        createName: b.customerName,
      });
      let updated = await patchShopOrder(order.orderId, (o) => {
        o.accurate = { ...(o.accurate ?? {}), customerNo: cust.customerNo, customerName: cust.customerName };
      });

      if (b.doc === "customer") {
        await writeAudit(tenantId, req.user!.id, "orders.accurate_customer", {
          orderId: order.orderId,
          customerNo: cust.customerNo,
        });
        return res.json({ ok: true, order: updated ? { ...updated, stage: stageOf(updated) } : null });
      }

      const items = await accurateItems(provider, ctx, order);
      const description = b.note?.trim() || `Pesanan WhatsApp ${order.orderId}`;

      if (b.doc === "sales-order") {
        const so = await provider.createSalesOrder(ctx, {
          customerNo: cust.customerNo,
          date: b.date,
          description,
          items: items.map((it) => ({ itemNo: it.itemNo!, qty: it.qty ?? 1, price: it.price ?? 0 })),
        });
        updated = await patchShopOrder(order.orderId, (o) => {
          o.accurate = { ...(o.accurate ?? {}), customerNo: cust.customerNo, customerName: cust.customerName, salesOrder: so };
        });
        await writeAudit(tenantId, req.user!.id, "orders.accurate_sales_order", {
          orderId: order.orderId,
          number: so.number,
        });
      } else if (b.doc === "sales-invoice") {
        if (order.status !== "paid") return res.status(409).json({ error: "belum_dibayar" });
        const ship =
          order.fulfillment === "courier" && order.shipping?.price
            ? {
                amount: order.shipping.price,
                name: `Ongkir ${[order.shipping.courierName, order.shipping.serviceName].filter(Boolean).join(" ")}`.trim(),
              }
            : undefined;
        const invoice = await provider.createSalesInvoice(ctx, {
          customerName: cust.customerName,
          date: b.date,
          description,
          items,
          ...(ship ? { shipping: ship } : {}),
        });
        updated = await patchShopOrder(order.orderId, (o) => {
          o.accurate = { ...(o.accurate ?? {}), customerNo: cust.customerNo, customerName: cust.customerName, salesInvoice: invoice };
        });
        await writeAudit(tenantId, req.user!.id, "orders.accurate_sales_invoice", {
          orderId: order.orderId,
          number: invoice.number,
        });
      } else if (b.doc === "sales-receipt") {
        const invoice = updated?.accurate?.salesInvoice;
        if (!invoice?.number) return res.status(409).json({ error: "belum_difakturkan" });
        const receipt = await provider.createSalesReceipt(ctx, {
          customerName: cust.customerName,
          date: b.date,
          amount: order.total,
          invoiceNo: invoice.number,
          bankNo: b.bankNo,
          description: `Pembayaran ${order.orderId}`,
        });
        updated = await patchShopOrder(order.orderId, (o) => {
          o.accurate = { ...(o.accurate ?? {}), salesReceipt: receipt };
        });
        await writeAudit(tenantId, req.user!.id, "orders.accurate_sales_receipt", {
          orderId: order.orderId,
          number: receipt.number,
        });
      } else {
        const so = updated?.accurate?.salesOrder;
        if (!so?.number) return res.status(409).json({ error: "belum_dipesan" });
        await provider.closeSalesOrder(ctx, { number: so.number });
        await writeAudit(tenantId, req.user!.id, "orders.accurate_close", {
          orderId: order.orderId,
          number: so.number,
        });
      }

      return res.json({ ok: true, order: updated ? { ...updated, stage: stageOf(updated) } : null });
    } catch (e) {
      return res.status(400).json({
        error: "accurate_gagal",
        message: e instanceof Error ? e.message.slice(0, 300) : "gagal memproses ke Accurate",
      });
    }
  })
);

/** Nama pelanggan yg dipakai saat membuat pelanggan baru (dipakai UI sbg saran). */
ordersRouter.get(
  "/orders/:orderId/customer-suggestion",
  requireUser,
  asyncHandler(async (req, res) => {
    const order = await getShopOrder(String(req.params.orderId ?? "").slice(0, 64));
    if (!order || order.tenantId !== req.user!.tenant.id) return res.status(404).json({ error: "tidak_ditemukan" });
    res.json({ name: customerNameFor(order) });
  })
);

/* ── Pengiriman: asal gudang, ongkir, input order Biteship, pelacakan ── */

const OriginBody = z.object({
  contactName: z.string().max(100).optional(),
  phone: z.string().max(32).optional(),
  email: z.string().max(120).optional(),
  organization: z.string().max(120).optional(),
  address: z.string().max(300).optional(),
  postalCode: z.string().max(10).optional(),
  note: z.string().max(200).optional(),
});

ordersRouter.get(
  "/shipping/settings",
  requireUser,
  asyncHandler(async (req, res) => {
    res.json({
      origin: await getShippingOrigin(req.user!.tenant.id),
      biteshipReady: biteshipReady(),
      biteshipMode: biteshipKeyMode(),
      couriers: defaultCouriers(),
    });
  })
);

ordersRouter.put(
  "/shipping/settings",
  requireUser,
  requirePerm("app:users.manage"),
  asyncHandler(async (req, res) => {
    const body = OriginBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request", issues: body.error.issues });
    const origin = await setShippingOrigin(req.user!.tenant.id, body.data);
    await writeAudit(req.user!.tenant.id, req.user!.id, "orders.shipping_settings", { postalCode: origin.postalCode });
    res.json({ origin, biteshipReady: biteshipReady(), biteshipMode: biteshipKeyMode() });
  })
);

ordersRouter.get(
  "/shipping/areas",
  requireUser,
  requirePerm("app:users.manage"),
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").slice(0, 80);
    if (!q.trim()) return res.json([]);
    try {
      res.json(await searchAreas(q));
    } catch (e) {
      res.status(400).json({ error: "biteship_gagal", message: e instanceof Error ? e.message : "gagal cari area" });
    }
  })
);

/** Kirim pesanan ke Biteship (membuat order + resi untuk pelacakan). */
ordersRouter.post(
  "/orders/:orderId/biteship",
  requireUser,
  requirePerm("app:users.manage"),
  asyncHandler(async (req, res) => {
    const tenantId = req.user!.tenant.id;
    const order = await getShopOrder(String(req.params.orderId ?? "").slice(0, 64));
    if (!order || order.tenantId !== tenantId) return res.status(404).json({ error: "tidak_ditemukan" });
    if (order.fulfillment !== "courier" || !order.shipping) {
      return res.status(409).json({ error: "bukan_kurir", message: "Pesanan ini ambil sendiri di toko (bukan kirim kurir)." });
    }
    if (order.status !== "paid") {
      return res.status(409).json({ error: "belum_dibayar", message: "Tandai pesanan lunas dulu sebelum input ke Biteship." });
    }
    if (order.shipping.biteshipOrderId) {
      return res.status(409).json({ error: "sudah_dikirim", message: `Sudah diinput ke Biteship (${order.shipping.biteshipOrderId}).`, order });
    }
    const origin = await getShippingOrigin(tenantId);
    if (!origin.address || !origin.postalCode || !origin.phone) {
      return res.status(409).json({ error: "asal_belum_diatur", message: "Lengkapi alamat asal pengiriman di Pengaturan Pengiriman." });
    }
    const weight = order.shipping.weightGram && order.shipping.weightGram > 0 ? order.shipping.weightGram : 500;
    const items = order.items.map((it) => ({
      name: it.name,
      value: Math.max(1, Math.round(it.price)),
      quantity: it.qty,
      weight: Math.max(1, Math.round(weight / Math.max(1, order.items.reduce((a, l) => a + l.qty, 0)))),
    }));
    try {
      const shipment = await createShipment({
        origin,
        destination: {
          contactName: order.buyerName || "Pembeli",
          phone: order.buyerPhone,
          address: order.shipping.destinationAddress ?? "",
          postalCode: order.shipping.destinationPostalCode ?? "",
          note: order.shipping.destinationNote ?? "",
        },
        courier: { company: order.shipping.courierCode ?? "", type: order.shipping.serviceCode ?? "" },
        items,
        description: `Pesanan WhatsApp ${order.orderId}`,
        metadata: { orderId: order.orderId },
      });
      const updated = await patchShopOrder(order.orderId, (o) => {
        o.shipping = {
          ...(o.shipping ?? {}),
          biteshipOrderId: shipment.id,
          trackingId: shipment.trackingId,
          trackingLink: shipment.trackingLink,
          waybillId: shipment.waybillId,
          status: shipment.status,
        };
      });
      await indexBiteshipOrder(shipment.id, order.orderId);
      let notified = false;
      if (updated && shipment.waybillId) {
        notified = await notifyShipmentCreated(updated);
        if (notified) {
          await patchShopOrder(order.orderId, (o) => {
            if (o.shipping) o.shipping.waybillNotified = true;
          });
        }
      }
      await writeAudit(tenantId, req.user!.id, "orders.biteship_order", {
        orderId: order.orderId,
        biteshipOrderId: shipment.id,
        waybillId: shipment.waybillId,
        trackingLink: shipment.trackingLink,
        buyerNotified: notified,
      });
      res.json({ ok: true, shipment, buyerNotified: notified, order: updated ? { ...updated, stage: stageOf(updated) } : null });
    } catch (e) {
      res.status(400).json({
        error: "biteship_gagal",
        message: e instanceof Error ? e.message : "gagal membuat order Biteship",
      });
    }
  })
);

/** Lacak paket (butuh resi/waybill dari order Biteship). */
ordersRouter.get(
  "/orders/:orderId/tracking",
  requireUser,
  asyncHandler(async (req, res) => {
    const order = await getShopOrder(String(req.params.orderId ?? "").slice(0, 64));
    if (!order || order.tenantId !== req.user!.tenant.id) return res.status(404).json({ error: "tidak_ditemukan" });
    const trackingId = order.shipping?.trackingId;
    const awb = order.shipping?.waybillId;
    const courier = order.shipping?.courierCode;
    if (!trackingId && !awb) {
      return res.status(409).json({ error: "belum_ada_resi", message: "Input pesanan ke Biteship dulu untuk mendapat nomor resi." });
    }
    try {
      // utamakan tracking_id Biteship; waybill butuh parameter courier
      const tracking = await track(trackingId || awb!, trackingId ? undefined : courier);
      await patchShopOrder(order.orderId, (o) => {
        if (o.shipping) o.shipping.status = tracking.status;
      });
      res.json({ ok: true, tracking });
    } catch (e) {
      res.status(400).json({ error: "biteship_gagal", message: e instanceof Error ? e.message : "gagal melacak paket" });
    }
  })
);


/**
 * Webhook Biteship (set di dashboard: Integration → Pengaturan → Tambah Webhook).
 * Event: order.status / order.waybill_id / order.price.
 * Bila BITESHIP_WEBHOOK_TOKEN diisi, wajib kirim header X-Webhook-Token.
 */
ordersRouter.post(
  "/shipping/biteship/webhook",
  asyncHandler(async (req, res) => {
    const token = process.env.BITESHIP_WEBHOOK_TOKEN ?? "";
    const given = String(req.header("x-webhook-token") ?? req.query.token ?? "");
    if (token && given !== token) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const event = String(b.event ?? "");
    if (!["order.status", "order.waybill_id", "order.price"].includes(event)) {
      return res.json({ ok: true, ignored: true });
    }
    const r = await applyShippingUpdate({
      biteshipOrderId: String(b.order_id ?? ""),
      trackingId: b.courier_tracking_id ? String(b.courier_tracking_id) : undefined,
      waybillId: b.courier_waybill_id ? String(b.courier_waybill_id) : undefined,
      status: event === "order.status" ? String(b.status ?? "") : undefined,
      courierCompany: b.courier_company ? String(b.courier_company) : undefined,
      courierType: b.courier_type ? String(b.courier_type) : undefined,
      link: b.courier_link ? String(b.courier_link) : undefined,
      source: "webhook",
    });
    // resi baru keluar setelah order dibuat → kabari pembeli sekali
    if (event === "order.waybill_id" && r.order?.shipping?.waybillId && !r.order.shipping.waybillNotified) {
      const sent = await notifyShipmentCreated(r.order);
      if (sent) {
        await patchShopOrder(r.order.orderId, (o) => {
          if (o.shipping) o.shipping.waybillNotified = true;
        });
      }
    }
    res.json({ ok: true, matched: !!r.order, notified: r.notified });
  })
);
