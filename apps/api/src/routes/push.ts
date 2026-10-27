import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { pushPublicKey, pushReady, pushSubKey, sendPushToUser } from "../push.js";

export const pushRouter = Router();

const SubscriptionBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(10), auth: z.string().min(5) }),
});

pushRouter.get("/push/public-key", (_req, res) => {
  res.json({ enabled: pushReady(), key: pushPublicKey() });
});

pushRouter.post(
  "/push/subscribe",
  requireUser,
  asyncHandler(async (req, res) => {
    if (!pushReady()) return res.status(503).json({ error: "push_belum_dikonfigurasi" });
    const body = SubscriptionBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const key = pushSubKey(req.user!.id, body.data.endpoint);
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: JSON.stringify(body.data) },
      update: { value: JSON.stringify(body.data) },
    });
    res.json({ ok: true });
  })
);

pushRouter.post(
  "/push/unsubscribe",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = z.object({ endpoint: z.string().url() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    await prisma.appSetting.deleteMany({ where: { key: pushSubKey(req.user!.id, body.data.endpoint) } });
    res.json({ ok: true });
  })
);

pushRouter.post(
  "/push/test",
  requireUser,
  asyncHandler(async (req, res) => {
    if (!pushReady()) return res.status(503).json({ error: "push_belum_dikonfigurasi" });
    const sent = await sendPushToUser(req.user!.id, {
      title: "AI Asisten",
      body: "Notifikasi push aktif. Anda akan menerima pengingat penting di sini.",
      url: "/app",
    });
    res.json({ ok: true, sent });
  })
);
