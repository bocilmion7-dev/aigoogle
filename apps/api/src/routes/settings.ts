import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { requireUser, requireUserOrPlatform, requirePlatform } from "../middleware/session.js";
import { loadPermissionSet } from "../permissions.js";
import { WINPAY_DEFAULT_CLIENT_ID } from "@aigoogle/shared";
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
    /** kredensial PARTNER 360dialog — utk Connect Button + generate API key klien */
    waD360PartnerId: z.string().max(100).optional(),
    waD360PartnerKey: z.string().max(200).optional(),
    /** penyedia pembayaran QRIS: winpay (default) | midtrans */
    paymentProvider: z.enum(["winpay", "midtrans"]).optional(),
    winpayEnv: z.enum(["production", "sandbox"]).optional(),
    winpayClientId: z.string().max(100).optional(),
    winpayPrivateKey: z.string().max(20000).optional(),
    winpayPublicKey: z.string().max(20000).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "tidak ada field" });

const D360_DEFAULT_BASE = "https://waba-v2.360dialog.io";

async function settingsSnapshot(includeSecrets: boolean) {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [
          "voiceEngine", "ocrMode", "waPricePerCredit", "waProvider",
          "waD360ApiKey", "waD360BaseUrl", "waD360PartnerId", "waD360PartnerKey",
          "paymentProvider", "winpayEnv", "winpayClientId", "winpayPrivateKey", "winpayPublicKey",
        ],
      },
    },
  });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const price = Number(get("waPricePerCredit"));
  const base = {
    voiceEngine: get("voiceEngine") ?? "web-speech",
    ocrMode: get("ocrMode") === "text" ? "text" : "vision",
    waPricePerCredit: Number.isFinite(price) && price >= 1 ? price : WA_TOPUP_RUPIAH_PER_CREDIT,
    waProvider: get("waProvider") === "meta" ? "meta" : "d360",
    paymentProvider: get("paymentProvider") === "midtrans" ? "midtrans" : "winpay",
    winpayEnv: get("winpayEnv") === "sandbox" ? "sandbox" : "production",
  };
  if (!includeSecrets) return base;
  return {
    ...base,
    waD360ApiKey: get("waD360ApiKey") ?? "",
    waD360BaseUrl: get("waD360BaseUrl") ?? D360_DEFAULT_BASE,
    waD360PartnerId: get("waD360PartnerId") ?? "",
    waD360PartnerKey: get("waD360PartnerKey") ?? "",
    winpayClientId: get("winpayClientId") || WINPAY_DEFAULT_CLIENT_ID,
    winpayPrivateKey: get("winpayPrivateKey") ?? "",
    winpayPublicKey: get("winpayPublicKey") ?? "",
  };
}

// Daftarkan redirect URL Integrated Onboarding ke halaman WhatsApp (prasyarat Connect Button)
settingsRouter.post(
  "/settings/d360-redirect",
  requirePlatform,
  asyncHandler(async (req, res) => {
    const partnerId = (await prisma.appSetting.findUnique({ where: { key: "waD360PartnerId" } }))?.value ?? "";
    const partnerKey = (await prisma.appSetting.findUnique({ where: { key: "waD360PartnerKey" } }))?.value ?? "";
    if (!partnerId || !partnerKey) return res.status(409).json({ error: "partner_id_key_belum_diisi" });
    const origin = env.APP_ORIGIN.replace(/\/$/, "");
    const redirect = `${origin}/whatsapp`;
    const r = await fetch(`https://hub.360dialog.io/api/v2/partners/${encodeURIComponent(partnerId)}`, {
      method: "PATCH",
      headers: { "X-API-Key": partnerKey, "Content-Type": "application/json" },
      body: JSON.stringify({ partner_redirect_url: redirect }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return res.status(502).json({ error: `d360_${r.status}:${t.slice(0, 200)}` });
    }
    await writeAudit("platform", req.platform!.id, "settings.d360_redirect", { redirect });
    res.json({ ok: true, redirect });
  })
);

settingsRouter.get(
  "/settings",
  requireUserOrPlatform,
  asyncHandler(async (req, res) => {
    const includeSecrets =
      !!req.platform ||
      (!!req.user && (await loadPermissionSet(req.user.roleId)).has("app:settings.manage"));
    res.json(await settingsSnapshot(includeSecrets));
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
