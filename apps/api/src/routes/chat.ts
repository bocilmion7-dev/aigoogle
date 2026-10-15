import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { llmClient } from "../ai/llm-client.js";
import { getDefaultModel } from "../ai/model-pool.js";
import { getModuleModel } from "../ai/module-model.js";
import { runToolLoop } from "../ai/tool-loop.js";
import { selectTools, toolStats } from "../ai/tool-selector.js";
import type { LLMContent } from "../ai/llm-types.js";
import { buildSystemPrompt } from "../ai/system-prompt.js";
import { loadPermissionSet } from "../permissions.js";
import { writeAudit } from "../audit.js";
import { accurateProvider } from "../providers/accounting/index.js";
import { accurateCtxFor, refreshAccurateSession } from "../providers/accounting/connection.js";

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
      .object({
        message: z.string().min(1).max(4000),
        sessionId: z.string().optional(),
        /** mode suara: jawaban dibacakan → model diarahkan gaya lisan tanpa tabel/markdown */
        voice: z.boolean().optional(),
      })
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
    const userMsg = await prisma.chatMessage.create({
      data: { sessionId: session.id, role: "user", content: body.data.message },
    });

    // short memory: muat 10 pesan terakhir sesi (kecuali pesan user baru) agar model paham konteks percakapan sebelumnya
    const recent = await prisma.chatMessage.findMany({
      where: { sessionId: session.id, id: { not: userMsg.id } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { role: true, content: true },
    });
    const history: LLMContent[] = recent
      .reverse()
      .filter((m) => m.content.trim())
      .map((m) => ({
        role: m.role === "ai" ? ("model" as const) : ("user" as const),
        parts: [{ text: m.content.slice(0, 2000) }],
      }));

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const [permissions, ctx, preferredModel] = await Promise.all([
      loadPermissionSet(dbUser.roleId),
      accurateCtxFor(user.tenant.id),
      getModuleModel(body.data.voice === true ? "voice" : "chat"),
    ]);
    const provider = accurateProvider();
    // dynamic tool selection — hanya kirim tool relevan dgn pertanyaan (hemat ~90% input token)
    const tools = selectTools(body.data.message, provider.capabilityCatalog());
    const stats = toolStats(tools);
    console.log(`[chat] tools: ${stats.count}/${provider.capabilityCatalog().length} (~${stats.approxTokens} tok) | msg: ${body.data.message.slice(0, 80)}`);
    // ctx bisa berubah setelah refresh session "Upsss..."
    let liveCtx = ctx;

    try {
      const out = await runToolLoop({
        client: llmClient(),
        providerExecute: async (tool, args) => {
          if (!liveCtx) return Promise.reject(new Error("koneksi Accurate belum aktif — hubungkan ulang di Pengaturan"));
          // "Upsss..." = session expired ATAU rate-limit transient → retry sekali dgn jeda 2 dtk
          try {
            return await provider.execute(tool, args, liveCtx);
          } catch (e: unknown) {
            const m = e instanceof Error ? e.message : String(e);
            if (/upsss/i.test(m)) {
              await new Promise((r) => setTimeout(r, 2000));
              // refresh session sekali — session expired juga memicu "Upsss..."
              const fresh = await refreshAccurateSession(user.tenant.id).catch(() => null);
              if (fresh) liveCtx = fresh;
              return await provider.execute(tool, args, liveCtx);
            }
            if (/fetch failed|ECONNREFUSED|ENOTFOUND|socket|network/i.test(m)) {
              throw new Error("tidak dapat menghubungi Accurate — koneksi ke server akuntansi terputus");
            }
            throw e;
          }
        },
        permissions,
        system: buildSystemPrompt({ tenantName: user.tenant.name, voice: body.data.voice === true }),
        tools,
        userMessage: body.data.message,
        history,
        onEvent: (e) => {
          const ev = e as Record<string, unknown>;
          // start membawa sessionId supaya frontend (mode voice) bisa lanjut di sesi yg sama
          send(e.type === "start" ? { ...ev, sessionId: session.id } : ev);
        },
        model: preferredModel || (await getDefaultModel()),
      });
      for (const t of out.trace) {
        if (t.tool) void writeAudit(user.tenant.id, user.id, "tool.call", t);
      }
      const aiMsg = await prisma.chatMessage.create({
        data: { sessionId: session.id, role: "ai", content: out.text, toolTrace: JSON.stringify(out.trace) },
      });
      send({ type: "done", messageId: aiMsg.id });
    } catch (e) {
      console.error("[chat] stream error:", e);
      const msg =
        e instanceof Error && /503|tidak ada model|tidak ada provider|tidak tersedia/i.test(e.message)
          ? "Layanan AI sedang tidak tersedia — atur provider di menu AI atau coba lagi sebentar."
          : "Terjadi gangguan — coba lagi.";
      send({ type: "error", message: msg });
    }
    res.end();
  })
);
