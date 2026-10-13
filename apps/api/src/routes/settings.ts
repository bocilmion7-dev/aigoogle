import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireUser } from "../middleware/session.js";
import { requirePlatform } from "../middleware/session.js";
import { asyncHandler } from "../asyncHandler.js";
import { WA_TOPUP_RUPIAH_PER_CREDIT } from "../wa/service.js";
import { writeAudit } from "../audit.js";

export const settingsRouter = Router();

const PutBody = z
  .object({
    voiceEngine: z.enum(["gemini-native", "web-speech", "edge"]).optional(),
    ocrMode: z.enum(["vision", "text"]).optional(),
    waPricePerCredit: z.number().int().min(1).max(1_000_000).optional(),
    /** penyedia WhatsApp utk embedded signup: meta | d360 (default d360) */
    waProvider: z.enum(["meta", "d360"]).optional(),
    waD360ApiKey: z.string().max(200).optional(),
    waD360BaseUrl: z.string().url().max(200).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "tidak ada field" });

const D360_DEFAULT_BASE = "https://waba-v2.360dialog.io";

async function settingsSnapshot() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ["voiceEngine", "ocrMode", "waPricePerCredit", "waProvider", "waD360ApiKey", "waD360BaseUrl"] } },
  });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const price = Number(get("waPricePerCredit"));
  return {
    voiceEngine: get("voiceEngine") ?? "web-speech",
    ocrMode: get("ocrMode") === "text" ? "text" : "vision",
    waPricePerCredit: Number.isFinite(price) && price >= 1 ? price : WA_TOPUP_RUPIAH_PER_CREDIT,
    waProvider: get("waProvider") === "meta" ? "meta" : "d360",
    waD360ApiKey: get("waD360ApiKey") ?? "",
    waD360BaseUrl: get("waD360BaseUrl") ?? D360_DEFAULT_BASE,
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
  requirePlatform,
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
    await writeAudit(
      req.platform ? "platform" : req.user!.tenant.id,
      req.platform?.id ?? req.user!.id,
      "settings.update",
      body.data
    );
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
