import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { writeAudit } from "../audit.js";

/** Jenis dokumen kustom per PERUSAHAAN (dipakai semua user tenant). */
export const docTypesRouter = Router();

export interface DocTypeRow {
  key: string;
  label: string;
  /** target simpan Accurate (opsional) — kosong = arsip saja */
  target: string;
}

const keyOf = (tenantId: string) => `doc:types:${tenantId}`;

const Body = z.object({
  types: z
    .array(
      z.object({
        key: z.string().min(1).max(40),
        label: z.string().min(1).max(60),
        target: z.string().max(40).optional().default(""),
      })
    )
    .max(30),
});

function parseTypes(value: string | undefined): DocTypeRow[] {
  if (!value) return [];
  try {
    const v = JSON.parse(value) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .map((r) => r as Record<string, unknown>)
      .map((r) => ({
        key: String(r.key ?? "").slice(0, 40),
        label: String(r.label ?? "").slice(0, 60),
        target: String(r.target ?? "").slice(0, 40),
      }))
      .filter((r) => r.key && r.label)
      .slice(0, 30);
  } catch {
    return [];
  }
}

docTypesRouter.get(
  "/doc/types",
  requireUser,
  asyncHandler(async (req, res) => {
    const row = await prisma.appSetting.findUnique({ where: { key: keyOf(req.user!.tenant.id) } });
    res.json({ types: parseTypes(row?.value) });
  })
);

docTypesRouter.put(
  "/doc/types",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = Body.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request", issues: body.error.issues });
    // normalisasi key (slug) + buang duplikat
    const seen = new Set<string>();
    const types: DocTypeRow[] = [];
    for (const t of body.data.types) {
      const key = t.key
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      types.push({ key, label: t.label.trim().slice(0, 60), target: t.target.trim().slice(0, 40) });
    }
    const key = keyOf(req.user!.tenant.id);
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: JSON.stringify(types) },
      update: { value: JSON.stringify(types) },
    });
    await writeAudit(req.user!.tenant.id, req.user!.id, "doc.types.update", { count: types.length });
    res.json({ ok: true, types });
  })
);
