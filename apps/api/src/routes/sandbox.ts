import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { assertAiAccess, tenantOwnerId } from "../ai/billing.js";
import { accurateCtxFor } from "../providers/accounting/connection.js";
import { biteshipReady } from "../shipping/biteship.js";
import { getWaSettings } from "../wa/service.js";
import { handleShopInbound, type ShopTransport } from "../wa/shop.js";

export const sandboxRouter = Router();

/** Nomor semu per pengguna — memisahkan riwayat sandbox dari chat WhatsApp asli. */
const peerOf = (userId: string) => `sandbox:${userId}`;

const messagesOf = (tenantId: string, peer: string) =>
  prisma.waMessageLog.findMany({
    where: { tenantId, to: peer },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: { id: true, body: true, direction: true, status: true, createdAt: true },
  });

/** Status kelengkapan fitur — ditampilkan halaman sandbox supaya tahu kenapa AI diam. */
sandboxRouter.get(
  "/sandbox/session",
  requireUser,
  asyncHandler(async (req, res) => {
    const tenantId = req.user!.tenant.id;
    const peer = peerOf(req.user!.id);
    const [settings, ctx, ownerId] = await Promise.all([
      getWaSettings(tenantId),
      accurateCtxFor(tenantId),
      tenantOwnerId(tenantId),
    ]);
    let aiAccess = false;
    if (ownerId) {
      try {
        await assertAiAccess(ownerId, tenantId);
        aiAccess = true;
      } catch {
        aiAccess = false;
      }
    }
    res.json({
      peer,
      shopAi: settings.shopAi,
      ownerPhone: settings.ownerPhone,
      accurateConnected: !!ctx,
      biteshipReady: biteshipReady(),
      aiAccess,
      messages: await messagesOf(tenantId, peer),
    });
  })
);

sandboxRouter.get(
  "/sandbox/messages",
  requireUser,
  asyncHandler(async (req, res) => {
    res.json(await messagesOf(req.user!.tenant.id, peerOf(req.user!.id)));
  })
);

/**
 * Kirim pesan sebagai "pembeli". Pipeline-nya SAMA PERSIS dengan WhatsApp live:
 * pesan masuk dicatat → handleShopInbound (prompt + tool Accurate + QRIS) →
 * balasan dicatat. Bedanya hanya transport: tidak benar-benar mengirim WA.
 */
sandboxRouter.post(
  "/sandbox/messages",
  rateLimit({ name: "sandbox-messages", windowMs: 60_000, max: 30 }),
  requireUser,
  asyncHandler(async (req, res) => {
    const body = z.object({ text: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const tenantId = req.user!.tenant.id;
    const peer = peerOf(req.user!.id);
    const text = body.data.text;

    await prisma.waMessageLog.create({
      data: { tenantId, to: peer, body: text, direction: "in", status: "received", costCredits: 0 },
    });

    const transport: ShopTransport = {
      text: async (msg) => {
        await prisma.waMessageLog.create({
          data: { tenantId, to: peer, body: msg, direction: "out", status: "sent", costCredits: 0 },
        });
        return { ok: true };
      },
      image: async (url, caption) => {
        await prisma.waMessageLog.create({
          data: { tenantId, to: peer, body: `[image] ${caption}\n${url}`, direction: "out", status: "sent", costCredits: 0 },
        });
        return { ok: true };
      },
    };

    const result = await handleShopInbound({ tenantId, from: peer, text, transport });
    res.json({ ...result, messages: await messagesOf(tenantId, peer) });
  })
);

/** Bersihkan percakapan sandbox (riwayat saja; pesanan/pembayaran yang terlanjur dibuat tetap ada). */
sandboxRouter.delete(
  "/sandbox/messages",
  requireUser,
  asyncHandler(async (req, res) => {
    const tenantId = req.user!.tenant.id;
    const peer = peerOf(req.user!.id);
    const del = await prisma.waMessageLog.deleteMany({ where: { tenantId, to: peer } });
    res.json({ ok: true, deleted: del.count });
  })
);
