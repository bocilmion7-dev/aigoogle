import { Router } from "express";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { analyzeTenant } from "./index.js";

export const analisaRouter = Router();

/** Analisis bisnis per tenant — seluruh data dari Accurate. */
analisaRouter.get(
  "/analisa",
  requireUser,
  asyncHandler(async (req, res) => {
    const fresh = req.query.fresh === "1" || req.query.fresh === "true";
    const result = await analyzeTenant(req.user!.tenant.id, { fresh });
    if ("error" in result) {
      const code = result.error === "belum_connect" ? 409 : 500;
      return res.status(code).json({ error: result.error });
    }
    res.json(result);
  })
);
