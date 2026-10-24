import { Router } from "express";
import { rateLimit } from "../middleware/rate-limit.js";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { requirePerm, loadPermissionSet } from "../permissions.js";
import { accurateCtxFor } from "../providers/accounting/connection.js";
import { accurateProvider } from "../providers/accounting/index.js";
import { cache, CACHE_TTL, invalidateTenantCache } from "../cache.js";
import { writeAudit } from "../audit.js";
import { detectKind, extractText, VISION_KINDS } from "../doc/extract.js";
import { scanDocument, type ScanHint } from "../doc/scan.js";
import { ocrImage, ocrUsable } from "../doc/ocr.js";
import { AiSaldoHabis, assertCanUseAi, chargeAi } from "../ai/billing.js";
import { getModuleModel } from "../ai/module-model.js";

export const customersRouter = Router();

const MAX_UPLOAD = 15 * 1024 * 1024;

async function readRaw(req: Express.Request, limit = MAX_UPLOAD): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  const stream = req as unknown as AsyncIterable<Buffer | string>;
  for await (const c of stream) {
    const buf = Buffer.isBuffer(c) ? c : Buffer.from(c as string);
    size += buf.length;
    if (size > limit) return null;
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function extOf(fileName: string, mime: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff"].includes(ext)) return ext === "jpeg" ? "jpg" : ext;
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/** header x-doc-hint: {"docType":"kwitansi","direction":"masuk","label":"..."} */
function parseHint(raw: string | undefined): ScanHint | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const hint: ScanHint = {
      docType: typeof v.docType === "string" ? v.docType.slice(0, 60) : undefined,
      direction: typeof v.direction === "string" ? v.direction.slice(0, 20) : undefined,
      label: typeof v.label === "string" ? v.label.slice(0, 60) : undefined,
    };
    return hint.docType || hint.direction || hint.label ? hint : undefined;
  } catch {
    return undefined;
  }
}

async function ocrMode(): Promise<"vision" | "text"> {
  const row = await prisma.appSetting.findUnique({ where: { key: "ocrMode" } });
  return row?.value === "text" ? "text" : "vision";
}

customersRouter.get(
  "/customers",
  rateLimit({ name: "customers", windowMs: 60_000, max: 60 }),
  requirePerm("accurate:customer.view"),
  asyncHandler(async (req, res) => {
    const ctx = await accurateCtxFor(req.user!.tenant.id);
    if (!ctx) return res.status(409).json({ error: "belum_connect" });
    const provider = accurateProvider();
    const keywords = typeof req.query.keywords === "string" ? req.query.keywords : "";
    // cache per-tenant — dibuang otomatis saat webhook CUSTOMER/SALES_INVOICE masuk
    const key = `${req.user!.tenant.id}:accurate:customer:list:${keywords}`;
    const hit = cache.get<Array<{ id: string; name: string; invoiceCount: number; invoiceTotal: number }>>(key);
    if (hit) return res.json(hit);
    const listed = await provider.execute("customer.list", keywords ? { keywords } : {}, ctx);
    const rows = (Array.isArray(listed) ? listed : (listed as { items?: Array<Record<string, unknown>> }).items ?? []) as Array<
      Record<string, unknown>
    >;
    let invoices: Array<Record<string, unknown>> = [];
    try {
      const invListed = await provider.execute("salesInvoice.list", { pageSize: 500, page: 1 }, ctx);
      invoices = (Array.isArray(invListed)
        ? invListed
        : (invListed as { items?: Array<Record<string, unknown>> }).items ?? []) as Array<Record<string, unknown>>;
    } catch {
      invoices = [];
    }
    const byName = new Map<string, { count: number; total: number }>();
    for (const f of invoices) {
      // Accurate asli: { customer: { name }, totalAmount } · mock: { customerName, total }
      const cust = f.customer as { name?: unknown } | undefined;
      const name = String(cust?.name ?? f.customerName ?? "").toLowerCase();
      if (!name) continue;
      const agg = byName.get(name) ?? { count: 0, total: 0 };
      agg.count += 1;
      agg.total += Number(f.totalAmount ?? f.total ?? 0) || 0;
      byName.set(name, agg);
    }
    const out = rows.map((c) => {
      const agg = byName.get(String(c.name ?? "").toLowerCase());
      return { id: String(c.id ?? ""), name: String(c.name ?? ""), invoiceCount: agg?.count ?? 0, invoiceTotal: agg?.total ?? 0 };
    });
    cache.set(key, out, CACHE_TTL);
    res.json(out);
  })
);

/** daftar nama pelanggan utk autocomplete "@" di chat — ringan (customer.list saja,
 *  tanpa agregat faktur), cache per tenant, ikut dibuang saat webhook CUSTOMER masuk. */
customersRouter.get(
  "/customers/names",
  rateLimit({ name: "customers-names", windowMs: 60_000, max: 60 }),
  requirePerm("accurate:customer.view"),
  asyncHandler(async (req, res) => {
    const tenantId = req.user!.tenant.id;
    const key = `${tenantId}:accurate:customer:names`;
    const hit = cache.get<Array<{ name: string; customerNo: string }>>(key);
    if (hit) return res.json(hit);
    const ctx = await accurateCtxFor(tenantId);
    if (!ctx) return res.status(409).json({ error: "belum_connect" });
    const provider = accurateProvider();
    const out: Array<{ name: string; customerNo: string }> = [];
    for (let page = 1; page <= 5; page++) {
      const listed = (await provider.execute("customer.list", { pageSize: 100, page }, ctx)) as {
        items?: Array<Record<string, unknown>>;
        pageCount?: number;
      };
      const items = Array.isArray(listed) ? listed : listed.items ?? [];
      for (const c of items) {
        const name = String(c.name ?? "").trim();
        if (name) out.push({ name, customerNo: String(c.customerNo ?? "") });
      }
      const pageCount = Number(listed.pageCount ?? (items.length < 100 ? page : page + 1));
      if (page >= pageCount) break;
    }
    out.sort((a, b) => a.name.localeCompare(b.name, "id"));
    cache.set(key, out, CACHE_TTL);
    res.json(out);
  })
);

customersRouter.post(
  "/customers/scan",
  requireUser,
  asyncHandler(async (req, res) => {
    const buffer = await readRaw(req);
    if (!buffer) return res.status(413).json({ error: "file_too_large" });
    if (!buffer.length) return res.status(400).json({ error: "empty_file" });
    const fileName = String(req.header("x-file-name") ?? "dokumen").slice(0, 200);
    const mime = String(req.header("content-type") ?? "application/octet-stream").split(";")[0].trim();
    const kind = detectKind(fileName, mime);
    if (kind === "unknown") return res.status(415).json({ error: "unsupported_type" });

    // saldo AI member — blokir total bila tidak cukup
    try {
      await assertCanUseAi(req.user!.id, req.user!.tenant.id);
    } catch (e) {
      if (e instanceof AiSaldoHabis) {
        return res.status(402).json({
          error: "saldo_ai_habis",
          balance: e.balance,
          need: e.need,
        });
      }
      throw e;
    }
    const mode = await ocrMode();
    const vision = VISION_KINDS.has(kind);
    const localText = await extractText(buffer, kind);
    // gambar: OCR lokal (tesseract) dulu — berhasil → tak perlu vision
    const ocrText = kind === "image" ? await ocrImage(buffer, extOf(fileName, mime)) : "";
    const ocrOk = kind === "image" && ocrUsable(ocrText);
    if (vision && mode !== "vision" && !ocrOk) return res.status(409).json({ error: "vision_ocr_nonaktif" });
    if (!vision && !localText.trim()) return res.status(422).json({ error: "empty_text" });

    const out = await scanDocument({
      buffer, kind, mime, fileName,
      localText,
      ocrText,
      hint: parseHint(req.header("x-doc-hint")),
    });
    // potong saldo (estimasi token: prompt teks/gambar + prompt aturan, output JSON)
    {
      const model = (await getModuleModel(kind === "image" ? "uploadImage" : "uploadDocument")) || "unknown";
      const promptChars = 2_000 + (ocrText.length || localText.length) + fileName.length;
      const completionChars = 500 + out.rawText.length + JSON.stringify(out.fields).length;
      void chargeAi({
        userId: req.user!.id,
        tenantId: req.user!.tenant.id,
        kind: "doc",
        model,
        promptTokens: Math.round(promptChars / 4),
        completionTokens: Math.round(completionChars / 4),
        refId: fileName,
      }).catch(() => null);
    }
    res.json({
      fileName,
      kind,
      rawText: out.rawText,
      ocrText: ocrText || undefined,
      fields: out.fields,
      suggestedTarget: out.target,
      aiModule: out.aiModule ?? null,
      aiReason: out.targetReason ?? null,
      aiConfidence: out.confidence ?? null,
      ...(out.aiOk
        ? {}
        : {
            warning: vision
              ? "vision_ocr_gagal"
              : "field_ocr_gagal",
          }),
    });
  })
);

const EntryLineItem = z.object({
  name: z.string().min(1).max(200),
  qty: z.number().positive().optional(),
  price: z.number().nonnegative().optional(),
});
const ENTRY_TARGETS = ["salesInvoice", "salesReceipt", "purchaseInvoice", "expense", "bankTransfer"] as const;
const TARGET_PERM: Record<(typeof ENTRY_TARGETS)[number], string> = {
  salesInvoice: "accurate:sales-invoice.view",
  salesReceipt: "accurate:sales-receipt.view",
  purchaseInvoice: "accurate:purchase-invoice.view",
  expense: "accurate:expense.view",
  bankTransfer: "accurate:bank-transfer.view",
};
const TARGET_NEEDS_NAME = new Set(["salesInvoice", "salesReceipt", "purchaseInvoice"]);

const EntryBody = z.object({
  target: z.enum(ENTRY_TARGETS),
  customerName: z.string().max(200).default(""),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  no: z.string().max(60).optional(),
  total: z.number().nonnegative().optional(),
  description: z.string().max(500).optional(),
  items: z.array(EntryLineItem).max(50).optional(),
});

customersRouter.post(
  "/customers/entries",
  rateLimit({ name: "customers-entries", windowMs: 60_000, max: 20 }),
  requireUser,
  asyncHandler(async (req, res) => {
    const targetRaw = (req.body as { target?: unknown } | undefined)?.target;
    const needed = TARGET_PERM[targetRaw as keyof typeof TARGET_PERM];
    if (needed) {
      const perms = await loadPermissionSet(req.user!.roleId);
      if (!perms.has(needed)) return res.status(403).json({ error: "tidak_punya_hak" });
    }
    const body = EntryBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request", issues: body.error.issues });
    const b = body.data;
    if (TARGET_NEEDS_NAME.has(b.target) && !b.customerName.trim()) {
      return res.status(400).json({ error: "bad_request", issues: [{ path: ["customerName"], message: "wajib diisi" }] });
    }
    const ctx = await accurateCtxFor(req.user!.tenant.id);
    if (!ctx) return res.status(409).json({ error: "belum_connect" });
    const provider = accurateProvider();
    let saved: { id: string };
    try {
      if (b.target === "salesInvoice") {
        saved = await provider.createSalesInvoice(ctx, {
          customerName: b.customerName,
          date: b.date,
          no: b.no,
          total: b.total,
          description: b.description,
        });
      } else if (b.target === "salesReceipt") {
        saved = await provider.createSalesReceipt(ctx, {
          customerName: b.customerName,
          date: b.date,
          no: b.no,
          amount: b.total,
          description: b.description,
        });
      } else if (b.target === "purchaseInvoice") {
        saved = await provider.createPurchaseInvoice(ctx, {
          vendorName: b.customerName,
          date: b.date,
          no: b.no,
          total: b.total,
          description: b.description,
          items: b.items,
        });
      } else if (b.target === "expense") {
        saved = await provider.createExpense(ctx, {
          date: b.date,
          total: b.total,
          description: b.description || (b.customerName ? `Beban ${b.customerName}` : ""),
        });
      } else {
        saved = await provider.createBankTransfer(ctx, {
          date: b.date,
          total: b.total,
          description: b.description,
        });
      }
    } catch (e) {
      // pesan Accurate (mis. "No Faktur sudah ada…") → tampil apa adanya di UI
      const msg = (e instanceof Error ? e.message : "").replace(/^provider gagal:\s*/, "");
      return res.status(422).json({ error: msg || "gagal menyimpan ke Accurate" });
    }
    await writeAudit(req.user!.tenant.id, req.user!.id, "customer.entry", {
      target: b.target,
      id: saved.id,
      customerName: b.customerName || null,
      total: b.total ?? null,
    });
    // tulis baru di Accurate → buang cache agregat supaya angka langsung segar
    invalidateTenantCache(req.user!.tenant.id, "accurate:customer");
    invalidateTenantCache(req.user!.tenant.id, "accurate:sales-invoice");
    invalidateTenantCache(req.user!.tenant.id, "accurate:purchase-invoice");
    res.json({ ok: true, id: saved.id, target: b.target });
  })
);
