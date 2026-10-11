import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { geminiClient } from "../ai/gemini-client.js";
import { runToolLoop } from "../ai/tool-loop.js";
import { loadPermissionSet } from "../permissions.js";
import { writeAudit } from "../audit.js";
import { accurateProvider } from "../providers/accounting/index.js";
import { accurateCtxFor } from "../providers/accounting/connection.js";

export const chatRouter = Router();

chatRouter.get(
  "/chat/sessions",
  requireUser,
  asyncHandler(async (req, res) => {
    const sessions = await prisma.chatSession.findMany({
      where: { tenantId: req.user!.tenant.id, userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, title: true, createdAt: true },
    });
    res.json(sessions);
  })
);

chatRouter.get(
  "/chat/sessions/:id/messages",
  requireUser,
  asyncHandler(async (req, res) => {
    const sess = await prisma.chatSession.findFirst({
      where: { id: req.params.id, tenantId: req.user!.tenant.id, userId: req.user!.id },
    });
    if (!sess) return res.status(404).json({ error: "tidak_ditemukan" });
    const msgs = await prisma.chatMessage.findMany({
      where: { sessionId: sess.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, content: true, createdAt: true },
    });
    res.json(msgs);
  })
);

chatRouter.post(
  "/chat/stream",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = z
      .object({ message: z.string().min(1).max(4000), sessionId: z.string().optional() })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const user = req.user!;

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    const send = (e: Record<string, unknown>) => res.write(JSON.stringify(e) + "\n");

    let session = body.data.sessionId
      ? await prisma.chatSession.findFirst({
          where: { id: body.data.sessionId, tenantId: user.tenant.id, userId: user.id },
        })
      : null;
    if (!session) {
      session = await prisma.chatSession.create({
        data: { tenantId: user.tenant.id, userId: user.id, title: body.data.message.slice(0, 60) },
      });
    }
    await prisma.chatMessage.create({ data: { sessionId: session.id, role: "user", content: body.data.message } });

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const [permissions, ctx] = await Promise.all([
      loadPermissionSet(dbUser.roleId),
      accurateCtxFor(user.tenant.id),
    ]);
    const provider = accurateProvider();
    const tools = provider.capabilityCatalog();

    try {
      const out = await runToolLoop({
        gemini: geminiClient(),
        providerExecute: (tool, args) => {
          if (!ctx) return Promise.reject(new Error("koneksi Accurate belum aktif — hubungkan ulang di Pengaturan"));
          return provider.execute(tool, args, ctx);
        },
        permissions,
        tools,
        userMessage: body.data.message,
        onEvent: (e) => send(e as Record<string, unknown>),
        model: env.GEMINI_MODEL,
      });
      for (const t of out.trace) {
        if (t.tool) void writeAudit(user.tenant.id, user.id, "tool.call", t);
      }
      const aiMsg = await prisma.chatMessage.create({
        data: { sessionId: session.id, role: "ai", content: out.text, toolTrace: JSON.stringify(out.trace) },
      });
      send({ type: "done", messageId: aiMsg.id });
    } catch (e) {
      const msg =
        e instanceof Error && /503|GEMINI/i.test(e.message)
          ? "Layanan AI sedang tidak tersedia — coba lagi sebentar."
          : "Terjadi gangguan — coba lagi.";
      send({ type: "error", message: msg });
    }
    res.end();
  })
);
