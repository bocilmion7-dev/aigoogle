import { Router } from "express";
import { asyncHandler } from "../asyncHandler.js";
import { paymentSettings, verifyWinpayCallback } from "../billing/winpay.js";
import { finalizeWaTopup } from "../wa/service.js";

export const winpayNotifyRouter = Router();

/** Notifikasi pembayaran QRIS Winpay (SNAP qr-mpm-notify). Tanpa sesi — keamanan via signature RSA. */
winpayNotifyRouter.post(
  "/v1.0/qr/qr-mpm-notify",
  asyncHandler(async (req, res) => {
    const cfg = await paymentSettings();
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ref = typeof b.originalPartnerReferenceNo === "string" ? b.originalPartnerReferenceNo : "";
    const trx = typeof b.latestTransactionStatus === "string" ? b.latestTransactionStatus : "";
    if (!ref || !trx) return res.status(400).json({ responseCode: "4004701", responseMessage: "Invalid payload" });

    const path = req.originalUrl.split("?")[0] ?? "";
    const raw = req.rawBody ?? JSON.stringify(req.body);
    const timestamp = String(req.header("x-timestamp") ?? "");
    const signature = String(req.header("x-signature") ?? "");
    if (!verifyWinpayCallback(cfg.winpay.publicKey, "POST", path, raw, timestamp, signature)) {
      console.warn("[winpay] notifikasi signature tidak valid / public key belum diisi:", path);
      return res.status(401).json({ responseCode: "4014700", responseMessage: "Invalid signature" });
    }

    const paid = trx === "00";
    const failed = ["04", "05", "06"].includes(trx);
    if (paid || failed) await finalizeWaTopup(ref, paid, paid ? "settlement" : "cancel", "winpay");
    res.json({ responseCode: "2005200", responseMessage: "Successful" });
  })
);
