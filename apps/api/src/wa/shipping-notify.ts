import { prisma } from "../db.js";
import { writeAudit } from "../audit.js";
import { trackingPageUrl } from "../shipping/biteship.js";
import { getShopOrder, patchShopOrder, type ShopOrder } from "./shop-order.js";
import { sendWaText } from "./service.js";

/** Label status Biteship → kalimat untuk pembeli (status bisa camelCase / snake_case). */
const STATUS_TEXT: Record<string, string> = {
  confirmed: "Pesanan dikonfirmasi — kurir sedang dicari.",
  allocated: "Kurir sudah ditugaskan, menunggu penjemputan paket.",
  pickingup: "Kurir sedang menuju toko untuk menjemput paket.",
  picked: "Paket sudah dijemput kurir.",
  intransit: "Paket sedang dalam perjalanan ke alamat tujuan.",
  droppingoff: "Paket sedang diantar ke alamat Anda.",
  returnintransit: "Paket sedang dikembalikan ke toko.",
  onhold: "Pengiriman sedang ditahan sementara oleh kurir.",
  delivered: "Paket sudah DITERIMA. Terima kasih sudah berbelanja!",
  rejected: "Pengiriman ditolak oleh kurir — kami akan menghubungi Anda.",
  couriernotfound: "Kurir tidak tersedia untuk rute ini — kami akan menghubungi Anda.",
  returned: "Paket sudah dikembalikan ke toko.",
  cancelled: "Pengiriman dibatalkan.",
  disposed: "Paket tidak dapat dikirim dan telah dibuang sesuai prosedur kurir.",
};

const normStatus = (s: string) => s.replace(/[_\s-]/g, "").toLowerCase();
const labelOf = (status: string) => STATUS_TEXT[normStatus(status)] ?? `Status pengiriman: ${status}`;
const isFinal = (status: string) =>
  ["delivered", "rejected", "returned", "cancelled", "disposed", "couriernotfound"].includes(normStatus(status));

/** Index Biteship order id → orderId agar webhook O(1). */
const indexKey = (biteshipId: string) => `wa:biteship_order:${biteshipId}`;

export async function indexBiteshipOrder(biteshipId: string, orderId: string): Promise<void> {
  if (!biteshipId) return;
  await prisma.appSetting.upsert({
    where: { key: indexKey(biteshipId) },
    create: { key: indexKey(biteshipId), value: orderId },
    update: { value: orderId },
  });
}

export async function findOrderByBiteshipId(biteshipId: string): Promise<ShopOrder | null> {
  if (!biteshipId) return null;
  const row = await prisma.appSetting.findUnique({ where: { key: indexKey(biteshipId) } });
  if (row?.value) {
    const byIndex = await getShopOrder(row.value);
    if (byIndex) return byIndex;
  }
  // fallback: pesanan lama yang belum terindeks
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: "wa:shop_order:" } } });
  for (const r of rows) {
    try {
      const o = JSON.parse(r.value) as ShopOrder;
      if (o.shipping?.biteshipOrderId === biteshipId) return o;
    } catch {
      /* abaikan baris rusak */
    }
  }
  return null;
}

/** Kirim info resi + link pelacakan ke pembeli (dipakai setelah input ke Biteship). */
export async function notifyShipmentCreated(order: ShopOrder): Promise<boolean> {
  if (order.buyerPhone.startsWith("sandbox:")) return false;
  const s = order.shipping;
  if (!s) return false;
  const link = s.trackingLink || trackingPageUrl(s.trackingId ?? "");
  const parts = [
    `Pesanan ${order.orderId} sudah diserahkan ke kurir.`,
    `Kurir: ${s.courierName ?? s.courierCode ?? "-"} ${s.serviceName ?? s.serviceCode ?? ""}`.trim(),
    s.waybillId ? `No. resi: ${s.waybillId}` : "Nomor resi menyusul dari kurir.",
    link ? `Lacak pengiriman: ${link}` : "",
  ].filter(Boolean);
  const sent = await sendWaText(order.tenantId, order.buyerPhone, parts.join("\n"));
  return sent.ok;
}

/**
 * Terapkan update pengiriman (webhook Biteship ATAU polling). Mengirim WA ke
 * pembeli hanya bila status berubah (anti spam) dan belum pernah dikirim.
 */
export async function applyShippingUpdate(input: {
  biteshipOrderId?: string;
  orderId?: string;
  trackingId?: string;
  waybillId?: string;
  status?: string;
  courierCompany?: string;
  courierType?: string;
  link?: string;
  source: "webhook" | "poll";
}): Promise<{ order: ShopOrder | null; notified: boolean }> {
  const order =
    (input.orderId ? await getShopOrder(input.orderId) : null) ??
    (input.biteshipOrderId ? await findOrderByBiteshipId(input.biteshipOrderId) : null);
  if (!order) return { order: null, notified: false };

  const nextStatus = input.status?.trim() || "";
  const statusChanged = !!nextStatus && normStatus(nextStatus) !== normStatus(order.shipping?.lastNotifiedStatus ?? "");
  const updated = await patchShopOrder(order.orderId, (o) => {
    o.shipping = {
      ...(o.shipping ?? {}),
      ...(input.trackingId ? { trackingId: input.trackingId } : {}),
      ...(input.waybillId ? { waybillId: input.waybillId } : {}),
      ...(nextStatus ? { status: nextStatus } : {}),
      ...(input.courierCompany ? { courierCode: input.courierCompany.toLowerCase() } : {}),
      ...(input.courierType ? { serviceCode: input.courierType.toLowerCase() } : {}),
      ...(input.link ? { trackingLink: input.link } : {}),
      ...(input.trackingId && !input.link && !o.shipping?.trackingLink
        ? { trackingLink: trackingPageUrl(input.trackingId) }
        : {}),
    };
  });
  if (!updated) return { order: null, notified: false };

  let notified = false;
  if (statusChanged && nextStatus) {
    const link = updated.shipping?.trackingLink || trackingPageUrl(updated.shipping?.trackingId ?? "");
    if (updated.buyerPhone.startsWith("sandbox:")) {
      // pesanan sandbox tidak mengirim WA, tetap catat status
    } else {
      const body = [
        `Update pengiriman ${updated.orderId}`,
        labelOf(nextStatus),
        updated.shipping?.waybillId ? `Resi: ${updated.shipping.waybillId}` : "",
        link ? `Lacak: ${link}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const sent = await sendWaText(updated.tenantId, updated.buyerPhone, body);
      notified = sent.ok;
    }
    await patchShopOrder(updated.orderId, (o) => {
      if (o.shipping) o.shipping.lastNotifiedStatus = nextStatus;
    });
    await writeAudit(updated.tenantId, "system", "wa.shipping_update", {
      orderId: updated.orderId,
      status: nextStatus,
      source: input.source,
      notified,
    });
  }
  return { order: updated, notified };
}

/** Polling fallback bila webhook Biteship belum dikonfigurasi di dashboard. */
export async function syncShippingStatuses(fetchTracking: (id: string, courier?: string) => Promise<{ status: string; waybillId: string; link: string; id: string }>): Promise<number> {
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: "wa:shop_order:" } } });
  let updated = 0;
  for (const row of rows) {
    let order: ShopOrder | null = null;
    try {
      order = JSON.parse(row.value) as ShopOrder;
    } catch {
      continue;
    }
    const s = order?.shipping;
    if (!s?.biteshipOrderId || !s.trackingId) continue;
    if (s.status && isFinal(s.status)) continue;
    try {
      const t = await fetchTracking(s.trackingId);
      if (!t.status) continue;
      if (normStatus(t.status) === normStatus(s.status ?? "")) continue;
      const r = await applyShippingUpdate({
        orderId: order.orderId,
        trackingId: t.id || s.trackingId,
        waybillId: t.waybillId || s.waybillId,
        status: t.status,
        link: t.link || undefined,
        source: "poll",
      });
      if (r.order) updated++;
    } catch {
      /* jangan hentikan loop karena satu paket gagal */
    }
  }
  return updated;
}
