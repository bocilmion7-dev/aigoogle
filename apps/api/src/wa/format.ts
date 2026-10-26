import type { ShopOrder, ShopOrderAccurate } from "./shop-order.js";

/**
 * Template pesan WhatsApp ke pembeli/pemilik.
 *
 * Pakai format bawaan WhatsApp (bukan Markdown): *tebal*, baris kosong sebagai
 * pemisah bagian, dan bullet "•". TIDAK memakai tabel/markdown "|" agar tampil
 * rapi di semua aplikasi WhatsApp (Android/iOS/Web).
 */

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
export const shortId = (id: string) => id.replace(/^shop-/, "");

function itemLines(order: ShopOrder): string {
  return order.items.map((i) => `• ${i.name} ×${i.qty} — ${rp(i.subtotal)}`).join("\n");
}

const courierText = (order: ShopOrder): string =>
  [order.shipping?.courierName ?? order.shipping?.courierCode, order.shipping?.serviceName ?? order.shipping?.serviceCode]
    .filter(Boolean)
    .join(" ");

/** Pesanan dibayar (QRIS settlement) — dikirim ke pembeli. */
export function paymentReceivedMessage(order: ShopOrder): string {
  const s = order.shipping;
  const isCourier = order.fulfillment === "courier" && !!s;
  const subtotal = order.itemsSubtotal ?? order.items.reduce((a, i) => a + i.subtotal, 0);
  const ongkir = isCourier ? (s.price ?? 0) : 0;
  const next = isCourier
    ? `Pesanan akan dikirim via *${courierText(order) || "kurir"}*${
        s.duration ? ` (estimasi ${s.duration})` : ""
      }.\nNo. resi & link lacak dikirim otomatis setelah paket dijemput kurir.`
    : "Silakan ambil pesanan Anda di toko.";
  return [
    "✅ *Pembayaran diterima*",
    "",
    `Halo ${order.buyerName || "kak"}, pesanan *${shortId(order.orderId)}* sudah kami terima.`,
    "",
    "*Rincian pesanan*",
    itemLines(order),
    ...(ongkir > 0 ? [`Subtotal: ${rp(subtotal)}`, `Ongkir (${courierText(order) || "kurir"}): ${rp(ongkir)}`] : []),
    `*Total: ${rp(order.total)}*`,
    "",
    next,
    "",
    "Terima kasih sudah berbelanja 🙏",
  ].join("\n");
}

/** Pesanan diserahkan ke kurir (resi + link lacak). */
export function shipmentCreatedMessage(order: ShopOrder, link: string): string {
  const s = order.shipping;
  return [
    "📦 *Pesanan dikirim*",
    "",
    `Halo ${order.buyerName || "kak"}, pesanan *${shortId(order.orderId)}* sudah diserahkan ke kurir.`,
    "",
    `Kurir: *${courierText(order) || "-"}*`,
    `No. resi: *${s?.waybillId || "menyusul dari kurir"}*`,
    ...(link ? ["", "Lacak paket:", link] : []),
  ].join("\n");
}

/** Update status pengiriman (webhook/polling). */
export function shippingUpdateMessage(order: ShopOrder, statusLabel: string, link: string): string {
  return [
    "🚚 *Update pengiriman*",
    "",
    `Pesanan *${shortId(order.orderId)}*`,
    statusLabel,
    ...(order.shipping?.waybillId ? ["", `No. resi: *${order.shipping.waybillId}*`] : []),
    ...(link ? [`Lacak: ${link}`] : []),
  ].join("\n");
}

/** Notifikasi internal ke pemilik toko saat pesanan lunas. */
export function ownerPaidMessage(order: ShopOrder, acc?: ShopOrderAccurate | null): string {
  const s = order.shipping;
  const isCourier = order.fulfillment === "courier" && !!s;
  const ship = isCourier
    ? `Pengiriman: ${courierText(order) || "kurir"} (${rp(s.price ?? 0)})` +
      (s.destinationAddress ? `\nAlamat: ${s.destinationAddress} (${s.destinationPostalCode ?? ""})` : "")
    : "Pengiriman: ambil sendiri di toko";
  const docs = acc?.salesInvoice
    ? `\n\n*Dokumen Accurate*\nFaktur: ${acc.salesInvoice.number}` +
      (acc.salesReceipt ? `\nPenerimaan kas: ${acc.salesReceipt.number}` : "")
    : "";
  return [
    "💰 *Pesanan toko sudah DIBAYAR*",
    "",
    `Order: *${order.orderId}*`,
    `Pembeli: ${order.buyerName || order.buyerPhone}`,
    "",
    itemLines(order),
    `*Total: ${rp(order.total)}*`,
    "",
    ship + docs,
  ].join("\n");
}
