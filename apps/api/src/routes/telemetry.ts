import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { countEvent, recordWebVital } from "../metrics.js";

export const telemetryRouter = Router();

const Body = z.object({
  event: z.string().min(1).max(80),
  props: z.record(z.string(), z.unknown()).optional(),
  webVital: z.object({ name: z.string().min(1).max(20), value: z.number() }).optional(),
});

/** Telemetri ringan (Web Vitals + event produk) — tanpa PII, disimpan in-process. */
telemetryRouter.post(
  "/telemetry",
  rateLimit({ name: "telemetry", windowMs: 60_000, max: 120 }),
  asyncHandler(async (req, res) => {
    const body = Body.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    if (body.data.webVital) recordWebVital(body.data.webVital.name, body.data.webVital.value);
    countEvent(`fe:${body.data.event}`);
    res.status(204).end();
  })
);
