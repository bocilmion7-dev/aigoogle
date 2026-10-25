import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { requireUser, requireUserOrPlatform, requirePlatform } from "../middleware/session.js";
import { asyncHandler } from "../asyncHandler.js";
import { parseWaMetaTopups, parseWaSubPlans, WA_TOPUP_RUPIAH_PER_CREDIT } from "../wa/service.js";
import { parseAiSubPlans, parseAiTopupPackages } from "../ai/billing.js";
import { writeAudit } from "../audit.js";

export const settingsRouter = Router();

const PutBody = z
  .object({
    voiceEngine: z.enum(["web-speech", "edge"]).optional(),
    ocrMode: z.enum(["vision", "text"]).optional(),
    waPricePerCredit: z.number().int().min(1).max(1_000_000).optional(),
    /** penyedia WhatsApp: waserver (default) | meta */
    waProvider: z.enum(["meta", "waserver"]).optional(),
    /** 3 paket langganan WhatsApp Gateway */
    waSubPlans: z
      .array(
        z.object({
          id: z.string().min(1).max(20),
          name: z.string().min(1).max(40),
          months: z.number().int().min(1).max(36),
          price: z.number().int().min(1).max(10_000_000),
        })
      )
      .length(3)
      .optional(),
    /** 3 pilihan nominal top up saldo META */
    waMetaTopups: z
      .array(
        z.object({
          id: z.string().min(1).max(20),
          label: z.string().min(1).max(40),
          amount: z.number().int().min(2000).max(10_000_000),
        })
      )
      .length(3)
      .optional(),
    /** paket top up token AI — jumlah dinamis (1–12) */
    aiTopupPackages: z
      .array(
        z.object({
          id: z.string().min(1).max(24),
          price: z.number().int().min(1000).max(10_000_000),
          tokens: z.number().int().min(1000).max(1_000_000_000),
        })
      )
      .min(1)
      .max(12)
      .optional(),
    /** 3 paket langganan AI bulanan */
    aiSubPlans: z
      .array(
        z.object({
          id: z.string().min(1).max(24),
          name: z.string().min(1).max(40),
          months: z.number().int().min(1).max(36),
          price: z.number().int().min(1000).max(10_000_000),
          tokens: z.number().int().min(1000).max(1_000_000_000),
          features: z.array(z.string().min(1).max(80)).max(8),
        })
      )
      .length(3)
      .optional(),
    /** bonus token pendaftaran Accurate (token) */
    aiSignupBonusTokens: z.number().int().min(0).max(1_000_000_000).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "tidak ada field" });

async function settingsSnapshot(includeSecrets: boolean) {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [
          "voiceEngine", "ocrMode", "waPricePerCredit", "waProvider",
          "waSubPlans", "waMetaTopups",
          "aiTopupPackages", "aiSubPlans", "aiSignupBonusTokens",
        ],
      },
    },
  });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const price = Number(get("waPricePerCredit"));
  const rawProvider = get("waProvider");
  const base = {
    voiceEngine: get("voiceEngine") ?? "web-speech",
    ocrMode: get("ocrMode") === "text" ? "text" : "vision",
    waPricePerCredit: Number.isFinite(price) && price >= 1 ? price : WA_TOPUP_RUPIAH_PER_CREDIT,
    waSubPlans: parseWaSubPlans(get("waSubPlans")),
    waMetaTopups: parseWaMetaTopups(get("waMetaTopups")),
    aiTopupPackages: parseAiTopupPackages(get("aiTopupPackages")),
    aiSubPlans: parseAiSubPlans(get("aiSubPlans")),
    aiSignupBonusTokens:
      get("aiSignupBonusTokens") !== undefined ? Math.max(0, Number(get("aiSignupBonusTokens")) || 0) : 250000,
    waProvider: rawProvider === "meta" ? "meta" : "waserver",
    // gateway waserver dikonfigurasi lewat env (infra), bukan DB
    waserverReady: env.WASERVER_URL !== "" && env.WASERVER_API_KEY !== "",
  };
  if (!includeSecrets) return base;
  return {
    ...base,
  };
}

settingsRouter.get(
  "/settings",
  requireUserOrPlatform,
  asyncHandler(async (req, res) => {
    // secret platform (partner key dll) HANYA untuk sesi platform — jangan pernah ke tenant
    res.json(await settingsSnapshot(!!req.platform));
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
      const stored =
        key === "waSubPlans" || key === "waMetaTopups" || key === "aiTopupPackages" || key === "aiSubPlans"
          ? JSON.stringify(value)
          : String(value);
      await prisma.appSetting.upsert({
        where: { key },
        create: { key, value: stored },
        update: { value: stored },
      });
    }
    await writeAudit(
      req.platform ? "platform" : req.user!.tenant.id,
      req.platform?.id ?? req.user!.id,
      "settings.update",
      body.data
    );
    res.json(await settingsSnapshot(true));
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
