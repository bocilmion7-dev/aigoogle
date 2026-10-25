import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { llmClient } from "../ai/llm-client.js";
import { getModuleModel } from "../ai/module-model.js";
import { assertAiAccess, tenantOwnerId } from "../ai/billing.js";
import { recordLlmUsage } from "../ai/usage.js";
import type { LLMContent, LLMPart } from "../ai/llm-types.js";
import { accurateProvider } from "../providers/accounting/index.js";
import type { ProviderCtx } from "../providers/accounting/types.js";
import { accurateCtxFor } from "../providers/accounting/connection.js";
import { isBillingEnabled } from "../billing/midtrans.js";
import { generateQrMpm, midtransSnapReady } from "../billing/midtrans-snap.js";
import { getWaSettings, sendWaImage, sendWaText } from "./service.js";
import { saveShopOrder, type Fulfillment, type ShopOrderItem, type ShopShipping } from "./shop-order.js";
import { biteshipReady, getRates } from "../shipping/biteship.js";
import { getDefaultWeightGram, getShippingOrigin } from "./shipping-settings.js";

const MAX_ITEMS = 10;
const MAX_QTY = 1000;

/** Hasil pencarian barang (di-cache per giliran agar tak menembak Accurate berulang). */
type ItemLookup = {
  item?: Record<string, unknown>;
  sellingPrice?: number | null;
  stock?: number | null;
  currencyCode?: string;
  alternatives?: Array<Record<string, unknown>>;
  error?: string;
};
type ItemCache = Map<string, ItemLookup>;
const cacheKey = (name: string) => name.trim().toLowerCase();

/** Jalur pengiriman balasan — live: WhatsApp; sandbox: ditangkap tanpa kirim WA. */
export interface ShopTransport {
  text(body: string): Promise<{ ok: boolean; error?: string }>;
  image(url: string, caption: string): Promise<{ ok: boolean; error?: string }>;
}

export interface ShopInboundResult {
  replied: boolean;
  /** alasan bila tidak ada balasan (dipakai halaman sandbox, bukan pesan ke pembeli) */
  reason?: string;
}

const liveTransport = (tenantId: string, to: string): ShopTransport => ({
  text: (body) => sendWaText(tenantId, to, body),
  image: (url, caption) => sendWaImage(tenantId, to, url, caption),
});

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "cariProduk",
        description:
          "Cari produk berdasarkan nama atau kode barang. Mengembalikan harga jual terkini, stok, kode, dan alternatif produk lain. WAJIB dipakai sebelum menyebut harga/stok.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Nama atau kode produk yang ditanyakan pembeli" },
          },
          required: ["query"],
        },
      },
      {
        name: "cekOngkir",
        description:
          "Hitung ongkos kirim dari gudang toko ke kode pos pembeli. Panggil SETELAH pembeli memilih dikirim kurir dan sudah memberi alamat + kode pos. Kembalikan 3 opsi termurah agar pembeli memilih.",
        parameters: {
          type: "object",
          properties: {
            destinationPostalCode: { type: "string", description: "Kode pos tujuan (5 digit)" },
            beratGram: { type: "number", description: "Total berat paket dalam gram (opsional; sistem menghitung sendiri bila kosong)" },
          },
          required: ["destinationPostalCode"],
        },
      },
      {
        name: "buatPesanan",
        description:
          "Buat pesanan dan QRIS pembayaran Midtrans. Nama & nomor HP pembeli WAJIB sudah diketahui. Harga barang diambil ulang dari Accurate. Untuk kirim kurir, pakai kurirCode+layananCode dari hasil cekOngkir.",
        parameters: {
          type: "object",
          properties: {
            namaPembeli: { type: "string", description: "Nama pembeli (WAJIB — tanyakan bila belum diketahui)" },
            noHp: {
              type: "string",
              description: "Nomor HP pembeli WAJIB dikumpulkan (mis. 0812xxxx). Tanyakan bila belum diketahui.",
            },
            fulfillment: {
              type: "string",
              enum: ["pickup", "courier"],
              description: "pickup = ambil sendiri di toko; courier = dikirim via kurir",
            },
            alamat: { type: "string", description: "Alamat lengkap pembeli (wajib bila courier)" },
            kodePos: { type: "string", description: "Kode pos pembeli 5 digit (wajib bila courier)" },
            kurirCode: { type: "string", description: "Kode kurir dari cekOngkir, mis. jne / jnt / sicepat" },
            layananCode: { type: "string", description: "Kode layanan dari cekOngkir, mis. reg / yes / best" },
            catatan: { type: "string", description: "Catatan pengiriman (opsional)" },
            items: {
              type: "array",
              maxItems: MAX_ITEMS,
              items: {
                type: "object",
                properties: {
                  nama: { type: "string", description: "Nama/kode produk" },
                  qty: { type: "number", description: "Jumlah yang dipesan" },
                },
                required: ["nama", "qty"],
              },
            },
          },
          required: ["fulfillment", "items", "namaPembeli", "noHp"],
        },
      },
    ],
  },
];

function rupiah(n: number): string {
  return `Rp${Math.round(n).toLocaleString("id-ID")}`;
}

interface OrderResult {
  orderId: string;
  totalText: string;
  itemsSubtotalText: string;
  shippingFeeText: string;
  fulfillment: string;
  shipping: { courierName?: string; serviceName?: string } | null;
}

/** Caption QRIS cadangan — dipakai saat pesanan dibuat tanpa perlu 1 putaran LLM lagi. */
function qrCaptionFromOrder(o: OrderResult | null): string {
  if (!o) return "Silakan pindai gambar QRIS berikut untuk menyelesaikan pembayaran pesanan Anda.";
  const ship =
    o.fulfillment === "courier" && o.shipping
      ? ` (barang ${o.itemsSubtotalText} + ongkir ${o.shippingFeeText} via ${o.shipping.courierName ?? "kurir"} ${
          o.shipping.serviceName ?? ""
        })`.replace(/\s+\)/g, ")")
      : "";
  return `Total ${o.totalText} ya kak${ship}. Silakan pindai gambar QRIS berikut untuk menyelesaikan pembayaran.`;
}

function buildSystem(tenantName: string): string {
  return `Anda adalah AI penjaga toko WhatsApp untuk ${tenantName}.
Tugas: menjawab pertanyaan pembeli tentang produk dan membuatkan pesanan/pembayaran QRIS.
Aturan:
- Bahasa Indonesia yang ramah, singkat, jelas, maksimal ±500 karakter.
- HANYA bahas produk dan pesanan toko. Pertanyaan lain diarahkan kembali dengan sopan.
- WAJIB panggil cariProduk sebelum menyebut harga atau stok. JANGAN mengarang harga, stok, atau kode barang.
- WAJIB mencatat NAMA dan NOMOR HP pembeli sebelum membuat pesanan (dua data wajib). Bila pembeli belum memberikan salah satunya, tanyakan dulu dengan sopan — JANGAN panggil buatPesanan sebelum nama dan nomor HP diketahui. Bila sudah disebut di percakapan, pakai langsung.
- Bila produk tidak ditemukan, tawarkan alternatif yang dikembalikan tool.
- Sebelum buatPesanan, pastikan nama produk dan jumlah sudah jelas. Bila ambigu, tanya dulu.
- Bila pembeli SUDAH menyebut produk + jumlah (dan cara kirim/kode pos bila perlu), panggil beberapa tool SEKALIGUS dalam satu balasan (mis. cariProduk + buatPesanan, atau cekOngkir + cariProduk) supaya cepat — server tetap memvalidasi harga/stok sendiri.
- WAJIB tanya cara penerimaan: "dikirim lewat kurir atau ambil sendiri di toko?" sebelum membuat pesanan.
- Bila pembeli memilih KURIR: minta alamat lengkap + kode pos (5 digit), panggil cekOngkir, lalu tawarkan 3 opsi termurah (kurir, layanan, ongkir, estimasi). Setelah pembeli memilih, panggil buatPesanan dengan fulfillment "courier", alamat, kodePos, kurirCode, layananCode dari opsi itu. JANGAN mengarang ongkir.
- Bila pembeli memilih AMBIL SENDIRI: panggil buatPesanan dengan fulfillment "pickup".
- Setelah buatPesanan, sampaikan total (termasuk ongkir bila kurir) dan minta pembeli memindai GAMBAR QRIS yang dikirim sistem. JANGAN menuliskan URL/link QRIS mentah dan JANGAN bilang sudah dibayar — pembayaran diverifikasi otomatis.
- Jangan meminta data sensitif (password, OTP, kartu). Jangan memakai tabel/markdown; ini percakapan WhatsApp biasa.`;
}

async function searchProduct(ctx: ProviderCtx, query: string, cache?: ItemCache): Promise<unknown> {
  const q = query.trim();
  if (!q) return { found: false, message: "Nama produk kosong." };
  const key = cacheKey(q);
  const provider = accurateProvider();
  const res =
    cache?.get(key) ??
    ((await provider.execute("item.byName", { name: q }, ctx)) as ItemLookup);
  if (res?.item) cache?.set(cacheKey(String(res.item.name ?? q)), res);
  cache?.set(key, res);
  if (res?.error || !res?.item) return { found: false, message: res?.error ?? `Produk "${q}" tidak ditemukan.` };
  const item = res.item;
  return {
    found: true,
    no: String(item.no ?? ""),
    name: String(item.name ?? ""),
    price: typeof res.sellingPrice === "number" ? res.sellingPrice : null,
    stock: typeof res.stock === "number" ? res.stock : null,
    currency: res.currencyCode ?? "IDR",
    alternatives: (res.alternatives ?? []).slice(0, 5).map((a) => ({
      no: String(a.no ?? ""),
      name: String(a.name ?? ""),
    })),
  };
}

/** Cek ongkir Biteship dari gudang toko ke kode pos pembeli (3-6 opsi termurah). */
async function checkShipping(tenantId: string, destPostal: string, beratGram?: number): Promise<unknown> {
  if (!biteshipReady()) {
    return { error: "Ongkos kirim belum aktif di platform. Tawarkan pembeli ambil sendiri di toko." };
  }
  const postal = String(destPostal ?? "").replace(/\D/g, "");
  if (!/^\d{5}$/.test(postal)) {
    return { error: "Kode pos tujuan harus 5 digit. Minta pembeli mengonfirmasi kode posnya." };
  }
  const origin = await getShippingOrigin(tenantId);
  if (!origin.postalCode) {
    return { error: "Alamat asal pengiriman toko belum diatur admin — pengiriman kurir belum tersedia." };
  }
  const weight =
    Number.isFinite(Number(beratGram)) && Number(beratGram) > 0
      ? Math.min(50_000, Math.round(Number(beratGram)))
      : await getDefaultWeightGram();
  let rates;
  try {
    rates = await getRates({
      originPostalCode: origin.postalCode,
      destinationPostalCode: postal,
      items: [{ name: "Paket pesanan", value: 1, quantity: 1, weight }],
    });
  } catch (e) {
    return { error: `Gagal cek ongkir: ${e instanceof Error ? e.message.slice(0, 160) : "error"}` };
  }
  if (!rates.length) return { error: `Tidak ada layanan kurir untuk kode pos ${postal}. Tawarkan ambil sendiri di toko.` };
  const options = rates
    .slice()
    .sort((a, b) => a.price - b.price)
    .slice(0, 6)
    .map((r) => ({
      kurirCode: r.courierCode,
      layananCode: r.serviceCode,
      kurir: r.courierName,
      layanan: r.serviceName,
      ongkir: r.price,
      ongkirText: rupiah(r.price),
      estimasi: r.duration,
    }));
  return {
    destinationPostalCode: postal,
    weightGram: weight,
    options,
    note: "Sampaikan hanya opsi ini (3 termurah). Jangan mengarang ongkir. Setelah pembeli memilih, pakai kurirCode+layananCode-nya di buatPesanan.",
  };
}

async function createOrder(opts: {
  tenantId: string;
  buyerPhone: string;
  ctx: ProviderCtx;
  items: Array<{ nama: string; qty: number }>;
  buyerName: string;
  /** nomor HP yang dikumpulkan AI dari pembeli — wajib */
  contactPhone: string;
  fulfillment: Fulfillment;
  address?: string;
  postalCode?: string;
  courierCode?: string;
  serviceCode?: string;
  note?: string;
  /** cache pencarian barang dari tool sebelumnya pada giliran yang sama */
  cache?: ItemCache;
}): Promise<unknown> {
  if (!isBillingEnabled() || !midtransSnapReady()) {
    return { error: "Pembayaran QRIS belum aktif di platform. Pesanan tidak bisa dibuat sekarang." };
  }
  const settings = await getWaSettings(opts.tenantId);
  if (!settings.ownerPhone) {
    return { error: "Nomor pemilik toko belum diatur, pesanan belum bisa dibuat." };
  }
  const raw = Array.isArray(opts.items) ? opts.items.slice(0, MAX_ITEMS) : [];
  if (!raw.length) return { error: "Daftar pesanan kosong." };
  // nama & nomor HP pembeli = data wajib; bila belum ada, AI diminta menanyakan dulu
  const buyerName = String(opts.buyerName ?? "").trim();
  const contactPhone = String(opts.contactPhone ?? "").replace(/\D/g, "");
  if (!buyerName || !/^\d{8,16}$/.test(contactPhone)) {
    return {
      error:
        "Nama dan nomor HP pembeli wajib diketahui. JANGAN buat pesanan sekarang — tanyakan dulu nama dan nomor HP pembeli dengan sopan.",
    };
  }

  const provider = accurateProvider();
  // semua barang dicari PARALEL (dan pakai cache dari cariProduk) → hemat ratusan ms
  const resolved = await Promise.all(
    raw.map(async (it) => {
      const name = String(it?.nama ?? "").trim();
      const qty = Math.min(MAX_QTY, Math.max(1, Math.round(Number(it?.qty) || 0)));
      if (!name || qty < 1) return null;
      const key = cacheKey(name);
      const cached = opts.cache?.get(key);
      const res = cached ?? ((await provider.execute("item.byName", { name }, opts.ctx)) as ItemLookup);
      if (!cached && res?.item) opts.cache?.set(cacheKey(String(res.item.name ?? name)), res);
      return { name, qty, res };
    })
  );
  const lines: ShopOrderItem[] = [];
  for (const r of resolved) {
    if (!r) continue;
    const { name, qty, res } = r;
    if (!res?.item) return { error: `Produk "${name}" tidak ditemukan.` };
    const price = Number(res.sellingPrice);
    if (!Number.isFinite(price) || price <= 0) {
      return { error: `Harga produk "${String(res.item.name ?? name)}" belum tersedia.` };
    }
    if (typeof res.stock === "number" && res.stock >= 0 && qty > res.stock) {
      return { error: `Stok ${String(res.item.name ?? name)} tersisa ${res.stock}.` };
    }
    lines.push({
      name: String(res.item.name ?? name),
      no: String(res.item.no ?? ""),
      qty,
      price,
      subtotal: price * qty,
      stock: typeof res.stock === "number" ? res.stock : null,
    });
  }
  if (!lines.length) return { error: "Tidak ada item valid untuk dipesan." };
  const itemsSubtotal = lines.reduce((a, l) => a + l.subtotal, 0);
  if (itemsSubtotal <= 0) return { error: "Total pesanan tidak valid." };

  // ── pengiriman: ambil sendiri (default) atau kurir via Biteship ──
  const fulfillment: Fulfillment = opts.fulfillment === "courier" ? "courier" : "pickup";
  let shipping: ShopShipping | undefined;
  let shippingFee = 0;
  if (fulfillment === "courier") {
    const address = String(opts.address ?? "").trim();
    const postal = String(opts.postalCode ?? "").replace(/\D/g, "");
    if (address.length < 10) {
      return { error: "Alamat pengiriman belum lengkap. Minta pembeli menulis alamat lengkap (jalan, nomor, kelurahan, kota)." };
    }
    if (!/^\d{5}$/.test(postal)) {
      return { error: "Kode pos pengiriman harus 5 digit. Minta pembeli mengonfirmasi kode posnya." };
    }
    if (!biteshipReady()) return { error: "Ongkos kirim belum aktif di platform. Arahkan pembeli untuk ambil sendiri di toko." };
    const origin = await getShippingOrigin(opts.tenantId);
    if (!origin.postalCode || !origin.address || !origin.phone) {
      return { error: "Alamat asal pengiriman toko belum diatur admin, pengiriman kurir belum bisa dipakai." };
    }
    const weight = await getDefaultWeightGram();
    const weightGram = lines.reduce((a, l) => a + l.qty * weight, 0);
    const rates = await getRates({
      originPostalCode: origin.postalCode,
      destinationPostalCode: postal,
      items: lines.map((l) => ({ name: l.name, value: l.price, quantity: l.qty, weight })),
    }).catch((e) => {
      throw new Error(`Gagal cek ongkir: ${e instanceof Error ? e.message.slice(0, 160) : "error"}`);
    });
    const wantCourier = String(opts.courierCode ?? "").toLowerCase();
    const wantService = String(opts.serviceCode ?? "").toLowerCase();
    const rate = rates.find(
      (r) => r.courierCode.toLowerCase() === wantCourier && r.serviceCode.toLowerCase() === wantService
    );
    if (!rate) {
      return {
        error:
          `Layanan ${opts.courierCode ?? "-"}/${opts.serviceCode ?? "-"} tidak tersedia untuk kode pos ${postal}. ` +
          `Panggil cekOngkir lagi dan minta pembeli memilih dari daftar.`,
      };
    }
    shippingFee = rate.price;
    shipping = {
      destinationAddress: address.slice(0, 300),
      destinationPostalCode: postal,
      destinationNote: String(opts.note ?? "").slice(0, 200),
      courierName: rate.courierName,
      courierCode: rate.courierCode,
      serviceName: rate.serviceName,
      serviceCode: rate.serviceCode,
      price: rate.price,
      duration: rate.duration,
      weightGram,
    };
  }
  const total = itemsSubtotal + shippingFee;

  const orderId = `shop-${randomBytes(6).toString("hex")}`;
  await prisma.payment.create({
    data: { tenantId: opts.tenantId, orderId, amount: total, status: "pending" },
  });
  try {
    const qr = await generateQrMpm(orderId, total);
    await prisma.payment.update({
      where: { orderId },
      data: { paymentMethod: "qris", fraudStatus: qr.referenceNo },
    });
    await saveShopOrder({
      orderId,
      tenantId: opts.tenantId,
      buyerPhone: opts.buyerPhone,
      buyerName: buyerName.slice(0, 100),
      buyerContactPhone: contactPhone.slice(0, 16),
      items: lines,
      fulfillment,
      itemsSubtotal,
      ...(shipping ? { shipping } : {}),
      total,
      status: "pending",
      qrUrl: qr.qrUrl,
      qrContent: qr.qrContent,
      expiresAt: qr.expiredAt,
      createdAt: new Date().toISOString(),
    });
    return {
      orderId,
      fulfillment,
      total,
      totalText: rupiah(total),
      itemsSubtotal,
      itemsSubtotalText: rupiah(itemsSubtotal),
      shippingFee,
      shippingFeeText: rupiah(shippingFee),
      shipping: shipping
        ? {
            courierName: shipping.courierName,
            serviceName: shipping.serviceName,
            duration: shipping.duration,
            postalCode: shipping.destinationPostalCode,
          }
        : null,
      items: lines.map((l) => ({ name: l.name, qty: l.qty, subtotal: l.subtotal })),
      qrUrl: qr.qrUrl,
      expiredAt: qr.expiredAt,
      instructions: "Kirim tautan QRIS ini ke pembeli agar ia menyelesaikan pembayaran.",
    };
  } catch (e) {
    return { error: `Gagal membuat QRIS: ${e instanceof Error ? e.message.slice(0, 120) : "error"}` };
  }
}

export async function handleShopInbound(opts: {
  tenantId: string;
  from: string;
  text: string;
  /** kosong = kirim WhatsApp sungguhan; sandbox mengirim transport penangkap */
  transport?: ShopTransport;
}): Promise<ShopInboundResult> {
  const transport = opts.transport ?? liveTransport(opts.tenantId, opts.from);
  const startedAt = performance.now();
  const timings = { steps: 0, llmMs: 0, toolMs: 0 };
  const cache: ItemCache = new Map();
  const finish = (r: ShopInboundResult): ShopInboundResult => {
    console.info(
      "[shop-ai] timing",
      JSON.stringify({
        ...timings,
        totalMs: Math.round(performance.now() - startedAt),
        replied: r.replied,
        reason: r.reason ?? null,
      })
    );
    return r;
  };

  const settings = await getWaSettings(opts.tenantId);
  if (!settings.shopAi) return finish({ replied: false, reason: "shop_ai_nonaktif" });
  // anti-spam: maksimal 15 pesan masuk / menit per pembeli
  const recentCount = await prisma.waMessageLog.count({
    where: {
      tenantId: opts.tenantId,
      to: opts.from,
      direction: "in",
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
  });
  if (recentCount > 15) return finish({ replied: false, reason: "anti_spam" });

  const ownerId = await tenantOwnerId(opts.tenantId);
  if (!ownerId) return finish({ replied: false, reason: "tenant_tanpa_owner" });
  try {
    await assertAiAccess(ownerId, opts.tenantId);
  } catch {
    return finish({ replied: false, reason: "kuota_ai_habis" }); // langganan/token habis → jangan balas otomatis
  }
  const ctx = await accurateCtxFor(opts.tenantId);
  if (!ctx) return finish({ replied: false, reason: "accurate_belum_terhubung" });

  const tenant = await prisma.tenant.findUnique({ where: { id: opts.tenantId }, select: { name: true } });
  const rows = await prisma.waMessageLog.findMany({
    where: { tenantId: opts.tenantId, to: opts.from },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { direction: true, body: true },
  });
  const history: LLMContent[] = rows
    .reverse()
    .map((r) => ({
      role: (r.direction === "in" ? "user" : "model") as "user" | "model",
      parts: [{ text: r.body.slice(0, 400) }],
    }))
    .filter((c) => c.parts[0]?.text?.trim());
  // pesan masuk saat ini sudah tercatat — jangan dobel
  if (history.at(-1)?.role === "user" && history.at(-1)?.parts[0]?.text === opts.text) history.pop();
  history.push({ role: "user", parts: [{ text: opts.text.slice(0, 2000) }] });

  const system = buildSystem(tenant?.name ?? "toko ini");
  const model = (await getModuleModel("chat")) || undefined;
  const client = llmClient();
  const contents: LLMContent[] = [...history];
  let reply = "";
  let createdQrUrl: string | null = null;
  let createdOrder: OrderResult | null = null;
  try {
    for (let step = 0; step < 4; step++) {
      const promptChars = JSON.stringify(contents).length;
      const llmStart = performance.now();
      const { parts } = await client.generate({ contents, tools: TOOLS, system, model });
      timings.llmMs += performance.now() - llmStart;
      timings.steps += 1;
      const text = parts
        .filter((p: LLMPart) => p.text && !p.thought)
        .map((p: LLMPart) => p.text!.trim())
        .filter(Boolean)
        .join("\n")
        .trim();
      const calls = parts.filter((p: LLMPart) => p.functionCall);
      if (text) reply = text;
      void recordLlmUsage({
        tenantId: opts.tenantId,
        kind: "chat",
        model: model ?? "default",
        userId: ownerId,
        promptChars,
        completionChars: text.length + JSON.stringify(parts).length,
      });
      if (!calls.length) break;
      contents.push({ role: "model", parts });
      const toolStart = performance.now();
      for (const call of calls) {
        const fc = call.functionCall!;
        let result: unknown;
        try {
          if (fc.name === "cariProduk") {
            result = await searchProduct(ctx, String((fc.args as { query?: unknown })?.query ?? ""), cache);
          } else if (fc.name === "cekOngkir") {
            const a = fc.args as { destinationPostalCode?: unknown; beratGram?: unknown } | undefined;
            result = await checkShipping(
              opts.tenantId,
              String(a?.destinationPostalCode ?? ""),
              Number(a?.beratGram)
            );
          } else if (fc.name === "buatPesanan") {
            const a = (fc.args ?? {}) as {
              items?: Array<{ nama: string; qty: number }>;
              namaPembeli?: string;
              noHp?: string;
              fulfillment?: string;
              alamat?: string;
              kodePos?: string;
              kurirCode?: string;
              layananCode?: string;
              catatan?: string;
            };
            result = await createOrder({
              tenantId: opts.tenantId,
              buyerPhone: opts.from,
              ctx,
              items: Array.isArray(a.items) ? a.items : [],
              buyerName: String(a.namaPembeli ?? ""),
              contactPhone: String(a.noHp ?? ""),
              fulfillment: a.fulfillment === "courier" ? "courier" : "pickup",
              address: a.alamat,
              postalCode: a.kodePos,
              courierCode: a.kurirCode,
              serviceCode: a.layananCode,
              note: a.catatan,
              cache,
            });
            if (result && typeof result === "object" && typeof (result as { qrUrl?: unknown }).qrUrl === "string") {
              createdQrUrl = String((result as { qrUrl: string }).qrUrl);
              createdOrder = result as OrderResult;
            }
          } else {
            result = { error: "Tool tidak dikenal." };
          }
        } catch (e) {
          result = { error: e instanceof Error ? e.message.slice(0, 200) : "Gagal menjalankan tool." };
        }
        contents.push({
          role: "user",
          parts: [{ functionResponse: { name: fc.name, response: result, id: fc.id } }],
        });
      }
      timings.toolMs += performance.now() - toolStart;
      // QRIS sudah terbit → balasan bisa langsung disusun dari data pesanan
      // (hemat satu putaran LLM ±3-5 dtk). Pertanyaan biasa tetap pakai LLM.
      if (createdQrUrl) break;
      reply = ""; // tunggu jawaban final setelah hasil tool
    }
  } catch (e) {
    console.warn("[shop-ai] LLM gagal:", e instanceof Error ? e.message.slice(0, 200) : e);
    return finish({ replied: false, reason: "llm_gagal" });
  }

  if (!reply.trim() && !createdQrUrl) return finish({ replied: false, reason: "tanpa_balasan" });
  if (createdQrUrl) {
    // caption selalu dari data pesanan (bukan teks antara model) → konsisten & tidak
    // memuat kalimat "tunggu sebentar"/"maaf" yang keluar bersamaan dengan tool call
    const caption = qrCaptionFromOrder(createdOrder);
    const sent = await transport.image(createdQrUrl, caption);
    if (!sent.ok) {
      await transport
        .text("Maaf, gambar QRIS gagal dikirim. Silakan hubungi admin toko untuk menyelesaikan pembayaran.")
        .catch(() => null);
    }
    return finish({ replied: true });
  }
  await transport.text(reply.slice(0, 1500));
  return finish({ replied: true });
}
