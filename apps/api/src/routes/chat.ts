import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { decryptToken, encryptToken } from "../crypto.js";
import { geminiClient } from "../ai/gemini-client.js";
import { runToolLoop } from "../ai/tool-loop.js";
import { loadPermissionSet } from "../permissions.js";
import { writeAudit } from "../audit.js";
import { accurateProvider } from "../providers/accounting/index.js";
import type { ProviderCtx, ProviderTokenSet } from "../providers/accounting/types.js";

export const chatRouter = Router();

async function ensureConnection(tenantId: string): Promise<ProviderCtx | null> {
  const conn = await prisma.connection.findUnique({
    where: { tenantId_provider: { tenantId, provider: "accurate" } },
  });
  if (!conn) return null;
  let accessToken = decryptToken(conn.accessTokenEnc);
  let host = conn.host;
  let session = conn.session;
  const provider = accurateProvider();
  if (conn.expiresAt.getTime() - Date.now() < 24 * 3600_000) {
    try {
      const fresh: ProviderTokenSet = await provider.refreshToken(decryptToken(conn.refreshTokenEnc));
      accessToken = fresh.accessToken;
      await prisma.connection.update({
        where: { id: conn.id },
        data: {
          accessTokenEnc: encryptToken(fresh.accessToken),
          refreshTokenEnc: encryptToken(fresh.refreshToken),
          expiresAt: fresh.expiresAt,
        },
      });
    } catch {
      await prisma.connection.update({ where: { id: conn.id }, data: { status: "expired" } });
      return null;
    }
  }
  if (!host || !session) {
    const dbs = await provider.listDbs(accessToken);
    const open = await provider.openDb(accessToken, dbs[0]?.providerDbId ?? "");
    host = open.host;
    session = open.session;
    await prisma.connection.update({ where: { id: conn.id }, data: { host, session } });
  }
  return { tenantId, host, session, accessToken };
}

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
      ensureConnection(user.tenant.id),
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
