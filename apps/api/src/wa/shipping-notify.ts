import { prisma } from "../db.js";
import { env } from "../env.js";
import { writeAudit } from "../audit.js";
import { trackingPageUrl } from "../shipping/biteship.js";
import { getShopOrder, patchShopOrder, type ShopOrder } from "./shop-order.js";
import { sendWaText } from "./service.js";
import { shipmentCreatedMessage, shippingUpdateMessage } from "./format.js";

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
export const labelOf = (status: string) => STATUS_TEXT[normStatus(status)] ?? `Status pengiriman: ${status}`;
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

/** URL halaman lacak PUBLIK milik aplikasi (tanpa login) — andal dibagikan ke pembeli. */
export function publicTrackingUrl(orderId: string): string {
  const origin = env.APP_ORIGIN.replace(/\/$/, "");
  return orderId ? `${origin}/lacak/${encodeURIComponent(orderId)}` : "";
}

/** Sandbox: catat balasan ke chat sandbox (tanpa kirim WA sungguhan). */
async function recordSandboxMessage(tenantId: string, peer: string, body: string): Promise<void> {
  await prisma.waMessageLog.create({
    data: { tenantId, to: peer, body, direction: "out", status: "sent", costCredits: 0 },
  });
}

/** Kirim info resi + link pelacakan ke pembeli (dipakai setelah input ke Biteship). */
export async function notifyShipmentCreated(order: ShopOrder): Promise<boolean> {
  const s = order.shipping;
  if (!s) return false;
  // utamakan halaman lacak kita sendiri (Biteship test-mode tidak bisa dibuka publik)
  const link = publicTrackingUrl(order.orderId) || s.trackingLink || trackingPageUrl(s.trackingId ?? "");
  const body = shipmentCreatedMessage(order, link);
  if (order.buyerPhone.startsWith("sandbox:")) {
    await recordSandboxMessage(order.tenantId, order.buyerPhone, body);
    return true;
  }
  const sent = await sendWaText(order.tenantId, order.buyerPhone, body);
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
    const link =
      publicTrackingUrl(updated.orderId) ||
      updated.shipping?.trackingLink ||
      trackingPageUrl(updated.shipping?.trackingId ?? "");
    const body = shippingUpdateMessage(updated, labelOf(nextStatus), link);
    if (updated.buyerPhone.startsWith("sandbox:")) {
      // sandbox: catat ke chat sandbox agar terlihat seperti WA sungguhan
      await recordSandboxMessage(updated.tenantId, updated.buyerPhone, body);
      notified = true;
    } else {
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
