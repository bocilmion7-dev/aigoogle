import { prisma } from "../db.js";

export interface ShopOrderItem {
  name: string;
  no: string;
  qty: number;
  price: number;
  subtotal: number;
  stock?: number | null;
}

export interface ShopOrderAccurateDoc {
  id: string;
  number: string;
}

/** Tautan dokumen Accurate utk satu pesanan toko WA. */
export interface ShopOrderAccurate {
  customerNo?: string;
  customerName?: string;
  salesOrder?: ShopOrderAccurateDoc;
  salesInvoice?: ShopOrderAccurateDoc;
  salesReceipt?: ShopOrderAccurateDoc;
  syncedAt?: string;
  /** error terakhir saat sinkron otomatis — ditampilkan di halaman Pesanan */
  lastError?: string;
}

export type Fulfillment = "pickup" | "courier";

/** Data pengiriman (kurir) — diisi saat pesanan memakai jasa kirim. */
export interface ShopShipping {
  destinationAddress?: string;
  destinationPostalCode?: string;
  destinationNote?: string;
  /** nomor HP penerima yang dipakai ke kurir (bisa berbeda dgn nomor WA) */
  destinationPhone?: string;
  courierName?: string;
  courierCode?: string;
  serviceName?: string;
  serviceCode?: string;
  price?: number;
  duration?: string;
  weightGram?: number;
  /** hasil input ke Biteship */
  biteshipOrderId?: string;
  /** id tracking Biteship (untuk API tracking & halaman publik) */
  trackingId?: string;
  /** link pelacakan yang dikirim ke pembeli */
  trackingLink?: string;
  waybillId?: string;
  status?: string;
  /** status terakhir yang sudah diberitahukan ke pembeli (anti dobel kirim) */
  lastNotifiedStatus?: string;
  /** resi sudah pernah dikirim ke pembeli */
  waybillNotified?: boolean;
}

export interface ShopOrder {
  orderId: string;
  tenantId: string;
  buyerPhone: string;
  buyerName: string;
  /** nomor HP yang wajib dikumpulkan AI dari pembeli (bisa beda dgn nomor WA) */
  buyerContactPhone?: string;
  items: ShopOrderItem[];
  total: number;
  status: "pending" | "paid" | "failed";
  qrUrl: string;
  qrContent: string;
  expiresAt: string;
  createdAt: string;
  /** ambil sendiri di toko (default) atau dikirim kurir */
  fulfillment?: Fulfillment;
  /** subtotal barang; `total` = subtotal + ongkir */
  itemsSubtotal?: number;
  shipping?: ShopShipping;
  accurate?: ShopOrderAccurate;
  /** asal pesanan: WhatsApp lama (default) atau storefront publik */
  source?: "wa" | "storefront";
  storeSlug?: string;
}

const keyOf = (orderId: string) => `wa:shop_order:${orderId}`;

export async function saveShopOrder(order: ShopOrder): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: keyOf(order.orderId) },
    create: { key: keyOf(order.orderId), value: JSON.stringify(order) },
    update: { value: JSON.stringify(order) },
  });
}

export async function getShopOrder(orderId: string): Promise<ShopOrder | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: keyOf(orderId) } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as ShopOrder;
  } catch {
    return null;
  }
}

export async function setShopOrderStatus(orderId: string, status: ShopOrder["status"]): Promise<void> {
  const order = await getShopOrder(orderId);
  if (!order) return;
  order.status = status;
  await saveShopOrder(order);
}

/** Ubah sebagian data pesanan (mis. menyimpan tautan dokumen Accurate). */
export async function patchShopOrder(
  orderId: string,
  patch: Partial<ShopOrder> | ((order: ShopOrder) => void)
): Promise<ShopOrder | null> {
  const order = await getShopOrder(orderId);
  if (!order) return null;
  if (typeof patch === "function") patch(order);
  else Object.assign(order, patch);
  await saveShopOrder(order);
  return order;
}

/** Pesanan toko milik satu perusahaan (opsional disaring per nomor pembeli), terbaru dulu. */
export async function listShopOrders(tenantId: string, buyerPhone?: string, limit = 20): Promise<ShopOrder[]> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { startsWith: "wa:shop_order:" } },
    select: { value: true },
  });
  const out: ShopOrder[] = [];
  for (const row of rows) {
    let order: ShopOrder | null = null;
    try {
      order = JSON.parse(row.value) as ShopOrder;
    } catch {
      continue;
    }
    if (!order?.orderId || order.tenantId !== tenantId) continue;
    if (buyerPhone && order.buyerPhone !== buyerPhone) continue;
    out.push(order);
  }
  out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return out.slice(0, limit);
}
