import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { driveClientFor, engineMode } from "../drive/registry.js";
import { buildPlan, executePlan, executeUndo } from "../drive/tidy.js";
import type { TidyPlanItem, TidyResultItem, UndoTarget } from "../drive/types.js";
import { classifyWithGemini } from "../drive/classify.js";
import { writeAudit } from "../audit.js";

export const driveRouter = Router();
const cancelFlags = new Map<string, boolean>();

driveRouter.get(
  "/drive/status",
  requireUser,
  asyncHandler(async (req, res) => {
    const client = await driveClientFor(req.user!.tenant.id);
    res.json({ connected: !!client, engine: engineMode() });
  })
);

driveRouter.get(
  "/drive/list",
  requireUser,
  asyncHandler(async (req, res) => {
    const folderId = String(req.query.folderId ?? "root");
    const client = await driveClientFor(req.user!.tenant.id);
    if (!client) return res.status(409).json({ error: "belum_connect" });
    if (folderId !== "root" && !(await client.isDescendant(folderId, "root"))) {
      return res.status(403).json({ error: "di_luar_cakupan" });
    }
    res.json(await client.list(folderId));
  })
);

driveRouter.post(
  "/drive/plan",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = z.object({ folderId: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const user = req.user!;
    const perms = await prisma.rolePermission.findMany({
      where: { role: { tenantId: user.tenant.id, users: { some: { id: user.id } } } },
    });
    if (!perms.some((p) => p.permissionKey === "app:drive.tidy")) {
      return res.status(403).json({ error: "tidak_punya_hak" });
    }
    const client = await driveClientFor(user.tenant.id);
    if (!client) return res.status(409).json({ error: "belum_connect" });
    if (body.data.folderId !== "root" && !(await client.isDescendant(body.data.folderId, "root"))) {
      return res.status(403).json({ error: "di_luar_cakupan" });
    }
    const listing = await client.list(body.data.folderId);
    const folderName =
      body.data.folderId === "root"
        ? "Drive"
        : listing.folders.find((f) => f.id === body.data.folderId)?.name ?? "";
    const items = await buildPlan(client, body.data.folderId, async (f) =>
      classifyWithGemini(await client.getText(f.id).catch(() => ""), f.mimeType, env.GEMINI_API_KEY, f.name)
    );
    const job = await prisma.driveJob.create({
      data: {
        tenantId: user.tenant.id,
        userId: user.id,
        folderId: body.data.folderId,
        folderName,
        status: "planned",
        planJson: JSON.stringify(items),
      },
    });
    await writeAudit(user.tenant.id, user.id, "drive.plan", {
      jobId: job.id,
      folderId: body.data.folderId,
      count: items.length,
    });
    res.json({ jobId: job.id, items });
  })
);

driveRouter.post(
  "/drive/jobs/:id/run",
  requireUser,
  asyncHandler(async (req, res) => {
    const job = await prisma.driveJob.findFirst({
      where: { id: req.params.id, tenantId: req.user!.tenant.id },
    });
    if (!job) return res.status(404).json({ error: "tidak_ditemukan" });
    if (job.status === "running") return res.status(409).json({ error: "sedang_berjalan" });
    const client = await driveClientFor(req.user!.tenant.id);
    if (!client) return res.status(409).json({ error: "belum_connect" });
    const plan = JSON.parse(job.planJson) as Parameters<typeof executePlan>[1];

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    const send = (e: Record<string, unknown>) => res.write(JSON.stringify(e) + "\n");
    await prisma.driveJob.update({ where: { id: job.id }, data: { status: "running" } });
    send({ type: "start", jobId: job.id, total: plan.filter((p) => p.action === "move").length });

    const result = await executePlan(client, plan, {
      isCancelled: () => cancelFlags.get(job.id) === true,
      onProgress: async (done, total, item) => {
        send({ type: "progress", done, total, status: item.status, fileName: item.fileName });
        await prisma.driveActionLog.create({
          data: {
            jobId: job.id,
            fileId: item.fileId,
            fileName: item.fileName,
            action: item.action,
            fromParent: item.originalParent ?? "",
            toParent: item.toParent ?? "",
            status: item.status,
            error: item.error ?? "",
          },
        });
      },
    });
    cancelFlags.delete(job.id);
    const cancelled = result.items.some((i) => i.status === "skipped");
    await prisma.driveJob.update({
      where: { id: job.id },
      data: { status: cancelled ? "cancelled" : "done", resultJson: JSON.stringify(result.items) },
    });
    await writeAudit(req.user!.tenant.id, req.user!.id, "drive.run", { jobId: job.id, cancelled });
    send({ type: cancelled ? "cancelled" : "done", jobId: job.id, items: result.items });
    res.end();
  })
);

driveRouter.post(
  "/drive/jobs/:id/cancel",
  requireUser,
  asyncHandler(async (req, res) => {
    const job = await prisma.driveJob.findFirst({
      where: { id: req.params.id, tenantId: req.user!.tenant.id },
    });
    if (!job) return res.status(404).json({ error: "tidak_ditemukan" });
    cancelFlags.set(job.id, true);
    res.json({ ok: true });
  })
);

async function requireDriveTidy(tenantId: string, userId: string): Promise<boolean> {
  const perms = await prisma.rolePermission.findMany({
    where: { role: { tenantId, users: { some: { id: userId } } } },
  });
  return perms.some((p) => p.permissionKey === "app:drive.tidy");
}

driveRouter.post(
  "/drive/jobs/:id/undo",
  requireUser,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    if (!(await requireDriveTidy(user.tenant.id, user.id))) {
      return res.status(403).json({ error: "tidak_punya_hak" });
    }
    const job = await prisma.driveJob.findFirst({
      where: { id: req.params.id, tenantId: user.tenant.id },
    });
    if (!job) return res.status(404).json({ error: "tidak_ditemukan" });
    if (job.status === "undone") return res.status(409).json({ error: "already_undone" });
    if (job.status === "running") return res.status(409).json({ error: "sedang_berjalan" });
    const client = await driveClientFor(user.tenant.id);
    if (!client) return res.status(409).json({ error: "belum_connect" });

    const plan = JSON.parse(job.planJson) as TidyPlanItem[];
    const result = JSON.parse(job.resultJson || "[]") as TidyResultItem[];
    const planByFile = new Map(plan.filter((p) => p.action === "move").map((p) => [p.fileId, p]));
    const body = z.object({ fileIds: z.array(z.string().min(1)).max(500).optional() }).safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: "bad_request" });

    const okResults = result.filter((r) => r.status === "ok");
    const bodyIds = body.data.fileIds;
    const selected = okResults.filter((r) => !bodyIds || bodyIds.includes(r.fileId));
    const targets: UndoTarget[] = [];
    for (const r of selected) {
      const p = planByFile.get(r.fileId);
      if (!p) continue;
      targets.push({
        fileId: r.fileId,
        fileName: r.fileName,
        originalParent: r.originalParent ?? p.fromParent,
        originalName: r.originalName ?? p.fileName,
        toParent: r.toParent ?? p.toParent,
        toName: r.toName ?? p.toName ?? p.fileName,
      });
    }
    if (targets.length === 0) return res.status(400).json({ error: "tidak_ada_yang_bisa_diundo" });

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    const send = (e: Record<string, unknown>) => res.write(JSON.stringify(e) + "\n");
    send({ type: "start", jobId: job.id, total: targets.length });

    const { items } = await executeUndo(client, targets, {
      onProgress: async (done, total, item) => {
        send({ type: "progress", done, total, status: item.status, fileName: item.fileName });
        await prisma.driveActionLog.create({
          data: {
            jobId: job.id,
            fileId: item.fileId,
            fileName: item.fileName,
            action: "undo_move",
            fromParent: "",
            toParent: "",
            status: item.status,
            error: item.error ?? "",
          },
        });
      },
    });

    const undoOk = items.every((i) => i.status === "ok");
    const undoByFile = new Map(items.map((i) => [i.fileId, i]));
    const merged = result.map((r) => {
      const u = undoByFile.get(r.fileId);
      if (!u) return r;
      return { ...r, undoStatus: u.status, undoError: u.error ?? "" };
    });
    const nextStatus = undoOk ? "undone" : job.status;
    await prisma.driveJob.update({
      where: { id: job.id },
      data: { status: nextStatus, resultJson: JSON.stringify(merged) },
    });
    await writeAudit(user.tenant.id, user.id, "drive.undo", {
      jobId: job.id,
      total: targets.length,
      ok: items.filter((i) => i.status === "ok").length,
      failed: items.filter((i) => i.status === "failed").length,
      status: nextStatus,
    });
    send({ type: "done", jobId: job.id, status: nextStatus, items });
    res.end();
  })
);

driveRouter.get(
  "/drive/jobs",
  requireUser,
  asyncHandler(async (req, res) => {
    const jobs = await prisma.driveJob.findMany({
      where: { tenantId: req.user!.tenant.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, folderName: true, status: true, createdAt: true },
    });
    res.json(jobs);
  })
);

driveRouter.get(
  "/drive/jobs/:id",
  requireUser,
  asyncHandler(async (req, res) => {
    const job = await prisma.driveJob.findFirst({
      where: { id: req.params.id, tenantId: req.user!.tenant.id },
      include: { logs: { orderBy: { createdAt: "asc" } } },
    });
    if (!job) return res.status(404).json({ error: "tidak_ditemukan" });
    res.json({
      id: job.id,
      folderName: job.folderName,
      status: job.status,
      plan: JSON.parse(job.planJson),
      result: JSON.parse(job.resultJson),
      logs: job.logs,
    });
  })
);
