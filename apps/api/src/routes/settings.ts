import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireUser } from "../middleware/session.js";
import { requirePerm } from "../permissions.js";
import { asyncHandler } from "../asyncHandler.js";
import { WA_TOPUP_RUPIAH_PER_CREDIT } from "../wa/service.js";
import { writeAudit } from "../audit.js";

export const settingsRouter = Router();

const PutBody = z
  .object({
    voiceEngine: z.enum(["gemini-native", "web-speech", "edge"]).optional(),
    ocrMode: z.enum(["vision", "text"]).optional(),
    waPricePerCredit: z.number().int().min(1).max(1_000_000).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "tidak ada field" });

async function settingsSnapshot() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ["voiceEngine", "ocrMode", "waPricePerCredit"] } },
  });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const price = Number(get("waPricePerCredit"));
  return {
    voiceEngine: get("voiceEngine") ?? "web-speech",
    ocrMode: get("ocrMode") === "text" ? "text" : "vision",
    waPricePerCredit: Number.isFinite(price) && price >= 1 ? price : WA_TOPUP_RUPIAH_PER_CREDIT,
  };
}

settingsRouter.get(
  "/settings",
  requireUser,
  asyncHandler(async (_req, res) => {
    res.json(await settingsSnapshot());
  })
);

settingsRouter.put(
  "/settings",
  requirePerm("app:settings.manage"),
  asyncHandler(async (req, res) => {
    const body = PutBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    for (const [key, value] of Object.entries(body.data)) {
      if (value === undefined) continue;
      await prisma.appSetting.upsert({
        where: { key },
        create: { key, value: String(value) },
        update: { value: String(value) },
      });
    }
    await writeAudit(req.user!.tenant.id, req.user!.id, "settings.update", body.data);
    res.json(await settingsSnapshot());
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
