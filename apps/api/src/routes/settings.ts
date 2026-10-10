import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireUser } from "../middleware/session.js";
import { asyncHandler } from "../asyncHandler.js";

export const settingsRouter = Router();

const PutBody = z.object({ voiceEngine: z.enum(["gemini-native", "web-speech"]) });

settingsRouter.get(
  "/settings",
  requireUser,
  asyncHandler(async (_req, res) => {
    const row = await prisma.appSetting.findUnique({ where: { key: "voiceEngine" } });
    res.json({ voiceEngine: row?.value ?? "web-speech" });
  })
);

settingsRouter.put(
  "/settings",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = PutBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    await prisma.appSetting.upsert({
      where: { key: "voiceEngine" },
      create: { key: "voiceEngine", value: body.data.voiceEngine },
      update: { value: body.data.voiceEngine },
    });
    res.json(body.data);
  })
);

settingsRouter.get(
  "/connections",
  requireUser,
  asyncHandler(async (req, res) => {
    const conns = await prisma.connection.findMany({ where: { tenantId: req.user!.tenant.id } });
    const accurate = conns.find((c) => c.provider === "accurate");
    const google = conns.find((c) => c.provider === "google");
    res.json([
      {
        provider: "accurate",
        status: accurate ? (accurate.expiresAt < new Date() ? "expired" : accurate.status) : "none",
        accountLabel: req.user!.tenant.alias,
        expiresAt: accurate?.expiresAt.toISOString(),
      },
      {
        provider: "google",
        status: google ? (google.expiresAt < new Date() ? "expired" : google.status) : "none",
        accountLabel: "",
        expiresAt: google?.expiresAt.toISOString(),
      },
    ]);
  })
);
