import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
);
const KEY = env.GEMINI_API_KEY;
if (!KEY) { console.error("GEMINI_API_KEY kosong di .env"); process.exit(1); }

// Kandidat model TTS (generateContent REST). Live/native-audio dialog (WS) diuji di Fase 2.
const MODELS = process.argv[2] ? [process.argv[2]] : [
  "gemini-3.8-flash-tts",
  "gemini-2.5-flash-preview-tts",
];

const PROMPTS = [
  "Halo, saya asisten akuntansi Anda. Ada yang bisa saya bantu hari ini?",
  "Total penjualan PT Maju Jaya bulan Oktober adalah dua juta lima ratus ribu rupiah.",
];

const outDir = new URL("../docs/spikes/samples/", import.meta.url);
mkdirSync(outDir, { recursive: true });

for (const model of MODELS) {
  for (const [i, prompt] of PROMPTS.entries()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      },
    };
    const t0 = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const ms = Date.now() - t0;
    const json = await res.json();
    if (!res.ok) {
      console.log(`[${model}] #${i} GAGAL ${res.status}: ${json.error?.message ?? "?"}`);
      continue;
    }
    const part = json.candidates?.[0]?.content?.parts?.[0];
    const audio = part?.inlineData?.data;
    if (audio) {
      const mime = part.inlineData.mimeType ?? "audio/wav";
      const ext = mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : mime.includes("flac") ? "flac" : "wav";
      const file = new URL(`${model}-${i}.${ext}`, outDir);
      writeFileSync(file, Buffer.from(audio, "base64"));
      console.log(`[${model}] #${i} OK audio ${mime} ${ms}ms → ${file.pathname}`);
    } else {
      console.log(`[${model}] #${i} TANPA audio (${ms}ms): ${JSON.stringify(part ?? json).slice(0, 300)}`);
    }
  }
}
