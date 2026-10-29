import { accurateProvider } from "../providers/accounting/index.js";
import { accurateCtxFor } from "../providers/accounting/connection.js";
import type { AccountingProvider, ProviderCtx, ScannedLineItem } from "../providers/accounting/types.js";
import { writeAudit } from "../audit.js";
import { getShopOrder, patchShopOrder, type ShopOrder, type ShopOrderAccurate } from "./shop-order.js";

const desc = (order: ShopOrder) =>
  `${order.source === "storefront" ? "Pesanan Storefront" : "Pesanan WhatsApp"} ${order.orderId}`;

/** Nama pelanggan Accurate: nama pembeli dari WA, fallback nomor. */
export function customerNameFor(order: ShopOrder): string {
  return order.buyerName.trim() || `${order.source === "storefront" ? "Pembeli Storefront" : "Pembeli WA"} ${order.buyerPhone}`;
}

/** Item pesanan → baris Accurate; kode barang (no) dipakai bila ada, kalau tidak dicari by nama. */
export async function accurateItems(
  provider: AccountingProvider,
  ctx: ProviderCtx,
  order: ShopOrder
): Promise<ScannedLineItem[]> {
  const out: ScannedLineItem[] = [];
  for (const it of order.items.slice(0, 50)) {
    let itemNo = (it.no ?? "").trim();
    if (!itemNo) {
      const found = (await provider.execute("item.byName", { name: it.name }, ctx)) as {
        item?: { no?: unknown };
      };
      itemNo = String(found?.item?.no ?? "").trim();
    }
    if (!itemNo) throw new Error(`kode barang "${it.name}" tidak ditemukan di Accurate`);
    if (!(Number(it.price) > 0)) throw new Error(`harga item "${it.name}" belum terbaca`);
    out.push({ name: it.name, itemNo, qty: it.qty, price: it.price });
  }
  if (!out.length) throw new Error("pesanan tidak punya item");
  return out;
}

/** Cari/buat pelanggan Accurate utk pembeli WA; mengembalikan tautan pelanggan. */
export async function ensureOrderCustomer(
  provider: AccountingProvider,
  ctx: ProviderCtx,
  order: ShopOrder,
  opts?: { customerNo?: string; customerName?: string; createName?: string }
): Promise<{ customerNo: string; customerName: string }> {
  if (order.accurate?.customerNo) {
    return {
      customerNo: order.accurate.customerNo,
      customerName: order.accurate.customerName || customerNameFor(order),
    };
  }
  if (opts?.customerNo?.trim()) {
    return { customerNo: opts.customerNo.trim(), customerName: opts.customerName?.trim() || customerNameFor(order) };
  }
  const found = await provider.findOrCreateCustomer(ctx, {
    name: order.buyerName,
    // nomor HP hasil tanya AI lebih utama daripada nomor pengirim WA
    phone: order.buyerContactPhone || order.buyerPhone,
    // hanya buat pelanggan baru bila ada nama (dari WA atau diisi manual admin)
    createName: opts?.createName?.trim() || order.buyerName.trim() || undefined,
    description: `Pembeli WhatsApp ${order.buyerPhone}`,
  });
  if (!found) throw new Error("pelanggan Accurate belum ditemukan — isi nama pelanggan dulu");
  return { customerNo: found.customerNo, customerName: found.name };
}

/**
 * Sinkron OTOMATIS setelah QRIS lunas: faktur penjualan + penerimaan kas ke
 * Accurate (pelanggan dicari by nomor HP/nama, dibuat baru bila belum ada).
 * Tidak pernah melempar error — kegagalan disimpan di order.accurate.lastError
 * supaya bisa diulang dari halaman Pesanan.
 */
export async function syncShopOrderPaid(orderId: string): Promise<ShopOrder | null> {
  const order = await getShopOrder(orderId);
  if (!order) return null;
  const ctx = await accurateCtxFor(order.tenantId);
  if (!ctx) {
    return patchShopOrder(orderId, (o) => {
      o.accurate = { ...(o.accurate ?? {}), lastError: "Accurate belum terhubung" };
    });
  }
  const provider = accurateProvider();
  try {
    // saat lunas otomatis: bila nama tak diketahui, pakai label WA + nomor
    const cust = await ensureOrderCustomer(provider, ctx, order, { createName: customerNameFor(order) });
    const items = await accurateItems(provider, ctx, order);
    const base: ShopOrderAccurate = { ...(order.accurate ?? {}), ...cust };
    let invoice = base.salesInvoice;
    if (!invoice) {
      // ongkos kirim ikut ditagihkan di faktur supaya total faktur = total yang
      // dibayar pembeli (faktur barang saja membuat penerimaan kas "melebihi
      // nilai piutang faktur" di Accurate).
      const ship =
        order.fulfillment === "courier" && order.shipping?.price
          ? {
              amount: order.shipping.price,
              name: `Ongkir ${[order.shipping.courierName, order.shipping.serviceName].filter(Boolean).join(" ")}`.trim(),
            }
          : undefined;
      invoice = await provider.createSalesInvoice(ctx, {
        customerName: cust.customerName,
        description: desc(order),
        items,
        ...(ship ? { shipping: ship } : {}),
      });
      base.salesInvoice = invoice;
    }
    let receipt = base.salesReceipt;
    if (!receipt && invoice.number) {
      try {
        receipt = await provider.createSalesReceipt(ctx, {
          customerName: cust.customerName,
          amount: order.total,
          invoiceNo: invoice.number,
          description: `Pembayaran QRIS pesanan ${order.orderId}`,
        });
        base.salesReceipt = receipt;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (/sudah lunas/i.test(msg)) {
          // faktur sudah dibayar penuh di Accurate (mis. percobaan sinkron
          // sebelumnya) — bukan kegagalan; lanjut tanpa penerimaan kas baru.
        } else {
          throw e;
        }
      }
    }
    base.syncedAt = new Date().toISOString();
    delete base.lastError;
    const updated = await patchShopOrder(orderId, { accurate: base });
    await writeAudit(order.tenantId, "system", "wa.shop_order_accurate", {
      orderId,
      customerNo: base.customerNo,
      salesInvoice: invoice?.number,
      salesReceipt: receipt?.number,
      source: "auto",
    });
    return updated;
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "gagal sinkron Accurate";
    await writeAudit(order.tenantId, "system", "wa.shop_order_accurate_failed", { orderId, message });
    return patchShopOrder(orderId, (o) => {
      o.accurate = { ...(o.accurate ?? {}), lastError: message };
    });
  }
}
