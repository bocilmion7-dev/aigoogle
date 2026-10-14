import { Router } from "express";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";

export const audioRouter = Router();

/** TTS neural Edge (gratis) — STT memakai Web Speech di browser. */
audioRouter.post(
  "/tts",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = req.body as { text?: string };
    if (!body?.text || typeof body.text !== "string" || body.text.length === 0 || body.text.length > 2000) {
      return res.status(400).json({ error: "bad_request" });
    }
    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata("id-ID-GadisNeural", OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    } catch {
      // 403 dari Microsoft (IP datacenter diblokir) / jaringan bermasalah
      return res.status(502).json({ error: "edge_tts_gagal" });
    }
    const { audioStream } = tts.toStream(body.text);
    res.setHeader("Content-Type", "audio/mpeg");
    audioStream.on("error", () => {
      if (!res.headersSent) res.status(502).json({ error: "edge_tts_gagal" });
      else res.destroy();
    });
    audioStream.pipe(res);
  })
);
