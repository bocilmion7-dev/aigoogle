import { Router } from "express";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { env } from "../env.js";
import { asyncHandler } from "../asyncHandler.js";
import { RealGeminiClient, GeminiHttpError } from "../ai/gemini-client.js";

export const audioRouter = Router();

function real(): RealGeminiClient {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.length < 10) {
    throw new GeminiHttpError(503, "GEMINI_API_KEY belum diisi/tidak valid");
  }
  return new RealGeminiClient(process.env.GEMINI_API_KEY);
}

audioRouter.post(
  "/stt",
  asyncHandler(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req as AsyncIterable<Buffer>) chunks.push(c);
    const audio = Buffer.concat(chunks);
    if (audio.length === 0) return res.status(400).json({ error: "audio kosong" });
    const mime = String(req.headers["content-type"] ?? "audio/webm").split(";")[0];
    const client = real();
    const gen = client.generateStream({
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: mime, data: audio.toString("base64") } },
            { text: "Transkrip audio ini persis, tanpa tambahan. Bila hening, balas kosong." },
          ],
        },
      ],
      model: env.GEMINI_TRANSCRIBE_MODEL,
    });
    let text = "";
    for await (const p of gen) if (p.text) text += p.text;
    res.json({ text: text.trim() });
  })
);

audioRouter.post(
  "/tts",
  asyncHandler(async (req, res) => {
    const body = req.body as { text?: string; engine?: string };
    if (!body?.text || typeof body.text !== "string" || body.text.length === 0 || body.text.length > 2000) {
      return res.status(400).json({ error: "bad_request" });
    }
    if (body.engine === "edge") {
      const tts = new MsEdgeTTS();
      await tts.setMetadata("id-ID-GadisNeural", OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(body.text);
      res.setHeader("Content-Type", "audio/mpeg");
      audioStream.on("error", () => {
        if (!res.headersSent) res.status(502).json({ error: "edge_tts_gagal" });
        else res.destroy();
      });
      audioStream.pipe(res);
      return;
    }
    const client = real();
    const { parts } = await client.generate({
      contents: [{ role: "user", parts: [{ text: body.text }] }],
      responseModalities: ["AUDIO"],
      model: env.GEMINI_TTS_MODEL,
    });
    const audio = parts.find((p) => p.inlineData?.mimeType.startsWith("audio/"));
    if (!audio?.inlineData) throw new Error("tts tidak mengembalikan audio");
    const buf = Buffer.from(audio.inlineData.data, "base64");
    res.setHeader("Content-Type", audio.inlineData.mimeType || "audio/wav");
    res.send(buf);
  })
);
