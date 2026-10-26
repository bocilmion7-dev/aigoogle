import { describe, expect, it } from "vitest";
import {
  ownerPaidMessage,
  paymentReceivedMessage,
  shipmentCreatedMessage,
  shippingUpdateMessage,
} from "../src/wa/format.js";
import type { ShopOrder } from "../src/wa/shop-order.js";

const order: ShopOrder = {
  orderId: "shop-abc123def456",
  tenantId: "t1",
  buyerPhone: "628111222333",
  buyerName: "Rina",
  items: [
    { name: "Anti Gores Iphone 5", no: "9900012", qty: 2, price: 50000, subtotal: 100000 },
    { name: "Charger Iphone", no: "9900006", qty: 1, price: 200000, subtotal: 200000 },
  ],
  itemsSubtotal: 300000,
  fulfillment: "courier",
  shipping: {
    destinationAddress: "Jl. Melati No. 21, Jakarta",
    destinationPostalCode: "12950",
    courierName: "JNE",
    serviceName: "Reguler",
    price: 18000,
    duration: "2-3 hari",
    waybillId: "AWB1",
    trackingId: "TRK1",
  },
  total: 318000,
  status: "paid",
  qrUrl: "",
  qrContent: "",
  expiresAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

describe("format pesan WhatsApp", () => {
  it("pembayaran diterima: terstruktur, bold WhatsApp, bullet, tanpa tabel", () => {
    const msg = paymentReceivedMessage(order);
    expect(msg).toContain("*Pembayaran diterima*");
    expect(msg).toContain("pesanan *abc123def456*");
    expect(msg).toContain("• Anti Gores Iphone 5 ×2 — Rp100.000");
    expect(msg).toContain("• Charger Iphone ×1 — Rp200.000");
    expect(msg).toContain("Subtotal: Rp300.000");
    expect(msg).toContain("Ongkir (JNE Reguler): Rp18.000");
    expect(msg).toContain("*Total: Rp318.000*");
    expect(msg).toContain("Terima kasih");
    expect(msg).not.toContain("|");
    expect(msg.split("\n\n").length).toBeGreaterThan(2); // ada pemisah bagian
  });

  it("pesanan dikirim: kurir, resi, link lacak", () => {
    const msg = shipmentCreatedMessage(order, "https://ai-asisten.my.id/lacak/shop-abc123def456");
    expect(msg).toContain("📦 *Pesanan dikirim*");
    expect(msg).toContain("Kurir: *JNE Reguler*");
    expect(msg).toContain("No. resi: *AWB1*");
    expect(msg).toContain("https://ai-asisten.my.id/lacak/shop-abc123def456");
  });

  it("update pengiriman: label status + resi + link", () => {
    const msg = shippingUpdateMessage(order, "Paket sedang dalam perjalanan ke alamat tujuan.", "https://x/lacak/a");
    expect(msg).toContain("🚚 *Update pengiriman*");
    expect(msg).toContain("dalam perjalanan");
    expect(msg).toContain("No. resi: *AWB1*");
    expect(msg).toContain("Lacak: https://x/lacak/a");
  });

  it("notifikasi pemilik: total, bullet, dokumen Accurate", () => {
    const msg = ownerPaidMessage(order, { salesInvoice: { id: "1", number: "SI.1" }, salesReceipt: { id: "2", number: "SR.1" } });
    expect(msg).toContain("*Pesanan toko sudah DIBAYAR*");
    expect(msg).toContain("*Total: Rp318.000*");
    expect(msg).toContain("Faktur: SI.1");
    expect(msg).toContain("Penerimaan kas: SR.1");
  });
});
