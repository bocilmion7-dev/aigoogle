import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireUser } from "../middleware/session.js";
import { asyncHandler } from "../asyncHandler.js";

export const settingsRouter = Router();

const PutBody = z
  .object({
    voiceEngine: z.enum(["gemini-native", "web-speech", "edge"]).optional(),
    ocrMode: z.enum(["vision", "text"]).optional(),
  })
  .refine((b) => b.voiceEngine !== undefined || b.ocrMode !== undefined, { message: "tidak ada field" });

settingsRouter.get(
  "/settings",
  requireUser,
  asyncHandler(async (_req, res) => {
    const rows = await prisma.appSetting.findMany({ where: { key: { in: ["voiceEngine", "ocrMode"] } } });
    const get = (k: string) => rows.find((r) => r.key === k)?.value;
    res.json({
      voiceEngine: get("voiceEngine") ?? "web-speech",
      ocrMode: get("ocrMode") === "text" ? "text" : "vision",
    });
  })
);

settingsRouter.put(
  "/settings",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = PutBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    for (const [key, value] of Object.entries(body.data)) {
      if (value === undefined) continue;
      await prisma.appSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }
    const rows = await prisma.appSetting.findMany({ where: { key: { in: ["voiceEngine", "ocrMode"] } } });
    const get = (k: string) => rows.find((r) => r.key === k)?.value;
    res.json({
      voiceEngine: get("voiceEngine") ?? "web-speech",
      ocrMode: get("ocrMode") === "text" ? "text" : "vision",
    });
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
