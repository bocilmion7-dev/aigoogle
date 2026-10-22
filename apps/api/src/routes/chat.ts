import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { llmClient } from "../ai/llm-client.js";
import { getDefaultModel } from "../ai/model-pool.js";
import { friendlyChatErrorMessage } from "../ai/chat-error-message.js";
import { getModuleModel } from "../ai/module-model.js";
import { runToolLoop } from "../ai/tool-loop.js";
import { selectTools, toolStats } from "../ai/tool-selector.js";
import { transformToRoute, formatAggregationResult } from "../ai/transformer.js";
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
    let bytesSent = 0;
    const send = (e: Record<string, unknown>) => {
      const line = JSON.stringify(e) + "\n";
      bytesSent += Buffer.byteLength(line);
      res.write(line);
    };
    // klien menutup di tengah stream (klik navigasi/reload, jaringan putus, atau
    // browser membatalkan) → rekam di journal agar tak lagi mustahil didiagnosis.
    // bila TIDAK pernah muncul, berarti server yg menutup — bukan klien.
    res.on("close", () => {
      if (!res.writableEnded) {
        console.warn(`[chat] stream ditutup di tengah jalan | bytes=${bytesSent} | writableEnded=${res.writableEnded}`);
      }
    });

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
    const t0 = Date.now();

    // providerExecute dipakai BOTH fast path (transformer) & tool loop penuh
    const providerExecute = async (tool: string, args: Record<string, unknown>) => {
      if (!liveCtx) return Promise.reject(new Error("koneksi Accurate belum aktif — hubungkan ulang di Pengaturan"));
      try {
        return await provider.execute(tool, args, liveCtx);
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : String(e);
        if (/upsss/i.test(m)) {
          await new Promise((r) => setTimeout(r, 2000));
          const fresh = await refreshAccurateSession(user.tenant.id).catch(() => null);
          if (fresh) liveCtx = fresh;
          return await provider.execute(tool, args, liveCtx);
        }
        if (/fetch failed|ECONNREFUSED|ENOTFOUND|socket|network/i.test(m)) {
          throw new Error("tidak dapat menghubungi Accurate — koneksi ke server akuntansi terputus");
        }
        throw e;
      }
    };

    try {
      // ─── FAST PATH: transformer → agregasi adapter ───
      // Router ringan (~1rb token) pilih 1 tool → eksekusi → format (0 token LLM).
      // Bila router gagal/ragu → jatuh ke runToolLoop penuh (aman, inkremental).
      const route = await transformToRoute({
        userMessage: body.data.message,
        history: history
          .filter((c) => c.parts.some((p) => p.text))
          .map((c) => ({
            role: (c.role === "model" ? "model" : "user") as "user" | "model",
            text: c.parts.map((p) => p.text ?? "").join(" ").slice(0, 500),
          })),
        client: llmClient(),
        model: preferredModel || (await getDefaultModel()),
      });
      if (route) {
        const spec = provider.capabilityCatalog().find((t) => t.name === route.tool);
        const label = spec && "label" in spec ? (spec as { label?: string }).label : undefined;
        const perm = spec && "requiredPermission" in spec ? (spec as { requiredPermission?: string }).requiredPermission : undefined;
        if (!perm || permissions.has(perm)) {
          console.log(`[chat] transformer pilih ${route.tool} ${JSON.stringify(route.args).slice(0, 120)}`);
          send({ type: "start", sessionId: session.id });
          send({ type: "tool_call", tool: route.tool, label });
          try {
            const result = await providerExecute(route.tool, route.args);
            send({ type: "tool_result", tool: route.tool, ok: true });
            const answer = formatAggregationResult(route.tool, result);
            if (answer) {
              // kirim jawaban sebagai beberapa chunk supaya terasa natural (bukan dinding teks)
              const chunkSize = Math.ceil(answer.length / 4);
              for (let i = 0; i < answer.length; i += chunkSize) {
                send({ type: "text_delta", delta: answer.slice(i, i + chunkSize) });
              }
              void writeAudit(user.tenant.id, user.id, "tool.call", { tool: route.tool, args: route.args, ok: true });
              const aiMsg = await prisma.chatMessage.create({
                data: { sessionId: session.id, role: "ai", content: answer, toolTrace: JSON.stringify([{ tool: route.tool, args: route.args, ok: true }]) },
              });
              send({ type: "done", messageId: aiMsg.id });
              console.log(`[chat] fast-path selesai ${((Date.now() - t0) / 1000).toFixed(1)}s | tool: ${route.tool} | msg: ${body.data.message.slice(0, 40)}`);
              res.end();
              return;
            }
            // format null → bentuk result tak terduga → jatuh ke tool loop
            console.warn(`[transformer] format null utk ${route.tool} — jatuh ke tool loop`);
          } catch (e) {
            // eksekusi gagal (koneksi Accurate putus dkk) → jatuh ke tool loop (punya pesan error sendiri)
            console.warn(`[chat] fast-path eksekusi gagal (${e instanceof Error ? e.message : e}) — jatuh ke tool loop`);
          }
        }
      }

      // ─── SLOW PATH: runToolLoop penuh (38 tool, streaming) ───
      const out = await runToolLoop({
        client: llmClient(),
        providerExecute,
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
      console.log(`[chat] selesai ${((Date.now() - t0) / 1000).toFixed(1)}s | tools: ${tools.length} | msg: ${body.data.message.slice(0, 40)}`);
    } catch (e) {
      console.error(`[chat] stream error (${((Date.now() - t0) / 1000).toFixed(1)}s):`, e);
      send({ type: "error", message: friendlyChatErrorMessage(e) });
    }
    res.end();
  })
);
