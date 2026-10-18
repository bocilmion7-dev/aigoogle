import { Router } from "express";
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
import { scanDocument } from "../doc/scan.js";

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

async function ocrMode(): Promise<"vision" | "text"> {
  const row = await prisma.appSetting.findUnique({ where: { key: "ocrMode" } });
  return row?.value === "text" ? "text" : "vision";
}

customersRouter.get(
  "/customers",
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

    const mode = await ocrMode();
    const vision = VISION_KINDS.has(kind);
    if (vision && mode !== "vision") return res.status(409).json({ error: "vision_ocr_nonaktif" });

    const localText = await extractText(buffer, kind);
    if (!vision && !localText.trim()) return res.status(422).json({ error: "empty_text" });

    const out = await scanDocument({
      buffer, kind, mime, fileName,
      localText,
    });
    res.json({
      fileName,
      kind,
      rawText: out.rawText,
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
