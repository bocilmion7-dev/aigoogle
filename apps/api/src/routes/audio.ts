import { Router } from "express";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";

export const audioRouter = Router();

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&apos;").replace(/"/g, "&quot;");
}

/**
 * Azure Speech TTS — API resmi Microsoft (free tier F0 ±500rb karakter/bulan).
 * Aktif otomatis bila AZURE_SPEECH_KEY + AZURE_SPEECH_REGION terisi di .env;
 * voice id sama dengan Edge (id-ID-GadisNeural), format mp3 24khz.
 */
async function azureTts(text: string): Promise<Buffer> {
  const key = process.env.AZURE_SPEECH_KEY?.trim();
  const region = process.env.AZURE_SPEECH_REGION?.trim();
  if (!key || !region) throw new Error("azure_tts_belum_dikonfigurasi");
  const ssml = `<speak version='1.0' xml:lang='id-ID'><voice name='id-ID-GadisNeural'>${escapeXml(text)}</voice></speak>`;
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
      "User-Agent": "aigoogle-tts",
    },
    body: ssml,
  });
  if (!res.ok) throw new Error(`azure_tts_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("azure_tts_kosong");
  return buf;
}

/** Edge (msedge-tts) — sering 403 dari IP datacenter (Microsoft blokir); gagal → engine berikut. */
async function edgeTts(text: string): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata("id-ID-GadisNeural", OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => reject(new Error("edge_timeout")), 15_000);
    audioStream.on("data", (c: Buffer) => chunks.push(c));
    audioStream.on("end", () => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) reject(new Error("edge_kosong"));
      else resolve(buf);
    });
    audioStream.on("error", (e: unknown) => {
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error("edge_error"));
    });
  });
}

// Google Translate TTS — fallback terakhir (gratis, tanpa key).
// q dibatasi ±180 karakter; potong di batas kalimat, gabungkan frame MP3-nya.
async function googleTts(text: string): Promise<Buffer> {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 180) {
    const window = rest.slice(0, 181);
    const sent = [".", "?", "!"].map((s) => window.lastIndexOf(s) + 1).reduce((a, b) => Math.max(a, b), 0);
    const comma = window.lastIndexOf(",") + 1;
    const space = window.lastIndexOf(" ") + 1;
    const cut = sent || comma || space || 180;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  chunks.push(rest);
  const parts: Buffer[] = [];
  for (const c of chunks) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=id&client=tw-ob&q=${encodeURIComponent(c)}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`google_tts_${res.status}`);
    parts.push(Buffer.from(await res.arrayBuffer()));
  }
  return Buffer.concat(parts);
}

/**
 * TTS suara server — urutan: Azure (API resmi, bila key terisi) → Edge → Google.
 * STT tetap Web Speech di browser. Engine aktif dilaporkan via header X-TTS-Engine.
 */
audioRouter.post(
  "/tts",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = req.body as { text?: string };
    if (!body?.text || typeof body.text !== "string" || body.text.length === 0 || body.text.length > 2000) {
      return res.status(400).json({ error: "bad_request" });
    }
    const text = body.text;
    const engines: Array<[string, () => Promise<Buffer>]> = [
      ["azure", () => azureTts(text)],
      ["edge", () => edgeTts(text)],
      ["google", () => googleTts(text)],
    ];
    for (const [engine, run] of engines) {
      try {
        const audio = await run();
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("X-TTS-Engine", engine);
        return res.send(audio);
      } catch {
        /* engine gagal → coba engine berikut */
      }
    }
    // semua engine gagal (Edge 403 Microsoft + Google tak terjangkau/terblokir)
    return res.status(502).json({ error: "edge_tts_gagal" });
  })
);
