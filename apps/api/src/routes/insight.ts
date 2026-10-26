import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { getInsightForTenant } from "../wawasan/digest.js";
import { askInsight, ASK_DAILY_LIMIT } from "../wawasan/ask.js";

export const insightRouter = Router();

/** Feed harian (read-only) — hanya membaca digest yang dibangun sekali per hari. */
insightRouter.get(
  "/insight",
  requireUser,
  asyncHandler(async (req, res) => {
    const payload = await getInsightForTenant(req.user!.tenant.id);
    res.json(payload);
  })
);

/** Search bar → tanya AI (bukan mesin pencari), jawaban wajib bersumber. */
insightRouter.post(
  "/insight/ask",
  rateLimit({ name: "insight-ask", windowMs: 60_000, max: 8 }),
  requireUser,
  asyncHandler(async (req, res) => {
    const body = z.object({ question: z.string().trim().min(3).max(300) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    try {
      const out = await askInsight(req.user!.tenant.id, req.user!.id, body.data.question);
      res.json(out);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "ask_limit") {
        return res.status(429).json({
          error: "batas_harian",
          message: `Batas ${ASK_DAILY_LIMIT} pertanyaan per hari tercapai. Coba lagi besok.`,
        });
      }
      console.warn("[insight] gagal menjawab:", e instanceof Error ? e.message.slice(0, 160) : e);
      return res.status(502).json({
        error: "gagal_menjawab",
        message: "Maaf, sedang tidak bisa menjawab. Coba lagi sebentar.",
      });
    }
  })
);
