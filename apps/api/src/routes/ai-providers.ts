import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePlatform } from "../middleware/session.js";
import { asyncHandler } from "../asyncHandler.js";
import { writeAudit } from "../audit.js";
import { RealNvidiaClient } from "../ai/nvidia.js";
import { LlmHttpError } from "../ai/llm-error.js";
import {
  AI_MODULES,
  AI_MODULE_HINTS,
  AI_MODULE_LABELS,
  getAllModuleModels,
  setModuleModels,
} from "../ai/module-model.js";

export const aiProvidersRouter = Router();

function maskKey(key: string): string {
  if (!key) return "";
  return `••••${key.slice(-4)}`;
}

aiProvidersRouter.get(
  "/ai/providers",
  requirePlatform,
  asyncHandler(async (_req, res) => {
    const rows = await prisma.aiProvider.findMany({
      include: { models: { orderBy: { rank: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    res.json(
      rows.map((p) => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        apiKeyMasked: maskKey(p.apiKey),
        isActive: p.isActive,
        models: p.models.map((m) => ({
          name: m.name,
          rank: m.rank,
          failureCount: m.failureCount,
          lastError: m.lastError,
          lastOkAt: m.lastOkAt?.toISOString() ?? null,
        })),
      }))
    );
  })
);

const ProviderBody = z.object({
  name: z.string().min(1).max(100),
  baseUrl: z.string().url().max(300),
  apiKey: z.string().min(1).max(500),
  models: z.array(z.string().min(1).max(200)).max(200).default([]),
});

aiProvidersRouter.post(
  "/ai/providers",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const body = ProviderBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const { name, baseUrl, apiKey, models } = body.data;
    const p = await prisma.aiProvider.create({
      data: {
        name,
        baseUrl: baseUrl.replace(/\/+$/, ""),
        apiKey,
        models: { createMany: { data: models.map((m, rank) => ({ name: m, rank })) } },
      },
      include: { models: true },
    });
    await writeAudit("platform", req.platform!.id, "ai_provider.create", { id: p.id, name });
    res.status(201).json({ id: p.id });
  })
);

const UpdateBody = z.object({
  name: z.string().min(1).max(100).optional(),
  baseUrl: z.string().url().max(300).optional(),
  apiKey: z.string().min(1).max(500).optional(),
  models: z.array(z.string().min(1).max(200)).max(200).optional(),
});

aiProvidersRouter.put(
  "/ai/providers/:id",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const body = UpdateBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const id = req.params.id;
    const exists = await prisma.aiProvider.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ error: "tidak_ditemukan" });
    const { models, baseUrl, ...rest } = body.data;
    await prisma.$transaction(async (tx) => {
      await tx.aiProvider.update({
        where: { id },
        data: { ...rest, ...(baseUrl ? { baseUrl: baseUrl.replace(/\/+$/, "") } : {}) },
      });
      if (models !== undefined) {
        await tx.aiProviderModel.deleteMany({ where: { providerId: id } });
        if (models.length) {
          await tx.aiProviderModel.createMany({
            data: models.map((m, rank) => ({ providerId: id, name: m, rank })),
          });
        }
      }
    });
    await writeAudit("platform", req.platform!.id, "ai_provider.update", { id });
    res.json({ ok: true });
  })
);

aiProvidersRouter.delete(
  "/ai/providers/:id",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const exists = await prisma.aiProvider.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ error: "tidak_ditemukan" });
    await prisma.aiProvider.delete({ where: { id } });
    await writeAudit("platform", req.platform!.id, "ai_provider.delete", { id, name: exists.name });
    res.json({ ok: true });
  })
);

aiProvidersRouter.post(
  "/ai/providers/:id/activate",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const exists = await prisma.aiProvider.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ error: "tidak_ditemukan" });
    await prisma.$transaction([
      prisma.aiProvider.updateMany({ data: { isActive: false } }),
      prisma.aiProvider.update({ where: { id }, data: { isActive: true } }),
    ]);
    await writeAudit("platform", req.platform!.id, "ai_provider.activate", { id });
    res.json({ ok: true });
  })
);

const PreviewBody = z.object({
  baseUrl: z.string().url().max(300),
  apiKey: z.string().min(1).max(500),
});

async function fetchModelList(baseUrl: string, apiKey: string): Promise<string[]> {
  try {
    return await new RealNvidiaClient(apiKey, baseUrl.replace(/\/+$/, "")).listModels();
  } catch (e) {
    const st = e instanceof LlmHttpError ? e.status : 502;
    const msg = e instanceof Error ? e.message : String(e);
    throw new LlmHttpError(st >= 400 && st < 600 ? st : 502, `gagal memuat model: ${msg}`.slice(0, 500));
  }
}

aiProvidersRouter.post(
  "/ai/providers/preview-models",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const body = PreviewBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const models = await fetchModelList(body.data.baseUrl, body.data.apiKey);
    res.json({ models });
  })
);

aiProvidersRouter.post(
  "/ai/providers/:id/refresh-models",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const p = await prisma.aiProvider.findUnique({ where: { id: req.params.id } });
    if (!p) return res.status(404).json({ error: "tidak_ditemukan" });
    const models = await fetchModelList(p.baseUrl, p.apiKey);
    res.json({ models });
  })
);

/* ---------- model per modul AI (global) ---------- */

aiProvidersRouter.get(
  "/ai/module-models",
  requirePlatform,
  asyncHandler(async (_req, res) => {
    const active = await prisma.aiProvider.findFirst({
      where: { isActive: true },
      include: { models: { orderBy: { rank: "asc" } } },
    });
    const modules = await getAllModuleModels();
    res.json({
      providerName: active?.name ?? "",
      available: (active?.models ?? []).map((m) => ({ name: m.name, rank: m.rank })),
      modules: AI_MODULES.map((m) => ({
        key: m,
        label: AI_MODULE_LABELS[m],
        hint: AI_MODULE_HINTS[m],
        value: modules[m],
      })),
    });
  })
);

const ModuleModelsBody = z
  .object({
    chat: z.string().max(200).optional(),
    voice: z.string().max(200).optional(),
    drive: z.string().max(200).optional(),
    uploadImage: z.string().max(200).optional(),
    uploadDocument: z.string().max(200).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "tidak ada field" });

aiProvidersRouter.put(
  "/ai/module-models",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const body = ModuleModelsBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    await setModuleModels(body.data);
    await writeAudit("platform", req.platform!.id, "ai_module_models.update", body.data);
    res.json({ ok: true });
  })
);
