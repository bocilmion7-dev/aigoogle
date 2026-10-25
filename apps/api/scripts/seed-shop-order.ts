/** Seed percakapan WhatsApp + pesanan toko (QRIS) — bahan uji simulator pembayaran.
 *
 *  Jalankan:
 *    pnpm --filter @aigoogle/api seed:shop-order
 *    npx tsx --env-file=../../.env scripts/seed-shop-order.ts \
 *      [--tenant <id|alias>] [--phone 6280000000001] [--qty 2] [--paid] [--reset] [--no-qr]
 *      [--items "KODE1,KODE2"] [--fake-items]
 *
 *  Produk diambil dari Accurate perusahaan (kode barang + harga jual + stok ASLI)
 *  supaya tombol "Input Pesanan (SO)" di halaman Pesanan langsung berhasil.
 *  `--fake-items` memakai daftar contoh lokal; `--items` memilih kode barang tertentu.
 *
 *  Hasilnya: 1 chat berisi pertanyaan pembeli, jawaban toko, gambar QRIS, dan
 *  1 pesanan `shop-mock-*` berstatus pending — tinggal buka menu Chat WhatsApp,
 *  pilih nomor pembeli, lalu tekan "Tandai lunas (simulasi)".
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/db.js";
import { isBillingEnabled } from "../src/billing/midtrans.js";
import { generateQrMpm, midtransSnapReady } from "../src/billing/midtrans-snap.js";
import { saveShopOrder, type ShopOrder } from "../src/wa/shop-order.js";
import { accurateCtxFor } from "../src/providers/accounting/connection.js";
import { accurateProvider } from "../src/providers/accounting/index.js";

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

interface Product {
  name: string;
  no: string;
  price: number;
  stock: number;
}

interface Arg {
  tenant?: string;
  phone: string;
  qty: number;
  paid: boolean;
  reset: boolean;
  noQr: boolean;
  /** kode barang Accurate yang dipilih manual */
  items: string[];
  /** paksa pakai daftar produk lokal (tanpa Accurate) */
  fakeItems: boolean;
}

function parseArgs(argv: string[]): Arg {
  const a: Arg = {
    phone: "6280000000001",
    qty: 2,
    paid: false,
    reset: false,
    noQr: false,
    items: [],
    fakeItems: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i] ?? "";
    if (k === "--tenant") a.tenant = next();
    else if (k === "--phone") a.phone = next().replace(/\D/g, "");
    else if (k === "--qty") a.qty = Math.max(1, Math.round(Number(next()) || 1));
    else if (k === "--paid") a.paid = true;
    else if (k === "--reset") a.reset = true;
    else if (k === "--no-qr") a.noQr = true;
    else if (k === "--items") a.items = next().split(",").map((v) => v.trim()).filter(Boolean);
    else if (k === "--fake-items") a.fakeItems = true;
    else if (k === "--help" || k === "-h") {
      console.log(
        'Pemakaian: scripts/seed-shop-order.ts [--tenant <id|alias>] [--phone 628..] [--qty 2] [--paid] [--reset] [--no-qr] [--items "KODE1,KODE2"] [--fake-items]'
      );
      process.exit(0);
    }
  }
  if (!/^\d{8,16}$/.test(a.phone)) {
    console.error(`Nomor tidak valid: ${a.phone}`);
    process.exit(1);
  }
  return a;
}

const PRODUCTS: Product[] = [
  { name: "Kopi Susu", no: "", price: 15000, stock: 9 },
  { name: "Es Teh Manis", no: "", price: 8000, stock: 24 },
  { name: "Roti Bakar Cokelat", no: "", price: 22000, stock: 6 },
];

/**
 * Produk ASLI dari Accurate: kode barang, harga jual, dan stok.
 * Harga diambil dari `item.detail` (detailSellingPrice) karena `get-selling-price`
 * sering balas null untuk barang lama; hanya barang stok>0 & harga>0 dipakai.
 */
async function productsFromAccurate(
  tenantId: string,
  picks: string[],
  count = 2
): Promise<Product[] | null> {
  const ctx = await accurateCtxFor(tenantId);
  if (!ctx) return null;
  const provider = accurateProvider();
  const out: Product[] = [];

  const priceOf = async (row: Record<string, unknown>): Promise<number> => {
    const id = String(row.id ?? "");
    if (id) {
      try {
        const det = (await provider.execute("item.detail", { id }, ctx)) as Record<string, unknown>;
        const d = ((det.item ?? det) as Record<string, unknown>) ?? {};
        const list = (d.detailSellingPrice as Array<Record<string, unknown>> | undefined) ?? [];
        const pickOf = (pred: (p: Record<string, unknown>) => boolean) => list.find(pred);
        const chosen =
          pickOf((p) => (p.priceCategory as { defaultCategory?: boolean } | undefined)?.defaultCategory === true &&
              (p.currency as { code?: string } | undefined)?.code === "IDR" &&
              (p.unit as { name?: string } | undefined)?.name === "PCS") ??
          pickOf((p) => (p.currency as { code?: string } | undefined)?.code === "IDR") ??
          list[0];
        const price = Number(chosen?.price);
        if (Number.isFinite(price) && price > 0) return price;
      } catch {
        /* lanjut ke byName */
      }
    }
    const byName = (await provider.execute("item.byName", { name: String(row.name ?? row.no ?? "") }, ctx)) as {
      sellingPrice?: unknown;
    };
    const price = Number(byName?.sellingPrice);
    return Number.isFinite(price) ? price : 0;
  };

  const add = async (row: Record<string, unknown> | null) => {
    if (!row) return;
    const no = String(row.no ?? "");
    const name = String(row.name ?? no);
    if (!no || out.some((p) => p.no === no)) return;
    const stock = Number(row.quantity ?? 0);
    const price = await priceOf(row);
    if (!(price > 0)) return;
    out.push({ no, name, price, stock: Number.isFinite(stock) ? stock : 0 });
  };

  const listRows = async (keywords: string, pageSize: number) => {
    const listed = (await provider.execute("item.list", { keywords, pageSize, page: 1 }, ctx)) as {
      items?: Array<Record<string, unknown>>;
    };
    return Array.isArray(listed) ? (listed as unknown as Array<Record<string, unknown>>) : listed.items ?? [];
  };

  if (picks.length) {
    for (const p of picks) {
      const rows = await listRows(p, 5);
      const hit =
        rows.find((r) => String(r.no ?? "").toLowerCase() === p.toLowerCase()) ??
        rows.find((r) => String(r.name ?? "").toLowerCase() === p.toLowerCase()) ??
        rows[0];
      await add(hit ?? null);
    }
    return out.length ? out : null;
  }

  const rows = await listRows("", 60);
  for (const row of rows) {
    if (out.length >= count) break;
    if (!(Number(row.quantity ?? 0) > 0)) continue;
    await add(row);
  }
  return out.length ? out : null;
}

/* ── QR palsu (SVG) — dipakai bila QRIS asli tak bisa dibuat ─────────────── */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fakeQrDataUri(seed: string): string {
  const N = 25;
  const cell = 6;
  const pad = 12;
  const rnd = mulberry32(hash32(seed));
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
  const reserved = (r: number, c: number) =>
    (r < 8 && c < 8) || (r < 8 && c >= N - 8) || (r >= N - 8 && c < 8);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!reserved(r, c) && rnd() < 0.45) on[r]![c] = true;
    }
  }
  for (let i = 8; i < N - 8; i++) {
    on[6]![i] = i % 2 === 0;
    on[i]![6] = i % 2 === 0;
  }
  finder(0, 0);
  finder(0, N - 7);
  finder(N - 7, 0);
  const size = N * cell + pad * 2;
  let rects = "";
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (on[r]![c]) rects += `<rect x="${pad + c * cell}" y="${pad + r * cell}" width="${cell}" height="${cell}"/>`;
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

async function pickTenant(want?: string) {
  if (want) {
    const byId = await prisma.tenant.findUnique({ where: { id: want } });
    if (byId) return byId;
    const byAlias = await prisma.tenant.findFirst({
      where: { OR: [{ alias: want.toUpperCase() }, { name: want }] },
      orderBy: { createdAt: "asc" },
    });
    if (byAlias) return byAlias;
    console.error(`Tenant tidak ditemukan: ${want}`);
    process.exit(1);
  }
  const withOwner = await prisma.appSetting.findFirst({ where: { key: { startsWith: "wa:owner_phone:" } } });
  if (withOwner) {
    const id = withOwner.key.slice("wa:owner_phone:".length);
    const t = await prisma.tenant.findUnique({ where: { id } });
    if (t) return t;
  }
  const first = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!first) {
    console.error("Belum ada tenant di database — jalankan dulu: pnpm --filter @aigoogle/api demo:accounts");
    process.exit(1);
  }
  return first;
}

async function resetMock(tenantId: string, phone: string): Promise<number> {
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: "wa:shop_order:" } } });
  const mine: string[] = [];
  for (const r of rows) {
    if (!r.key.includes("shop-mock-")) continue;
    try {
      const o = JSON.parse(r.value) as { tenantId?: string };
      if (o.tenantId === tenantId) mine.push(r.key);
    } catch {
      /* abaikan baris rusak */
    }
  }
  const orderIds = mine.map((k) => k.slice("wa:shop_order:".length));
  if (orderIds.length) await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  if (mine.length) await prisma.appSetting.deleteMany({ where: { key: { in: mine } } });
  const msgs = await prisma.waMessageLog.deleteMany({ where: { tenantId, to: phone } });
  return orderIds.length;
}

async function main() {
  const arg = parseArgs(process.argv.slice(2));
  const tenant = await pickTenant(arg.tenant);
  if ((process.env.MIDTRANS_ENV ?? "sandbox") === "production") {
    console.warn("⚠ MIDTRANS_ENV=production — QRIS asli TIDAK dibuat, pakai --no-qr atau jalankan di sandbox.");
  }
  if (arg.reset) {
    const n = await resetMock(tenant.id, arg.phone);
    console.log(`Reset: ${n} pesanan mock + chat ${arg.phone} dihapus.`);
  }

  const ownerRow = await prisma.appSetting.findUnique({ where: { key: `wa:owner_phone:${tenant.id}` } });
  if (!ownerRow?.value) console.warn("ℹ wa:owner_phone belum diatur — notifikasi ke pemilik akan dilewati saat settle.");
  const shopAi = await prisma.appSetting.findUnique({ where: { key: `wa:shop_ai:${tenant.id}` } });
  if (shopAi?.value !== "1") console.warn("ℹ wa:shop_ai belum aktif — AI penjaga toko tidak akan membalas pembeli.");

  let source = "daftar contoh lokal";
  let products: Product[] | null = null;
  if (!arg.fakeItems) {
    try {
      products = await productsFromAccurate(tenant.id, arg.items);
      if (products) source = `Accurate ${tenant.name}`;
    } catch (e) {
      console.warn("ℹ gagal membaca produk Accurate:", e instanceof Error ? e.message.slice(0, 160) : e);
    }
  }
  if (!products) products = PRODUCTS.slice(0, 2);
  const items = products.slice(0, 2);
  const lines = items.map((p) => {
    const qty = Math.max(1, Math.min(arg.qty, p.stock > 0 ? p.stock : arg.qty));
    return {
      name: p.name,
      no: p.no,
      qty,
      price: p.price,
      subtotal: p.price * qty,
      stock: p.stock,
    };
  });
  const total = lines.reduce((a, l) => a + l.subtotal, 0);

  const orderId = `shop-mock-${randomBytes(6).toString("hex")}`;
  await prisma.payment.create({
    data: { tenantId: tenant.id, orderId, amount: total, status: arg.paid ? "settlement" : "pending" },
  });

  let qrUrl = "";
  let qrSource = "tanpa gambar";
  if (!arg.noQr && isBillingEnabled() && midtransSnapReady()) {
    try {
      const qr = await generateQrMpm(orderId, total);
      qrUrl = qr.qrUrl;
      qrSource = `QRIS asli (${process.env.MIDTRANS_ENV ?? "sandbox"}, berlaku s.d. ${qr.expiredAt})`;
    } catch (e) {
      console.warn("ℹ generateQrMpm gagal:", e instanceof Error ? e.message.slice(0, 160) : e);
    }
  }
  if (!qrUrl && !arg.noQr) {
    qrUrl = fakeQrDataUri(orderId);
    qrSource = "QR gambar palsu (data URI) — tak bisa dipindai";
  }

  const createdAt = new Date(Date.now() - 4 * 60_000);
  const order: ShopOrder = {
    orderId,
    tenantId: tenant.id,
    buyerPhone: arg.phone,
    buyerName: "Budi (mock)",
    items: lines,
    total,
    status: arg.paid ? "paid" : "pending",
    qrUrl,
    qrContent: "00020101021126610014COM.GO-JEK.WWW01189360091432507175720210",
    expiresAt: new Date(createdAt.getTime() + 15 * 60_000).toISOString(),
    createdAt: createdAt.toISOString(),
  };
  await saveShopOrder(order);

  const prod = items[0]!;
  const msgs: Array<{ direction: "in" | "out"; body: string; minutes: number }> = [
    { direction: "in", body: `Halo, ${prod.name.toLowerCase()} masih ada?`, minutes: 7 },
    {
      direction: "out",
      body: `Halo kak! Masih ada. ${prod.name} ${rp(prod.price)}, stok ${prod.stock}. Mau berapa?`,
      minutes: 6,
    },
    { direction: "in", body: `Ambil ${lines[0]?.qty ?? arg.qty} ya`, minutes: 5 },
    {
      direction: "out",
      body: qrUrl
        ? `[image] Pesanan ${orderId} — total ${rp(total)}. Silakan pindai gambar QRIS ini untuk menyelesaikan pembayaran.\n${qrUrl}`
        : `Pesanan ${orderId} — total ${rp(total)}. Silakan lakukan pembayaran QRIS ke nomor toko.`,
      minutes: 4,
    },
    {
      direction: "out",
      body: `Total ${rp(total)} ya kak. Pembayaran diverifikasi otomatis, tidak perlu kirim bukti transfer.`,
      minutes: 3,
    },
  ];
  await prisma.waMessageLog.createMany({
    data: msgs.map((m) => ({
      tenantId: tenant.id,
      to: arg.phone,
      body: m.body,
      direction: m.direction,
      status: m.direction === "in" ? "received" : "sent",
      costCredits: m.direction === "in" ? 0 : 1,
      createdAt: new Date(Date.now() - m.minutes * 60_000),
    })),
  });

  console.log(`
Pesanan mock dibuat
  tenant      : ${tenant.name} (${tenant.alias || tenant.id})
  pembeli     : ${arg.phone} — "Budi (mock)"
  order       : ${orderId}  ${arg.paid ? "LUNAS" : "PENDING"}  total ${rp(total)}
  produk      : ${source}
  item        : ${lines.map((l) => `${l.name} [${l.no || "-"}] x${l.qty} @${rp(l.price)}`).join(", ")}
  QRIS        : ${qrSource || "tanpa gambar"}

Cara uji:
  1. Buka aplikasi → menu WhatsApp → tab/laman "Chat".
  2. Pilih percakapan ${arg.phone}.
  3. Tekan "Tandai lunas (simulasi)" pada kartu pesanan.
  4. Cek status jadi Lunas + notifikasi WA (bila wa:owner_phone terisi).
`);
  await prisma.$disconnect();
}

await main();
