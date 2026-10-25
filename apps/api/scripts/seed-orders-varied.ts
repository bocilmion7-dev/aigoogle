/** Seed pesanan toko WA dengan DATA REAL (produk & harga dari Accurate, QRIS Midtrans sandbox)
 *  dan STATUS BERVARIASI — bahan demo halaman Pesanan / Chat WhatsApp.
 *
 *  Jalankan:  npx tsx --env-file=../../.env scripts/seed-orders-varied.ts
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/db.js";
import { isBillingEnabled } from "../src/billing/midtrans.js";
import { generateQrMpm, midtransSnapReady } from "../src/billing/midtrans-snap.js";
import {
  getShopOrder,
  saveShopOrder,
  patchShopOrder,
  type ShopOrder,
  type ShopOrderItem,
  type ShopShipping,
} from "../src/wa/shop-order.js";
import { accurateCtxFor } from "../src/providers/accounting/connection.js";
import { accurateProvider } from "../src/providers/accounting/index.js";
import { ensureOrderCustomer, accurateItems, syncShopOrderPaid } from "../src/wa/shop-accurate.js";

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const minAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const daysAgo = (d: number) => minAgo(d * 24 * 60 + 10 * 60);

/* QR palsu (SVG) untuk pesanan yang sudah lunas/gagal (tak butuh QRIS aktif) */
function fakeQrDataUri(seed: string): string {
  const N = 25;
  const cell = 6;
  let a = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    a ^= seed.charCodeAt(i);
    a = Math.imul(a, 16777619);
  }
  const rnd = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + 0x6d2b79f5) | 0;
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
  const on: boolean[][] = Array.from({ length: N }, () => Array<boolean>(N).fill(false));
  const finder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const edge = r === 0 || r === 6 || c === 0 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        on[r0 + r]![c0 + c] = edge || core;
      }
    }
  };
  const reserved = (r: number, c: number) => (r < 8 && c < 8) || (r < 8 && c >= N - 8) || (r >= N - 8 && c < 8);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) if (!reserved(r, c) && rnd() < 0.45) on[r]![c] = true;
  }
  for (let i = 8; i < N - 8; i++) {
    on[6]![i] = i % 2 === 0;
    on[i]![6] = i % 2 === 0;
  }
  finder(0, 0);
  finder(0, N - 7);
  finder(N - 7, 0);
  const size = N * cell + 24;
  let rects = "";
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (on[r]![c]) rects += `<rect x="${12 + c * cell}" y="${12 + r * cell}" width="${cell}" height="${cell}"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/* Produk ASLI dari Accurate (kode + harga jual + stok) */
interface Product {
  name: string;
  no: string;
  price: number;
  stock: number;
}

async function productsFromAccurate(tenantId: string): Promise<Product[]> {
  const ctx = await accurateCtxFor(tenantId);
  if (!ctx) throw new Error("Accurate belum terhubung");
  const provider = accurateProvider();
  const out: Product[] = [];
  const listed = (await provider.execute("item.list", { pageSize: 60, page: 1 }, ctx)) as unknown;
  const rows = (
    Array.isArray(listed) ? listed : (listed as { items?: Array<Record<string, unknown>> }).items ?? []
  ) as Array<Record<string, unknown>>;
  for (const row of rows) {
    if (out.length >= 6) break;
    if (!(Number(row.quantity ?? 0) > 0)) continue;
    const no = String(row.no ?? "");
    const name = String(row.name ?? no);
    if (!no || out.some((p) => p.no === no)) continue;
    let price = 0;
    try {
      const det = (await provider.execute("item.detail", { id: String(row.id ?? "") }, ctx)) as Record<string, unknown>;
      const d = ((det.item ?? det) as Record<string, unknown>) ?? {};
      const list = (d.detailSellingPrice as Array<Record<string, unknown>> | undefined) ?? [];
      const chosen =
        list.find(
          (p) =>
            (p.priceCategory as { defaultCategory?: boolean } | undefined)?.defaultCategory === true &&
            (p.currency as { code?: string } | undefined)?.code === "IDR" &&
            (p.unit as { name?: string } | undefined)?.name === "PCS"
        ) ??
        list.find((p) => (p.currency as { code?: string } | undefined)?.code === "IDR") ??
        list[0];
      const v = Number(chosen?.price);
      if (Number.isFinite(v) && v > 0) price = v;
    } catch {
      /* lanjut byName */
    }
    if (!(price > 0)) {
      const byName = (await provider.execute("item.byName", { name }, ctx)) as { sellingPrice?: unknown };
      const v = Number(byName?.sellingPrice);
      price = Number.isFinite(v) ? v : 0;
    }
    if (!(price > 0)) continue;
    out.push({ no, name, price, stock: Number(row.quantity ?? 0) });
  }
  return out;
}

/* Pembeli (nama & nomor realistis) */
interface Buyer {
  name: string;
  phone: string;
  address?: string;
  postal?: string;
}
const BUYERS: Buyer[] = [
  { phone: "6281281113401", name: "Rina Kusuma" },
  {
    phone: "6281382224502",
    name: "Hendra Wijaya",
    address: "Jl. Melati Raya No. 21, RT 04/RW 06, Kel. Sukamaju, Kec. Cilodong",
    postal: "16413",
  },
  { phone: "6281283335403", name: "Dewi Anggraini" },
  {
    phone: "6281574412809",
    name: "Agus Prasetyo",
    address: "Perum Griya Asri Blok C2 No. 9, Kel. Wanamulya",
    postal: "40194",
  },
  { phone: "6281987614405", name: "Ibu Ratna Sari" },
  { phone: "6281294446507", name: "Sinta Ramadhani" },
  {
    phone: "6281560011708",
    name: "Fajar Nugroho",
    address: "Jl. Kenanga Selatan VII No. 3, RT 002/RW 005, Kel. Pekayon",
    postal: "17148",
  },
];

async function makeOrder(opts: {
  tenantId: string;
  buyer: Buyer;
  products: Product[];
  qtys: number[];
  fulfillment: "pickup" | "courier";
  status: "pending" | "paid" | "failed";
  paymentStatus: string;
  createdAt: string;
  ongkir?: number;
}): Promise<{ orderId: string; total: number; items: ShopOrderItem[]; qrUrl: string }> {
  const lines: ShopOrderItem[] = opts.qtys.map((qty, i) => {
    const p = opts.products[i % opts.products.length];
    return { name: p.name, no: p.no, qty, price: p.price, subtotal: p.price * qty, stock: p.stock };
  });
  const subtotal = lines.reduce((a, l) => a + l.subtotal, 0);
  const ongkir = opts.fulfillment === "courier" ? (opts.ongkir ?? 15000) : 0;
  const shipping: ShopShipping | undefined =
    opts.fulfillment === "courier"
      ? {
          destinationAddress: opts.buyer.address ?? "",
          destinationPostalCode: opts.buyer.postal ?? "",
          destinationNote: "Titip ke security bila rumah kosong",
          courierName: "JNE",
          courierCode: "jne",
          serviceName: "Reguler",
          serviceCode: "reg",
          price: ongkir,
          duration: "2-3 hari",
          weightGram: 2000,
        }
      : undefined;
  const total = subtotal + ongkir;
  const orderId = `shop-${randomBytes(6).toString("hex")}`;
  await prisma.payment.create({
    data: { tenantId: opts.tenantId, orderId, amount: total, status: opts.paymentStatus, paymentMethod: "qris" },
  });
  let qrUrl = "";
  let qrContent = "00020101021126610014COM.GO-JEK.WWW01189360091432507175720210";
  if (opts.status === "pending" && isBillingEnabled() && midtransSnapReady()) {
    try {
      const qr = await generateQrMpm(orderId, total);
      qrUrl = qr.qrUrl;
      qrContent = qr.qrContent;
      await prisma.payment.update({ where: { orderId }, data: { fraudStatus: qr.referenceNo } });
    } catch (e) {
      console.warn(`  QRIS asli gagal (${orderId.slice(-6)}): ${e instanceof Error ? e.message.slice(0, 120) : e}`);
    }
  }
  if (!qrUrl) qrUrl = fakeQrDataUri(orderId);
  const order: ShopOrder = {
    orderId,
    tenantId: opts.tenantId,
    buyerPhone: opts.buyer.phone,
    buyerName: opts.buyer.name,
    items: lines,
    itemsSubtotal: subtotal,
    total,
    status: opts.status,
    qrUrl,
    qrContent,
    expiresAt: new Date(new Date(opts.createdAt).getTime() + 15 * 60_000).toISOString(),
    createdAt: opts.createdAt,
    fulfillment: opts.fulfillment,
  };
  if (shipping) order.shipping = shipping;
  await saveShopOrder(order);
  return { orderId, total, items: lines, qrUrl };
}

/** Percakapan WhatsApp realistis untuk satu pesanan. */
async function seedChat(
  tenantId: string,
  o: { orderId: string; total: number; items: ShopOrderItem[]; buyer: Buyer; courier: boolean },
  qrUrl: string,
  status: "pending" | "paid" | "failed",
  baseMinAgo: number
): Promise<void> {
  const p0 = o.items[0]!;
  const msgs: Array<{ d: "in" | "out"; body: string; min: number }> = [
    { d: "in", body: `Halo, ${p0.name.toLowerCase()} ready kak?`, min: 26 },
    { d: "out", body: `Halo kak! Ready ya. ${p0.name} ${rp(p0.price)} (stok ${p0.stock}). Mau berapa?`, min: 9 },
    {
      d: "in",
      body: `Mau ${o.items.map((p) => `${p.qty} ${p.name}`).join(" & ")}${o.courier ? ", kirim ke alamat ya" : ""}`,
      min: 8,
    },
  ];
  if (o.courier) {
    msgs.push({
      d: "out",
      body: `Siap kak. Ongkir JNE Reguler ${rp(15000)} (estimasi 2-3 hari). Lanjut order ya kak.`,
      min: 7,
    });
  }
  msgs.push(
    {
      d: "out",
      body: `[image] Total ${rp(o.total)} ya kak${o.courier ? " (barang + ongkir)" : ""}. Silakan pindai gambar QRIS ini untuk menyelesaikan pembayaran.\n${qrUrl}`,
      min: 6,
    },
    { d: "out", body: `Total ${rp(o.total)} ya kak. Pembayaran diverifikasi otomatis, tidak perlu kirim bukti transfer.`, min: 5 }
  );
  if (status === "paid") {
    msgs.push({
      d: "out",
      body:
        `Pembayaran diterima. Pesanan ${o.orderId} sebesar ${rp(o.total)} sudah masuk.` +
        (o.courier
          ? " Pesanan akan dikirim via JNE Reguler (estimasi 2-3 hari). Nomor resi & link pelacakan dikirim otomatis setelah paket dijemput kurir."
          : " Silakan ambil pesanan Anda di toko.") +
        " Terima kasih.",
      min: 2,
    });
  } else if (status === "failed") {
    msgs.push({
      d: "out",
      body: `Pesanan ${o.orderId} kedaluwarsa & tidak dibayar — pesanan dibatalkan. Kakak bisa pesan ulang kapan saja ya.`,
      min: 1,
    });
  }
  await prisma.waMessageLog.createMany({
    data: msgs.map((m) => ({
      tenantId,
      to: o.buyer.phone,
      body: m.body,
      direction: m.d,
      status: m.d === "in" ? "received" : "sent",
      costCredits: m.d === "in" ? 0 : 1,
      createdAt: new Date(Date.now() - (baseMinAgo + m.min) * 60_000),
    })),
  });
}

async function main(): Promise<void> {
  const ownerRow = await prisma.appSetting.findFirst({ where: { key: { startsWith: "wa:owner_phone:" } } });
  const tenantId = ownerRow ? ownerRow.key.slice("wa:owner_phone:".length) : "";
  const tenant = tenantId
    ? await prisma.tenant.findUnique({ where: { id: tenantId } })
    : await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!tenant) throw new Error("tidak ada tenant");
  console.log(`tenant: ${tenant.name} (${tenant.alias || tenant.id})`);

  const products = await productsFromAccurate(tenant.id);
  if (products.length < 2) throw new Error(`produk Accurate kurang: ${products.length}`);
  console.log("produk:", products.map((p) => `${p.name} [${p.no}] ${rp(p.price)}`).join(" | "));

  // 1) MENUNGGU BAYAR — pickup, QRIS asli (2 jam lalu)
  const a = await makeOrder({
    tenantId: tenant.id,
    buyer: BUYERS[0]!,
    products: [products[0]!],
    qtys: [1],
    fulfillment: "pickup",
    status: "pending",
    paymentStatus: "pending",
    createdAt: minAgo(120),
  });
  await seedChat(tenant.id, { ...a, buyer: BUYERS[0]!, courier: false }, a.qrUrl, "pending", 20);

  // 2) MENUNGGU BAYAR — courier, QRIS asli aktif (45 menit lalu)
  const b = await makeOrder({
    tenantId: tenant.id,
    buyer: BUYERS[1]!,
    products,
    qtys: [1, 2],
    fulfillment: "courier",
    status: "pending",
    paymentStatus: "pending",
    createdAt: minAgo(45),
    ongkir: 15000,
  });
  await seedChat(tenant.id, { ...b, buyer: BUYERS[1]!, courier: true }, b.qrUrl, "pending", 40);

  // 3) LUNAS — pickup, belum ada dokumen Accurate (kemarin)
  const c = await makeOrder({
    tenantId: tenant.id,
    buyer: BUYERS[2]!,
    products: [products[2] ?? products[0]!],
    qtys: [2],
    fulfillment: "pickup",
    status: "paid",
    paymentStatus: "settlement",
    createdAt: daysAgo(1),
  });
  await seedChat(tenant.id, { ...c, buyer: BUYERS[2]!, courier: false }, c.qrUrl, "paid", 24 * 60);

  // 4) SELESAI — courier lunas, sinkron penuh (faktur + penerimaan kas) REAL Accurate
  const d = await makeOrder({
    tenantId: tenant.id,
    buyer: BUYERS[3]!,
    products,
    qtys: [2, 1],
    fulfillment: "courier",
    status: "paid",
    paymentStatus: "settlement",
    createdAt: daysAgo(2),
    ongkir: 18000,
  });
  await seedChat(tenant.id, { ...d, buyer: BUYERS[3]!, courier: true }, d.qrUrl, "paid", 2 * 24 * 60);
  const updated = await syncShopOrderPaid(d.orderId);
  console.log(`  sinkron selesai (${d.orderId}):`, JSON.stringify(updated?.accurate ?? null));

  // 5) PESANAN ACCURATE — courier lunas, hanya sales order (tanpa faktur)
  const e = await makeOrder({
    tenantId: tenant.id,
    buyer: BUYERS[4]!,
    products,
    qtys: [3],
    fulfillment: "courier",
    status: "paid",
    paymentStatus: "settlement",
    createdAt: daysAgo(3),
    ongkir: 18000,
  });
  await seedChat(tenant.id, { ...e, buyer: BUYERS[4]!, courier: true }, e.qrUrl, "paid", 3 * 24 * 60);
  {
    const ctx = await accurateCtxFor(tenant.id)!;
    const provider = accurateProvider();
    const ord = (await getShopOrder(e.orderId))!;
    const cust = await ensureOrderCustomer(provider, ctx, ord, { createName: ord.buyerName });
    const so = await provider.createSalesOrder(ctx, {
      customerNo: cust.customerNo,
      description: `Pesanan WhatsApp ${e.orderId}`,
      items: (await accurateItems(provider, ctx, ord)).map((it) => ({
        itemNo: it.itemNo!,
        qty: it.qty ?? 1,
        price: it.price ?? 0,
      })),
    });
    await patchShopOrder(e.orderId, (o) => {
      o.accurate = { ...(o.accurate ?? {}), customerNo: cust.customerNo, customerName: cust.customerName, salesOrder: so };
    });
    console.log(`  SO created (${e.orderId}):`, so.number);
  }

  // 6) DIFAKTURKAN — pickup lunas + faktur (belum diterima kasnya)
  const f = await makeOrder({
    tenantId: tenant.id,
    buyer: BUYERS[5]!,
    products,
    qtys: [1],
    fulfillment: "pickup",
    status: "paid",
    paymentStatus: "settlement",
    createdAt: daysAgo(4),
  });
  {
    const provider = accurateProvider();
    const ctx = (await accurateCtxFor(tenant.id))!;
    const ord = (await getShopOrder(f.orderId))!;
    const cust = await ensureOrderCustomer(provider, ctx, ord, { createName: ord.buyerName });
    const items = await accurateItems(provider, ctx, ord);
    const invoice = await provider.createSalesInvoice(ctx, {
      customerName: cust.customerName,
      description: `Pesanan WhatsApp ${f.orderId}`,
      items,
    });
    await patchShopOrder(f.orderId, (o) => {
      o.accurate = { ...(o.accurate ?? {}), customerNo: cust.customerNo, customerName: cust.customerName, salesInvoice: invoice, syncedAt: new Date().toISOString() };
    });
    console.log(`  faktur created (${f.orderId}):`, invoice.number);
  }
  await seedChat(tenant.id, { ...f, buyer: BUYERS[5]!, courier: false }, f.qrUrl, "paid", 4 * 24 * 60);

  // 7) GAGAL — kedaluwarsa tanpa pembayaran (5 hari lalu)
  const g = await makeOrder({
    tenantId: tenant.id,
    buyer: BUYERS[6]!,
    products: [products[1]!],
    qtys: [1],
    fulfillment: "pickup",
    status: "failed",
    paymentStatus: "cancel",
    createdAt: daysAgo(5),
  });
  await seedChat(tenant.id, { ...g, buyer: BUYERS[6]!, courier: false }, g.qrUrl, "failed", 5 * 24 * 60);

  // ringkasan
  console.log("\nSelesai. Ringkasan:");
  const all = await prisma.appSetting.findMany({ where: { key: { startsWith: "wa:shop_order:" } } });
  for (const r of all) {
    const o = JSON.parse(r.value) as ShopOrder;
    const stage =
      o.accurate?.salesReceipt ? "selesai" :
      o.accurate?.salesInvoice ? "difakturkan" :
      o.accurate?.salesOrder ? "pesanan-acc" :
      o.status === "paid" ? "lunas" :
      o.status === "failed" ? "gagal" : "menunggu";
    console.log(`- ${o.orderId} | ${o.buyerName} | ${o.status}/${stage} | ${rp(o.total)} | ${o.fulfillment ?? "pickup"} | SI: ${o.accurate?.salesInvoice?.number ?? "-"} | error: ${o.accurate?.lastError ?? "-"}`);
  }
  await prisma.$disconnect();
}

main();
