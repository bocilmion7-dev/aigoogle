import { prisma } from "../db.js";
import { writeAudit } from "../audit.js";
import { getShopOrder, setShopOrderStatus } from "./shop-order.js";
import { syncShopOrderPaid } from "./shop-accurate.js";
import { sendWaText } from "./service.js";
import { ownerPaidMessage, paymentReceivedMessage } from "./format.js";
import { creditSalesWallet } from "../sales/wallet.js";
import { sendPushToUser } from "../push.js";
import { tenantOwnerId } from "../ai/billing.js";

export interface ShopPaymentResult {
  found: boolean;
  /** payment sudah settlement sebelumnya — jangan ulangi notifikasi/audit */
  alreadySettled: boolean;
  paid: boolean;
  failed: boolean;
}

/**
 * Terapkan hasil pembayaran pesanan toko (prefix `shop-`) SEHUBUNGAN dengan
 * pembayaran QRIS yang sebenarnya. Satu jalur dipakai dua pemicu:
 *  - notifikasi BI-SNAP (`/v1.0/qr/qr-mpm-notify`) → sumber "midtrans"
 *  - simulator pembayaran (`POST /wa/shop/orders/:orderId/settle-test`) → "simulator"
 *
 * Urutannya sama persis dgn notifikasi asli: payment → order → WA pemilik &
 * pembeli → audit, sehingga data hasil simulasi identik dgn pembayaran nyata.
 */
export async function applyShopPaymentResult(opts: {
  orderId: string;
  paymentStatus: string;
  source: "midtrans" | "simulator";
  /** pelaku audit — default "system" (notifikasi otomatis) */
  actor?: string;
}): Promise<ShopPaymentResult> {
  const payment = await prisma.payment.findUnique({ where: { orderId: opts.orderId } });
  if (!payment) return { found: false, alreadySettled: false, paid: false, failed: false };
  if (payment.status === "settlement") {
    return { found: true, alreadySettled: true, paid: true, failed: false };
  }
  const paid = opts.paymentStatus === "settlement";
  const failed = opts.paymentStatus === "cancel" || opts.paymentStatus === "failed";
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: opts.paymentStatus, paymentMethod: "qris" },
  });

  const order = await getShopOrder(opts.orderId);
  if (paid && order) {
    await setShopOrderStatus(order.orderId, "paid");
    await creditSalesWallet({
      tenantId: order.tenantId,
      amount: order.total,
      orderId: order.orderId,
      note: `Pembayaran QRIS pesanan ${order.orderId}`,
    }).catch(() => null);
    // faktur + penerimaan kas dibuat otomatis bila Accurate terhubung.
    // Dibatasi 12 dtk supaya webhook Midtrans tidak menggantung bila Accurate lambat.
    const synced = await Promise.race([
      syncShopOrderPaid(order.orderId).catch(() => null),
      new Promise<null>((resolve) => {
        const t = setTimeout(() => resolve(null), 12_000);
        t.unref?.();
      }),
    ]);
    const acc = synced?.accurate;
    const ownerRow = await prisma.appSetting.findUnique({ where: { key: `wa:owner_phone:${order.tenantId}` } });
    const ownerPhone = ownerRow?.value ?? "";
    if (ownerPhone) {
      await sendWaText(order.tenantId, ownerPhone, ownerPaidMessage(order, acc)).catch(() => null);
    }
    void tenantOwnerId(order.tenantId)
      .then((ownerId) =>
        ownerId
          ? sendPushToUser(ownerId, {
              title: "Pembayaran diterima",
              body: `${order.orderId} · Rp${Math.round(order.total).toLocaleString("id-ID")}`,
              url: "/pesanan",
            })
          : 0
      )
      .catch(() => 0);
    if (order.buyerPhone) {
      const buyerMsg = paymentReceivedMessage(order);
      if (order.buyerPhone.startsWith("sandbox:")) {
        // Sandbox: jangan kirim WA sungguhan — catat sebagai balasan AI supaya
        // muncul di percakapan /sandbox (isi pesan sama persis dgn live).
        await prisma.waMessageLog.create({
          data: {
            tenantId: order.tenantId,
            to: order.buyerPhone,
            body: buyerMsg,
            direction: "out",
            status: "sent",
            costCredits: 0,
          },
        });
      } else {
        await sendWaText(order.tenantId, order.buyerPhone, buyerMsg).catch(() => null);
      }
    }
    await writeAudit(order.tenantId, opts.actor ?? "system", "wa.shop_order_paid", {
      orderId: order.orderId,
      total: order.total,
      buyer: order.buyerName || order.buyerPhone,
      source: opts.source,
    });
  } else if (failed && order) {
    await setShopOrderStatus(order.orderId, "failed");
    await writeAudit(order.tenantId, opts.actor ?? "system", "wa.shop_order_failed", {
      orderId: opts.orderId,
      status: opts.paymentStatus,
      source: opts.source,
    });
  }
  return { found: true, alreadySettled: false, paid, failed };
}
