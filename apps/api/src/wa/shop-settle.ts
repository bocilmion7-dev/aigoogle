import { prisma } from "../db.js";
import { writeAudit } from "../audit.js";
import { getShopOrder, setShopOrderStatus } from "./shop-order.js";
import { syncShopOrderPaid } from "./shop-accurate.js";
import { sendWaText } from "./service.js";

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

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
    const lines = order.items.map((i) => `- ${i.name} x${i.qty} = ${rp(i.subtotal)}`).join("\n");
    const ownerRow = await prisma.appSetting.findUnique({ where: { key: `wa:owner_phone:${order.tenantId}` } });
    const ownerPhone = ownerRow?.value ?? "";
    if (ownerPhone) {
      const docs = acc?.salesInvoice
        ? `\nFaktur Accurate: ${acc.salesInvoice.number}` +
          (acc.salesReceipt ? `\nPenerimaan kas: ${acc.salesReceipt.number}` : "")
        : "";
      const ship = order.shipping;
      const shipLine =
        order.fulfillment === "courier" && ship
          ? `\nPengiriman: ${ship.courierName ?? ship.courierCode ?? "kurir"} ${ship.serviceName ?? ship.serviceCode ?? ""} (${rp(
              ship.price ?? 0
            )})` +
            (ship.destinationAddress ? `\nAlamat: ${ship.destinationAddress} (${ship.destinationPostalCode ?? ""})` : "")
          : `\nPengiriman: ambil sendiri di toko`;
      const msg =
        `Pesanan toko sudah DIBAYAR\n` +
        `Order: ${order.orderId}\n` +
        `Pembeli: ${order.buyerName || order.buyerPhone}\n` +
        `${lines}\nTotal: ${rp(order.total)}` +
        shipLine +
        docs;
      await sendWaText(order.tenantId, ownerPhone, msg).catch(() => null);
    }
    if (order.buyerPhone) {
      const ship = order.shipping;
      const next =
        order.fulfillment === "courier" && ship
          ? ` Pesanan akan dikirim via ${ship.courierName ?? ship.courierCode ?? "kurir"} ${
              ship.serviceName ?? ship.serviceCode ?? ""
            }${ship.duration ? ` (estimasi ${ship.duration})` : ""}. Nomor resi & link pelacakan dikirim otomatis setelah paket dijemput kurir.`
          : " Silakan ambil pesanan Anda di toko.";
      const buyerMsg =
        `Pembayaran diterima. Pesanan ${order.orderId} sebesar ${rp(order.total)} sudah masuk.` +
        next +
        " Terima kasih.";
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
