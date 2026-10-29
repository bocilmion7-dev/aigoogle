import express, { Router } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { requirePerm } from "../permissions.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { writeAudit } from "../audit.js";
import { tenantOwnerId, assertAiAccess, AiLanggananHabis, AiSaldoHabis } from "../ai/billing.js";
import { sendPushToUser } from "../push.js";
import { llmClient } from "../ai/llm-client.js";
import { getModuleModel } from "../ai/module-model.js";
import { recordLlmUsage } from "../ai/usage.js";
import { accurateProvider } from "../providers/accounting/index.js";
import { accurateCtxFor } from "../providers/accounting/connection.js";
import type { ProviderCtx } from "../providers/accounting/types.js";
import type { ListResult } from "../providers/accounting/accurate.js";
import { getWaSettings } from "../wa/service.js";
import { saveShopOrder, getShopOrder, listShopOrders, type ShopOrder, type ShopOrderItem, type ShopShipping } from "../wa/shop-order.js";
import { getDefaultWeightGram, getShippingOrigin } from "../wa/shipping-settings.js";
import { biteshipReady, getRates, track, type RateOption } from "../shipping/biteship.js";
import { generateQrMpm, midtransSnapReady } from "../billing/midtrans-snap.js";

export const storefrontRouter = Router();
const execFileAsync = promisify(execFile);
const WATERMARK_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

const MODES = ["product", "service"] as const;
type Mode = (typeof MODES)[number];
const TEMPLATES: Record<Mode, string[]> = {
  product: ["product-1", "product-2", "product-3", "product-4"],
  service: ["service-1", "service-2", "service-3", "service-4"],
};
const THEMES = ["warm", "forest", "ocean", "mono", "berry", "sunset"] as const;

const RESERVED_SLUGS = new Set([
  "app", "login", "logout", "admin", "api", "t", "toko", "template", "produk", "pesanan",
  "whatsapp", "wa-chats", "settings", "akun", "ai", "ai-models", "explore", "analisa",
  "insight", "dokumentasi", "panduan", "refund", "platform", "2fa", "otp", "reset",
  "reset-password", "forgot-password", "lacak", "sandbox", "pelanggan", "aktivitas",
  "assets", "fonts", "uploads", "sw.js", "manifest.webmanifest", "storefront",
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const normalizeSlug = (raw: string) => raw.trim().toLowerCase();
const slugProblem = (slug: string): string | null => {
  if (!slug) return "Slug wajib diisi.";
  if (!SLUG_RE.test(slug)) return "Slug 3–40 karakter: huruf kecil, angka, dan tanda hubung.";
  if (RESERVED_SLUGS.has(slug)) return "Slug ini dipakai sistem.";
  return null;
};

function randomSlug(): string {
  return `toko-${randomBytes(4).toString("hex")}`;
}

async function uniqueSlug(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const slug = randomSlug();
    if (!(await prisma.storefront.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  return `toko-${randomBytes(8).toString("hex")}`;
}

async function getOrCreateStorefront(tenantId: string) {
  const existing = await prisma.storefront.findUnique({ where: { tenantId } });
  if (existing) return existing;
  return prisma.storefront.create({
    data: { tenantId, slug: await uniqueSlug(), mode: "product", template: "product-1" },
  });
}

function cleanPhone(raw: string): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0")) d = `62${d.slice(1)}`;
  else if (d.startsWith("8")) d = `62${d}`;
  else if (!d.startsWith("62")) d = `62${d}`;
  return d.slice(0, 16);
}

async function adminSnapshot(tenantId: string) {
  const sf = await getOrCreateStorefront(tenantId);
  const ownerPhone = sf.whatsapp ? "" : (await getWaSettings(tenantId)).ownerPhone;
  return {
    slug: sf.slug,
    mode: sf.mode as Mode,
    template: sf.template,
    theme: sf.theme,
    bannerUrl: sf.bannerUrl,
    logoUrl: sf.logoUrl,
    tagline: sf.tagline,
    description: sf.description,
    whatsapp: sf.whatsapp || ownerPhone,
    active: sf.active,
    publicUrl: env.STORE_BASE_DOMAIN
      ? `https://${sf.slug}.${env.STORE_BASE_DOMAIN.replace(/^\.+|\.+$/g, "")}`
      : `${env.APP_ORIGIN}/t/${sf.slug}`,
    templates: TEMPLATES,
    productsSyncedAt: sf.productsSyncedAt?.toISOString() ?? null,
  };
}

const Admin = [requireUser, requirePerm("app:users.manage")];

storefrontRouter.get(
  "/storefront",
  ...Admin,
  asyncHandler(async (req, res) => {
    res.json(await adminSnapshot(req.user!.tenant.id));
  })
);

const SettingsBody = z.object({
  slug: z.string().max(80).optional(),
  mode: z.enum(MODES).optional(),
  template: z.string().max(40).optional(),
  theme: z.enum(THEMES).optional(),
  bannerUrl: z.string().max(500).optional(),
  logoUrl: z.string().max(500).optional(),
  tagline: z.string().max(140).optional(),
  description: z.string().max(1200).optional(),
  whatsapp: z.string().max(32).optional(),
  active: z.boolean().optional(),
});

storefrontRouter.put(
  "/storefront",
  ...Admin,
  asyncHandler(async (req, res) => {
    const body = SettingsBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request", issues: body.error.issues });
    const tenantId = req.user!.tenant.id;
    const sf = await getOrCreateStorefront(tenantId);
    const data: Record<string, unknown> = {};
    const mode = (body.data.mode ?? sf.mode) as Mode;
    const template = body.data.template ?? sf.template;
    if (!TEMPLATES[mode].includes(template)) {
      return res.status(400).json({ error: "template_tidak_valid", message: "Template tidak sesuai jenis storefront." });
    }
    if (body.data.slug !== undefined) {
      const slug = normalizeSlug(body.data.slug);
      const problem = slugProblem(slug);
      if (problem) return res.status(400).json({ error: "slug_tidak_valid", message: problem });
      if (slug !== sf.slug) {
        const used = await prisma.storefront.findUnique({ where: { slug }, select: { tenantId: true } });
        if (used && used.tenantId !== tenantId) {
          return res.status(409).json({ error: "slug_dipakai", message: "Slug sudah dipakai perusahaan lain." });
        }
      }
      data.slug = slug;
    }
    data.mode = mode;
    data.template = template;
    if (body.data.theme !== undefined) data.theme = body.data.theme;
    if (body.data.bannerUrl !== undefined) data.bannerUrl = body.data.bannerUrl.trim();
    if (body.data.logoUrl !== undefined) data.logoUrl = body.data.logoUrl.trim();
    if (body.data.tagline !== undefined) data.tagline = body.data.tagline.trim();
    if (body.data.description !== undefined) data.description = body.data.description.trim();
    if (body.data.whatsapp !== undefined) data.whatsapp = body.data.whatsapp.replace(/[^\d+]/g, "").slice(0, 32);
    if (body.data.active !== undefined) data.active = body.data.active;
    await prisma.storefront.update({ where: { tenantId }, data });
    await writeAudit(tenantId, req.user!.id, "storefront.update", {
      slug: data.slug ?? sf.slug,
      mode,
      template,
      theme: data.theme ?? sf.theme,
      active: body.data.active ?? sf.active,
    });
    res.json(await adminSnapshot(tenantId));
  })
);

storefrontRouter.get(
  "/storefront/slug",
  ...Admin,
  asyncHandler(async (req, res) => {
    const slug = normalizeSlug(String(req.query.slug ?? ""));
    const problem = slugProblem(slug);
    if (problem) return res.json({ slug, available: false, reason: problem });
    const sf = await prisma.storefront.findUnique({ where: { slug }, select: { tenantId: true } });
    const available = !sf || sf.tenantId === req.user!.tenant.id;
    return res.json({
      slug,
      available,
      reason: available ? null : "Slug sudah dipakai perusahaan lain.",
    });
  })
);

type ItemRow = { id?: unknown; no?: unknown; name?: unknown; quantity?: unknown; sellingPrice?: unknown; price?: unknown };

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

async function listAccurateItems(provider: ReturnType<typeof accurateProvider>, ctx: ProviderCtx) {
  const rows: ItemRow[] = [];
  let total = 0;
  for (let page = 1; page <= 10; page++) {
    const r = (await provider.execute(
      "item.list",
      { page, pageSize: 100, fields: "id,no,name,quantity,sellingPrice,price" },
      ctx
    )) as ListResult;
    const items = Array.isArray(r.items) ? (r.items as ItemRow[]) : [];
    rows.push(...items);
    total = Number(r.total ?? rows.length);
    if (items.length === 0 || rows.length >= total || page >= Number(r.pageCount ?? page)) break;
    if (rows.length >= 500) break;
  }
  return { rows: rows.slice(0, 500), total };
}

async function priceFor(
  provider: ReturnType<typeof accurateProvider>,
  ctx: ProviderCtx,
  row: ItemRow,
  existingPrice: number | null
): Promise<number | null> {
  const inline = numOrNull(row.sellingPrice) ?? numOrNull(row.price);
  if (inline !== null && inline > 0) return inline;
  const no = String(row.no ?? "");
  const priceRes = (await provider.execute("item.get-selling-price", { no }, ctx).catch(() => null)) as unknown;
  const first = (v: unknown): Record<string, unknown> | null => {
    const a = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
    const x = a[0];
    return x && typeof x === "object" ? (x as Record<string, unknown>) : null;
  };
  const p = numOrNull(first(priceRes)?.price);
  if (p !== null && p > 0) return p;
  if (String(row.id ?? "")) {
    const detail = (await provider.execute("item.detail", { id: String(row.id) }, ctx).catch(() => null)) as Record<string, unknown> | null;
    const list = (detail?.detailSellingPrice as Array<Record<string, unknown>> | undefined) ?? [];
    const pick =
      list.find((x) => (x.priceCategory as { defaultCategory?: boolean } | undefined)?.defaultCategory === true && Number(x.price) > 0) ??
      list.find((x) => Number(x.price) > 0);
    const dp = numOrNull(pick?.price);
    if (dp !== null && dp > 0) return dp;
  }
  return existingPrice;
}

storefrontRouter.post(
  "/storefront/products/sync",
  ...Admin,
  asyncHandler(async (req, res) => {
    const tenantId = req.user!.tenant.id;
    const ctx = await accurateCtxFor(tenantId);
    if (!ctx) return res.status(409).json({ error: "belum_connect", message: "Accurate belum terhubung." });
    const provider = accurateProvider();
    const { rows, total } = await listAccurateItems(provider, ctx);
    const existing = await prisma.storefrontProduct.findMany({ where: { tenantId } });
    const byNo = new Map(existing.map((p) => [p.itemNo, p]));
    let created = 0;
    let updated = 0;
    let priced = 0;
    const now = new Date();
    await mapLimit(rows, 6, async (row) => {
      const itemNo = String(row.no ?? "").trim();
      if (!itemNo) return;
      const old = byNo.get(itemNo);
      const name = String(row.name ?? "").trim() || old?.name || itemNo;
      const price = await priceFor(provider, ctx, row, old?.price ?? null);
      const stock = numOrNull(row.quantity) ?? old?.stock ?? null;
      const data = {
        name,
        price,
        stock,
        updatedAt: now,
      };
      await prisma.storefrontProduct.upsert({
        where: { tenantId_itemNo: { tenantId, itemNo } },
        create: { tenantId, itemNo, ...data },
        update: data,
      });
      if (old) updated++;
      else created++;
      if (price !== null && price > 0) priced++;
    });
    await prisma.storefront.update({
      where: { tenantId },
      data: { productsSyncedAt: now },
    });
    res.json({
      ok: true,
      total,
      scanned: rows.length,
      created,
      updated,
      priced,
      truncated: total > rows.length,
      syncedAt: now.toISOString(),
    });
  })
);

storefrontRouter.get(
  "/storefront/products",
  ...Admin,
  asyncHandler(async (req, res) => {
    const tenantId = req.user!.tenant.id;
    const sf = await getOrCreateStorefront(tenantId);
    const products = await prisma.storefrontProduct.findMany({
      where: { tenantId },
      orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
    res.json({
      products: products.map((p) => ({
        id: p.id,
        itemNo: p.itemNo,
        name: p.name,
        title: p.title,
        description: p.description,
        imageUrl: p.imageUrl,
        images: (() => {
          try { return JSON.parse(p.images) as string[]; } catch { return []; }
        })(),
        category: p.category,
        unit: p.unit,
        price: p.price,
        stock: p.stock,
        active: p.active,
        featured: p.featured,
        sortOrder: p.sortOrder,
      })),
      syncedAt: sf.productsSyncedAt?.toISOString() ?? null,
    });
  })
);

storefrontRouter.get(
  "/storefront/products/:id",
  ...Admin,
  asyncHandler(async (req, res) => {
    const tenantId = req.user!.tenant.id;
    const p = await prisma.storefrontProduct.findFirst({
      where: { id: String(req.params.id), tenantId },
    });
    if (!p) return res.status(404).json({ error: "tidak_ditemukan" });
    let images: string[] = [];
    try { images = JSON.parse(p.images) as string[]; } catch { images = []; }
    res.json({ product: { ...p, images } });
  })
);

const ProductBody = z.object({
  title: z.string().max(160).optional(),
  description: z.string().max(2000).optional(),
  imageUrl: z.string().max(500).optional(),
  images: z.array(z.string().max(500)).max(8).optional(),
  category: z.string().max(80).optional(),
  active: z.boolean().optional(),
  featured: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

storefrontRouter.put(
  "/storefront/products/:id",
  ...Admin,
  asyncHandler(async (req, res) => {
    const body = ProductBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request", issues: body.error.issues });
    const tenantId = req.user!.tenant.id;
    const existing = await prisma.storefrontProduct.findFirst({
      where: { id: String(req.params.id), tenantId },
    });
    if (!existing) return res.status(404).json({ error: "tidak_ditemukan" });
    const nextImages = body.data.images
      ? body.data.images.map((u) => u.trim()).filter(Boolean)
      : null;
    const p = await prisma.storefrontProduct.update({
      where: { id: existing.id },
      data: {
        ...(body.data.title !== undefined ? { title: body.data.title.trim() } : {}),
        ...(body.data.description !== undefined ? { description: body.data.description.trim() } : {}),
        ...(nextImages !== null ? { images: JSON.stringify(nextImages), imageUrl: nextImages[0] ?? "" } : {}),
        ...(nextImages === null && body.data.imageUrl !== undefined ? { imageUrl: body.data.imageUrl.trim() } : {}),
        ...(body.data.category !== undefined ? { category: body.data.category.trim() } : {}),
        ...(body.data.active !== undefined ? { active: body.data.active } : {}),
        ...(body.data.featured !== undefined ? { featured: body.data.featured } : {}),
        ...(body.data.sortOrder !== undefined ? { sortOrder: body.data.sortOrder } : {}),
      },
    });
    await writeAudit(tenantId, req.user!.id, "storefront.product_update", { id: p.id, itemNo: p.itemNo });
    let images: string[] = [];
    try { images = JSON.parse(p.images) as string[]; } catch { images = []; }
    res.json({ ok: true, product: { ...p, images } });
  })
);

const AiDescriptionBody = z.object({
  tone: z.enum(["menjual", "informatif", "ringkas"]).optional(),
  keywords: z.string().max(200).optional(),
});

type DescriptionProduct = {
  title: string;
  name: string;
  itemNo: string;
  category: string;
  unit: string;
  price: number | null;
  description: string;
};

function descriptionPrompt(product: DescriptionProduct, tone: string, keywords?: string): string {
  const title = product.title || product.name || product.itemNo;
  const toneRule =
    tone === "informatif"
      ? "Nada informatif, jelas, dan membantu. Fokus pada fakta produk."
      : tone === "ringkas"
        ? "Sangat ringkas: 1 paragraf pendek, maksimal 55 kata."
        : "Nada menjual tetapi tetap jujur dan tidak berlebihan. Buat pembaca ingin membeli.";
  return [
    `Tulis deskripsi produk e-commerce dalam Bahasa Indonesia untuk produk berikut.`,
    `Nama: ${title}`,
    `Kategori: ${product.category || "-"}`,
    `Satuan: ${product.unit || "-"}`,
    `Harga: ${product.price ? `Rp${Math.round(product.price).toLocaleString("id-ID")}` : "belum tersedia"}`,
    `Deskripsi saat ini: ${product.description || "(belum ada)"}`,
    keywords ? `Kata kunci yang ingin ditekankan: ${keywords}` : "",
    `Aturan: ${toneRule} Jangan mengarang spesifikasi, bahan, sertifikasi, atau klaim medis. Jangan pakai markdown, bullet, atau tabel. 2 paragraf pendek maksimal 150 kata.`,
  ].filter(Boolean).join("\n");
}

async function generateDescription(
  product: DescriptionProduct,
  tone: string,
  keywords: string | undefined,
  model: string | undefined
): Promise<{ text: string; promptChars: number; model: string }> {
  const prompt = descriptionPrompt(product, tone, keywords);
  const { parts } = await llmClient().generate({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    system: "Anda copywriter produk untuk toko online Indonesia. Tulis rapi, natural, dan siap tempel. Jangan menambahkan catatan atau pembuka meta.",
    model,
  });
  const text = parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text!.trim())
    .filter(Boolean)
    .join("\n\n")
    .replace(/^["']|["']$/g, "")
    .trim()
    .slice(0, 2500);
  if (!text) throw new Error("AI tidak menghasilkan deskripsi.");
  return { text, promptChars: prompt.length, model: model ?? "default" };
}

function descriptionAccessError(e: unknown): { status: number; body: Record<string, unknown> } | null {
  if (e instanceof AiLanggananHabis) {
    return { status: 402, body: { error: "langganan_ai_habis", message: "Masa langganan/demo AI sudah habis." } };
  }
  if (e instanceof AiSaldoHabis) {
    return { status: 402, body: { error: "saldo_ai_habis", message: "Saldo token AI habis. Lakukan top up terlebih dahulu." } };
  }
  return null;
}

storefrontRouter.post(
  "/storefront/products/:id/ai-description",
  ...Admin,
  asyncHandler(async (req, res) => {
    const body = AiDescriptionBody.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const tenantId = req.user!.tenant.id;
    const product = await prisma.storefrontProduct.findFirst({
      where: { id: String(req.params.id), tenantId },
    });
    if (!product) return res.status(404).json({ error: "tidak_ditemukan" });
    try {
      await assertAiAccess(req.user!.id, tenantId);
    } catch (e) {
      const denied = descriptionAccessError(e);
      if (denied) return res.status(denied.status).json(denied.body);
      throw e;
    }
    const model = (await getModuleModel("chat")) || undefined;
    try {
      const out = await generateDescription(product, body.data.tone ?? "menjual", body.data.keywords, model);
      void recordLlmUsage({
        tenantId,
        kind: "chat",
        model: out.model,
        userId: req.user!.id,
        promptChars: out.promptChars,
        completionChars: out.text.length,
      });
      res.json({ ok: true, description: out.text, model: out.model });
    } catch (e) {
      console.warn("[storefront] ai-description gagal:", e instanceof Error ? e.message.slice(0, 200) : e);
      res.status(502).json({ error: "ai_gagal", message: "Gagal membuat deskripsi. Cek provider AI lalu coba lagi." });
    }
  })
);

const BulkDescriptionBody = z.object({
  scope: z.enum(["empty", "all"]).optional(),
  tone: z.enum(["menjual", "informatif", "ringkas"]).optional(),
  keywords: z.string().max(200).optional(),
  after: z.string().max(64).nullable().optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

storefrontRouter.post(
  "/storefront/products/ai-description-bulk",
  ...Admin,
  rateLimit({ name: "storefront-ai-bulk", windowMs: 60 * 60_000, max: 200 }),
  asyncHandler(async (req, res) => {
    const body = BulkDescriptionBody.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: "bad_request", issues: body.error.issues });
    const tenantId = req.user!.tenant.id;
    const scope = body.data.scope ?? "empty";
    const limit = body.data.limit ?? 10;
    const tone = body.data.tone ?? "menjual";
    try {
      await assertAiAccess(req.user!.id, tenantId);
    } catch (e) {
      const denied = descriptionAccessError(e);
      if (denied) return res.status(denied.status).json(denied.body);
      throw e;
    }
    const where = {
      tenantId,
      ...(scope === "empty" ? { description: "" } : {}),
      ...(body.data.after ? { id: { gt: body.data.after } } : {}),
    };
    const [total, products] = await Promise.all([
      prisma.storefrontProduct.count({
        where: { tenantId, ...(scope === "empty" ? { description: "" } : {}) },
      }),
      prisma.storefrontProduct.findMany({
        where,
        orderBy: { id: "asc" },
        take: limit,
      }),
    ]);
    const model = (await getModuleModel("chat")) || undefined;
    let updated = 0;
    let failed = 0;
    const results: Array<Record<string, unknown>> = [];
    for (const product of products) {
      try {
        const out = await generateDescription(product, tone, body.data.keywords, model);
        await prisma.storefrontProduct.update({
          where: { id: product.id },
          data: { description: out.text.slice(0, 2000) },
        });
        updated++;
        void recordLlmUsage({
          tenantId,
          kind: "chat",
          model: out.model,
          userId: req.user!.id,
          promptChars: out.promptChars,
          completionChars: out.text.length,
        });
        results.push({ id: product.id, title: product.title || product.name, status: "ok" });
      } catch (e) {
        failed++;
        results.push({
          id: product.id,
          title: product.title || product.name,
          status: "error",
          message: e instanceof Error ? e.message.slice(0, 160) : "gagal",
        });
      }
    }
    const nextCursor = products.length ? products[products.length - 1]!.id : body.data.after ?? null;
    const done = products.length < limit;
    await writeAudit(tenantId, req.user!.id, "storefront.ai_descriptions_bulk", {
      scope,
      processed: products.length,
      updated,
      failed,
      done,
    });
    res.json({
      ok: true,
      scope,
      total,
      processed: products.length,
      updated,
      failed,
      nextCursor,
      done,
      results,
    });
  })
);

/**
 * Tiga saran foto produk via image generation publik (Pollinations).
 * Kuota gratis: 1 gambar / 45 detik / IP → stream hasil satu per satu agar
 * pengguna melihat progres, bukan menunggu satu respons besar.
 */
storefrontRouter.post(
  "/storefront/products/:id/ai-images",
  ...Admin,
  rateLimit({ name: "storefront-ai-images", windowMs: 60 * 60_000, max: 20 }),
  asyncHandler(async (req, res) => {
    const tenantId = req.user!.tenant.id;
    const product = await prisma.storefrontProduct.findFirst({
      where: { id: String(req.params.id), tenantId },
    });
    if (!product) return res.status(404).json({ error: "tidak_ditemukan" });
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    const storeName = (tenant?.name || "Toko").replace(/\s+/g, " ").trim().slice(0, 40);
    const subject = [product.title || product.name, product.category ? `kategori ${product.category}` : ""]
      .filter(Boolean)
      .join(", ");
    const detail = (product.description || "").replace(/\s+/g, " ").slice(0, 220);
    const labels = ["Studio", "Lifestyle", "Close-up"];
    const prompts = [
      `Professional e-commerce product photograph of ${subject}. Centered hero shot on a clean neutral background, soft studio lighting, subtle shadow, premium catalog quality, sharp focus. ${detail ? `Product details: ${detail}.` : ""} No text, no logo, no watermark.`,
      `Lifestyle e-commerce photograph of ${subject} in a natural real-world setting, warm daylight, shallow depth of field, authentic premium brand mood, product clearly visible. ${detail ? `Product details: ${detail}.` : ""} No text, no logo, no watermark.`,
      `Close-up macro detail photograph of ${subject}, showing texture and material quality, clean minimal background, soft diffused light, luxury catalog style. ${detail ? `Product details: ${detail}.` : ""} No text, no logo, no watermark.`,
    ];
    const dir = path.join(UPLOAD_ROOT, tenantId);
    await mkdir(dir, { recursive: true });
    const textFile = path.join(tmpdir(), `sf-wm-${randomUUID()}.txt`);
    await writeFile(textFile, storeName, "utf8");

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    let closed = false;
    res.on("close", () => { closed = true; });
    const send = (e: Record<string, unknown>) => {
      if (!closed) res.write(JSON.stringify(e) + "\n");
    };
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const images: Array<{ url: string; prompt: string; label: string }> = [];
    let lastGeneratedAt = 0;

    try {
      send({ type: "start", total: 3, watermark: storeName });
      for (let i = 0; i < prompts.length; i++) {
        if (closed) break;
        // jaga jarak aman dari kuota gratis 1 gambar / 45 detik
        if (lastGeneratedAt) {
          const wait = 47_000 - (Date.now() - lastGeneratedAt);
          if (wait > 0) await sleep(wait);
        }
        if (closed) break;
        const prompt = prompts[i]!;
        const seed = Math.floor(Math.random() * 2_000_000_000);
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=768&seed=${seed}&model=flux&nologo=true`;
        let buf: Buffer | null = null;
        for (let attempt = 0; attempt < 3 && !buf; attempt++) {
          try {
            const r = await fetch(url, { signal: AbortSignal.timeout(65_000) });
            if (r.status === 402) {
              const retry = Math.min(60, Math.max(15, Number(r.headers.get("retry-after") ?? 45) || 45));
              await sleep((retry + 2) * 1000);
              continue;
            }
            if (!r.ok) throw new Error(`image provider ${r.status}`);
            const type = String(r.headers.get("content-type") ?? "");
            if (!type.startsWith("image/")) throw new Error("image provider bukan gambar");
            const b = Buffer.from(await r.arrayBuffer());
            if (b.length < 8_000) throw new Error("gambar terlalu kecil");
            buf = b;
          } catch (e) {
            if (attempt === 2) throw e;
            await sleep(2_000);
          }
        }
        if (!buf) throw new Error(`Gambar ${i + 1} gagal dibuat.`);
        lastGeneratedAt = Date.now();
        const raw = path.join(tmpdir(), `sf-ai-${randomUUID()}.jpg`);
        const out = path.join(dir, `suggest-${randomUUID()}.jpg`);
        await writeFile(raw, buf);
        try {
          await execFileAsync(
            "ffmpeg",
            [
              "-y",
              "-i", raw,
              "-vf",
              `drawtext=fontfile=${WATERMARK_FONT}:textfile=${textFile}:fontcolor=white@0.72:fontsize=24:box=1:boxcolor=black@0.24:boxborderw=10:x=w-tw-18:y=h-th-18`,
              "-frames:v", "1",
              "-q:v", "3",
              out,
            ],
            { timeout: 30_000 }
          );
        } finally {
          await unlink(raw).catch(() => null);
        }
        const item = {
          url: `/api/public/storefront/image/${tenantId}/${path.basename(out)}`,
          prompt,
          label: labels[i] ?? `Saran ${i + 1}`,
        };
        images.push(item);
        send({ type: "image", index: i, ...item });
      }
      if (!closed) {
        if (images.length === 3) send({ type: "done", images, watermark: storeName });
        else send({ type: "error", message: "Gambar belum lengkap. Coba lagi setelah beberapa saat." });
      }
    } catch (e) {
      if (!closed) send({ type: "error", message: e instanceof Error ? e.message : "Gagal membuat gambar." });
    } finally {
      await unlink(textFile).catch(() => null);
      if (!closed) res.end();
    }
  })
);

const UPLOAD_ROOT = path.resolve(process.env.STOREFRONT_UPLOAD_DIR ?? path.join(process.cwd(), "uploads", "storefront"));
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

function imageLooksValid(buf: Buffer, mime: string): boolean {
  if (mime === "image/jpeg") return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === "image/png") return buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/webp") return buf.length > 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP";
  if (mime === "image/gif") return buf.length > 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString("ascii"));
  return false;
}

storefrontRouter.post(
  "/storefront/upload",
  ...Admin,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp", "image/gif"], limit: "6mb" }),
  asyncHandler(async (req, res) => {
    const mime = String(req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const ext = MIME_EXT[mime];
    if (!ext) return res.status(415).json({ error: "format_tidak_didukung" });
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: "file_kosong" });
    if (!imageLooksValid(body, mime)) return res.status(400).json({ error: "file_bukan_gambar" });
    const tenantId = req.user!.tenant.id;
    const dir = path.join(UPLOAD_ROOT, tenantId);
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}.${ext}`;
    await writeFile(path.join(dir, name), body);
    res.json({ url: `/api/public/storefront/image/${tenantId}/${name}` });
  })
);

storefrontRouter.get(
  "/public/storefront/image/:tenantId/:name",
  asyncHandler(async (req, res) => {
    const tenantId = String(req.params.tenantId ?? "");
    const name = String(req.params.name ?? "");
    if (!/^[a-z0-9]+$/i.test(tenantId) || !/^[a-z0-9-]+\.(jpg|png|webp|gif)$/i.test(name)) {
      return res.status(404).end();
    }
    const ext = name.split(".").pop()!.toLowerCase();
    const file = path.join(UPLOAD_ROOT, tenantId, name);
    res.setHeader("Content-Type", EXT_MIME[ext] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.sendFile(file, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  })
);

const SOLD_CACHE = new Map<string, { at: number; counts: Map<string, number> }>();

async function soldCounts(tenantId: string): Promise<Map<string, number>> {
  const hit = SOLD_CACHE.get(tenantId);
  if (hit && Date.now() - hit.at < 60_000) return hit.counts;
  const counts = new Map<string, number>();
  try {
    const orders = await listShopOrders(tenantId, undefined, 500);
    for (const o of orders) {
      if (o.status !== "paid") continue;
      for (const it of o.items) {
        const no = String(it.no ?? "").trim();
        if (!no) continue;
        counts.set(no, (counts.get(no) ?? 0) + Math.max(0, Number(it.qty) || 0));
      }
    }
  } catch {
    /* best seller opsional */
  }
  SOLD_CACHE.set(tenantId, { at: Date.now(), counts });
  if (SOLD_CACHE.size > 300) {
    const first = SOLD_CACHE.keys().next().value;
    if (first) SOLD_CACHE.delete(first);
  }
  return counts;
}

function productPublic(p: {
  id: string; itemNo: string; name: string; title: string; description: string; imageUrl: string; images: string;
  category: string; unit: string; price: number | null; stock: number | null; featured: boolean; sortOrder?: number; createdAt: Date;
}, soldQty = 0) {
  let images: string[] = [];
  try { images = JSON.parse(p.images) as string[]; } catch { images = []; }
  if (!images.length && p.imageUrl) images = [p.imageUrl];
  return {
    id: p.id,
    itemNo: p.itemNo,
    title: p.title || p.name,
    description: p.description,
    imageUrl: images[0] ?? p.imageUrl,
    images,
    category: p.category,
    unit: p.unit,
    price: p.price,
    stock: p.stock,
    featured: p.featured,
    sortOrder: p.sortOrder ?? 0,
    soldQty,
    createdAt: p.createdAt.toISOString(),
  };
}

async function publicStorefront(slugRaw: string, withSales = false) {
  const slug = normalizeSlug(slugRaw);
  const sf = await prisma.storefront.findUnique({
    where: { slug },
    include: { tenant: { select: { name: true, alias: true, id: true } } },
  });
  if (!sf || !sf.active) return null;
  const products = await prisma.storefrontProduct.findMany({
    where: { tenantId: sf.tenantId, active: true },
    orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    take: 500,
  });
  let whatsapp = sf.whatsapp;
  if (!whatsapp) whatsapp = (await getWaSettings(sf.tenantId)).ownerPhone;
  const sold = withSales ? await soldCounts(sf.tenantId) : new Map<string, number>();
  return {
    store: {
      slug: sf.slug,
      companyName: sf.tenant.name || sf.tenant.alias,
      mode: sf.mode as Mode,
      template: sf.template,
      theme: sf.theme,
      bannerUrl: sf.bannerUrl,
      logoUrl: sf.logoUrl,
      tagline: sf.tagline,
      description: sf.description,
      whatsapp: cleanPhone(whatsapp),
      updatedAt: sf.updatedAt.toISOString(),
    },
    products: products.map((p) => productPublic(p, sold.get(p.itemNo) ?? 0)),
  };
}

storefrontRouter.get(
  "/public/storefront/:slug",
  rateLimit({ name: "storefront-public", windowMs: 60_000, max: 120 }),
  asyncHandler(async (req, res) => {
    const data = await publicStorefront(String(req.params.slug ?? ""), true);
    if (!data) return res.status(404).json({ error: "tidak_ditemukan" });
    res.json(data);
  })
);

type OrderInputItem = { id: string; qty: number };

async function validateOrderItems(tenantId: string, items: OrderInputItem[]) {
  const ids = [...new Set(items.map((i) => i.id))];
  const rows = await prisma.storefrontProduct.findMany({
    where: { id: { in: ids }, tenantId, active: true },
  });
  const map = new Map(rows.map((r) => [r.id, r]));
  const lines: ShopOrderItem[] = [];
  for (const it of items) {
    const p = map.get(it.id);
    if (!p) throw new Error("Produk tidak ditemukan atau sudah tidak aktif.");
    if (!(Number(p.price) > 0)) throw new Error(`Harga "${p.title || p.name}" belum tersedia. Sinkronkan produk dulu.`);
    if (p.stock !== null && p.stock >= 0 && it.qty > p.stock) throw new Error(`Stok "${p.title || p.name}" tersisa ${p.stock}.`);
    lines.push({
      name: p.title || p.name,
      no: p.itemNo,
      qty: it.qty,
      price: Number(p.price),
      subtotal: Number(p.price) * it.qty,
      stock: p.stock,
    });
  }
  return lines;
}

const OrderBody = z.object({
  customerName: z.string().min(2).max(100),
  phone: z.string().min(8).max(20),
  note: z.string().max(300).optional(),
  fulfillment: z.enum(["pickup", "courier"]),
  address: z.string().max(300).optional(),
  postalCode: z.string().max(10).optional(),
  courierCode: z.string().max(20).optional(),
  serviceCode: z.string().max(20).optional(),
  items: z.array(z.object({ id: z.string().min(1).max(64), qty: z.number().int().min(1).max(1000) })).min(1).max(30),
});

async function orderShipping(
  tenantId: string,
  body: z.infer<typeof OrderBody>,
  lines: ShopOrderItem[]
): Promise<{ shipping?: ShopShipping; fee: number }> {
  if (body.fulfillment !== "courier") return { fee: 0 };
  if (!biteshipReady()) throw new Error("Pengiriman kurir belum aktif.");
  const address = String(body.address ?? "").trim();
  const postal = String(body.postalCode ?? "").replace(/\D/g, "");
  if (address.length < 10) throw new Error("Alamat pengiriman belum lengkap.");
  if (!/^\d{5}$/.test(postal)) throw new Error("Kode pos harus 5 digit.");
  const origin = await getShippingOrigin(tenantId);
  if (!origin.postalCode || !origin.address || !origin.phone) throw new Error("Alamat asal toko belum diatur admin.");
  const unitWeight = await getDefaultWeightGram();
  const totalQty = lines.reduce((a, l) => a + l.qty, 0);
  const weightGram = unitWeight * Math.max(1, totalQty);
  const rates = await getRates({
    originPostalCode: origin.postalCode,
    destinationPostalCode: postal,
    items: lines.map((l) => ({ name: l.name, value: l.price, quantity: l.qty, weight: unitWeight })),
  });
  const rate = rates.find(
    (r) =>
      r.courierCode.toLowerCase() === String(body.courierCode ?? "").toLowerCase() &&
      r.serviceCode.toLowerCase() === String(body.serviceCode ?? "").toLowerCase()
  );
  if (!rate) throw new Error("Layanan kurir yang dipilih tidak tersedia. Cek ongkir ulang.");
  return {
    fee: rate.price,
    shipping: {
      destinationAddress: address,
      destinationPostalCode: postal,
      destinationNote: String(body.note ?? "").slice(0, 200),
      destinationPhone: String(body.phone).replace(/\D/g, "").slice(0, 16),
      courierName: rate.courierName,
      courierCode: rate.courierCode,
      serviceName: rate.serviceName,
      serviceCode: rate.serviceCode,
      price: rate.price,
      duration: rate.duration,
      weightGram,
    },
  };
}

storefrontRouter.post(
  "/public/storefront/:slug/shipping",
  rateLimit({ name: "storefront-shipping", windowMs: 60_000, max: 40 }),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        items: z.array(z.object({ id: z.string(), qty: z.number().int().min(1).max(1000) })).min(1).max(30),
        postalCode: z.string().max(10),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const data = await publicStorefront(String(req.params.slug ?? ""));
    if (!data || data.store.mode !== "product") return res.status(404).json({ error: "tidak_ditemukan" });
    const sf = await prisma.storefront.findUnique({ where: { slug: data.store.slug } });
    if (!sf) return res.status(404).json({ error: "tidak_ditemukan" });
    let lines: ShopOrderItem[];
    try {
      lines = await validateOrderItems(sf.tenantId, body.data.items);
    } catch (e) {
      return res.status(400).json({ error: "produk_tidak_valid", message: e instanceof Error ? e.message : "Produk tidak valid." });
    }
    const postal = body.data.postalCode.replace(/\D/g, "");
    if (!/^\d{5}$/.test(postal)) return res.status(400).json({ error: "kode_pos_tidak_valid" });
    if (!biteshipReady()) return res.status(409).json({ error: "kurir_belum_aktif" });
    const origin = await getShippingOrigin(sf.tenantId);
    if (!origin.postalCode) return res.status(409).json({ error: "asal_belum_diatur" });
    const unitWeight = await getDefaultWeightGram();
    try {
      const rates = await getRates({
        originPostalCode: origin.postalCode,
        destinationPostalCode: postal,
        items: lines.map((l) => ({ name: l.name, value: l.price, quantity: l.qty, weight: unitWeight })),
      });
      const options = rates
        .slice()
        .sort((a, b) => a.price - b.price)
        .slice(0, 8)
        .map((r) => ({
          courierCode: r.courierCode,
          serviceCode: r.serviceCode,
          courierName: r.courierName,
          serviceName: r.serviceName,
          price: r.price,
          duration: r.duration,
        }));
      res.json({ options });
    } catch (e) {
      res.status(400).json({ error: "ongkir_gagal", message: e instanceof Error ? e.message.slice(0, 200) : "Gagal cek ongkir." });
    }
  })
);

storefrontRouter.post(
  "/public/storefront/:slug/order",
  rateLimit({ name: "storefront-order", windowMs: 10 * 60_000, max: 12 }),
  asyncHandler(async (req, res) => {
    const body = OrderBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request", issues: body.error.issues });
    const data = await publicStorefront(String(req.params.slug ?? ""));
    if (!data || data.store.mode !== "product") return res.status(404).json({ error: "tidak_ditemukan" });
    const sf = await prisma.storefront.findUnique({ where: { slug: data.store.slug } });
    if (!sf) return res.status(404).json({ error: "tidak_ditemukan" });
    const phone = String(body.data.phone).replace(/\D/g, "");
    if (!/^\d{8,16}$/.test(phone)) return res.status(400).json({ error: "telepon_tidak_valid" });
    let lines: ShopOrderItem[];
    let shipping: { shipping?: ShopShipping; fee: number };
    try {
      lines = await validateOrderItems(sf.tenantId, body.data.items);
      shipping = await orderShipping(sf.tenantId, body.data, lines);
    } catch (e) {
      return res.status(400).json({ error: "order_tidak_valid", message: e instanceof Error ? e.message : "Pesanan tidak valid." });
    }
    const itemsSubtotal = lines.reduce((a, l) => a + l.subtotal, 0);
    const total = itemsSubtotal + shipping.fee;
    const orderId = `shop-${randomBytes(6).toString("hex")}`;
    const paymentReady = midtransSnapReady();
    await prisma.payment.create({ data: { tenantId: sf.tenantId, orderId, amount: total, status: "pending" } });
    let qr: { qrUrl: string; qrContent: string; expiredAt: string } | null = null;
    if (paymentReady) {
      try {
        const generated = await generateQrMpm(orderId, total);
        qr = { qrUrl: generated.qrUrl, qrContent: generated.qrContent, expiredAt: generated.expiredAt };
        await prisma.payment.update({
          where: { orderId },
          data: { paymentMethod: "qris", fraudStatus: generated.referenceNo },
        });
      } catch (e) {
        console.warn("[storefront] QRIS gagal:", e instanceof Error ? e.message.slice(0, 200) : e);
      }
    }
    const order: ShopOrder = {
      orderId,
      tenantId: sf.tenantId,
      buyerPhone: phone,
      buyerName: body.data.customerName.trim().slice(0, 100),
      buyerContactPhone: phone.slice(0, 16),
      items: lines,
      total,
      itemsSubtotal,
      ...(shipping.shipping ? { shipping: shipping.shipping } : {}),
      fulfillment: body.data.fulfillment,
      status: "pending",
      qrUrl: qr?.qrUrl ?? "",
      qrContent: qr?.qrContent ?? "",
      expiresAt: qr?.expiredAt ?? "",
      createdAt: new Date().toISOString(),
      source: "storefront",
      storeSlug: sf.slug,
    };
    await saveShopOrder(order);
    void tenantOwnerId(sf.tenantId)
      .then((ownerId) =>
        ownerId
          ? sendPushToUser(ownerId, {
              title: "Pesanan storefront baru",
              body: `${order.buyerName} · Rp${Math.round(total).toLocaleString("id-ID")} · ${orderId}`,
              url: "/pesanan",
            })
          : 0
      )
      .catch(() => 0);
    await writeAudit(sf.tenantId, "storefront", "storefront.order", {
      orderId,
      total,
      slug: sf.slug,
      items: lines.length,
    });
    res.json({
      orderId,
      total,
      itemsSubtotal,
      shippingFee: shipping.fee,
      paymentReady: !!qr,
      qrUrl: qr?.qrUrl ?? "",
      expiresAt: qr?.expiredAt ?? "",
      fulfillment: order.fulfillment,
      items: lines,
      shipping: shipping.shipping ?? null,
    });
  })
);

const TRACK_CACHE = new Map<string, { at: number; data: unknown }>();

storefrontRouter.get(
  "/public/storefront/:slug/track",
  rateLimit({ name: "storefront-track", windowMs: 60_000, max: 30 }),
  asyncHandler(async (req, res) => {
    const data = await publicStorefront(String(req.params.slug ?? ""));
    if (!data) return res.status(404).json({ error: "tidak_ditemukan" });
    const sf = await prisma.storefront.findUnique({ where: { slug: data.store.slug } });
    if (!sf) return res.status(404).json({ error: "tidak_ditemukan" });
    const q = String(req.query.resi ?? req.query.q ?? "").trim().toLowerCase().replace(/^#/, "");
    if (!q) return res.status(400).json({ error: "resi_kosong", message: "Masukkan nomor resi atau ID pesanan." });

    const orders = await listShopOrders(sf.tenantId, undefined, 500);
    const order = orders.find((o) => {
      const plain = o.orderId.replace(/^shop-/, "").toLowerCase();
      return (
        o.orderId.toLowerCase() === q ||
        plain === q ||
        String(o.shipping?.waybillId ?? "").toLowerCase() === q
      );
    });
    if (!order) {
      return res.status(404).json({ error: "tidak_ditemukan", message: "Nomor resi/pesanan tidak ditemukan di toko ini." });
    }

    const cacheKey = `${sf.tenantId}:${order.orderId}`;
    const hit = TRACK_CACHE.get(cacheKey);
    if (hit && Date.now() - hit.at < 30_000) return res.json(hit.data);

    let live: Awaited<ReturnType<typeof track>> | null = null;
    const trackingId = order.shipping?.trackingId;
    const waybill = order.shipping?.waybillId;
    if (trackingId || waybill) {
      try {
        live = await Promise.race([
          track(trackingId || waybill!, trackingId ? undefined : order.shipping?.courierCode),
          new Promise<null>((resolve) => {
            const t = setTimeout(() => resolve(null), 8_000);
            t.unref?.();
          }),
        ]);
      } catch {
        /* fallback ke status tersimpan */
      }
    }
    const payload = {
      orderId: order.orderId,
      status: order.status,
      waybillId: live?.waybillId || order.shipping?.waybillId || "",
      courier:
        live?.courier.company ||
        [order.shipping?.courierName, order.shipping?.serviceName].filter(Boolean).join(" ") ||
        "",
      shippingStatus: live?.status || order.shipping?.status || "",
      history: live?.history ?? [],
      updatedAt: new Date().toISOString(),
      createdAt: order.createdAt,
      total: order.total,
    };
    TRACK_CACHE.set(cacheKey, { at: Date.now(), data: payload });
    if (TRACK_CACHE.size > 500) {
      const first = TRACK_CACHE.keys().next().value;
      if (first) TRACK_CACHE.delete(first);
    }
    res.json(payload);
  })
);

storefrontRouter.get(
  "/public/storefront/:slug/order/:orderId",
  rateLimit({ name: "storefront-order-status", windowMs: 60_000, max: 120 }),
  asyncHandler(async (req, res) => {
    const data = await publicStorefront(String(req.params.slug ?? ""));
    if (!data) return res.status(404).json({ error: "tidak_ditemukan" });
    const sf = await prisma.storefront.findUnique({ where: { slug: data.store.slug } });
    if (!sf) return res.status(404).json({ error: "tidak_ditemukan" });
    const order = await getShopOrder(String(req.params.orderId ?? ""));
    if (!order || order.tenantId !== sf.tenantId) return res.status(404).json({ error: "tidak_ditemukan" });
    res.json({
      orderId: order.orderId,
      status: order.status,
      total: order.total,
      itemsSubtotal: order.itemsSubtotal ?? order.total,
      shippingFee: order.shipping?.price ?? 0,
      items: order.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price, subtotal: i.subtotal })),
      fulfillment: order.fulfillment,
      shipping: order.shipping
        ? { courierName: order.shipping.courierName, serviceName: order.shipping.serviceName, price: order.shipping.price, duration: order.shipping.duration }
        : null,
      qrUrl: order.status === "pending" ? order.qrUrl : "",
      expiresAt: order.expiresAt,
      createdAt: order.createdAt,
      customerName: order.buyerName,
    });
  })
);

export type { RateOption };
