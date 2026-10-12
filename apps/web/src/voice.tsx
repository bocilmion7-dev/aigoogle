import { useState } from "react";
import { getSettings } from "./api";

export async function sttGemini(audio: Blob): Promise<string> {
  const res = await fetch("/api/stt", { method: "POST", body: audio });
  if (!res.ok) throw new Error("gagal transkripsi");
  const j = (await res.json()) as { text: string };
  return j.text;
}

export async function ttsGemini(text: string): Promise<void> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error("gagal sintesis suara");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  await audio.play();
}

export async function ttsEdge(text: string): Promise<void> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, engine: "edge" }),
  });
  if (!res.ok) throw new Error("gagal sintesis suara Edge");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  await audio.play();
}

/** STT via Web Speech (browser) — di Edge diproses Microsoft, tidak dikirim ke Gemini. */
export async function sttWebSpeech(): Promise<string> {
  const SR = (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognition })
    .webkitSpeechRecognition;
  if (!SR) throw new Error("browser_ini_belum_mendukung_web_speech");
  const rec = new SR();
  rec.lang = "id-ID";
  return new Promise<string>((resolve, reject) => {
    rec.onresult = (e) => resolve(e.results[0][0].transcript);
    rec.onerror = () => reject(new Error("stt gagal"));
    rec.start();
  });
}

export function speakWeb(text: string): void {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "id-ID";
  window.speechSynthesis.speak(u);
}

export function MicButton({ onText, disabled }: { onText: (t: string) => void; disabled?: boolean }) {
  const [listening, setListening] = useState(false);

  async function click() {
    if (listening) return;
    const settings = await getSettings();
    setListening(true);
    try {
      if (settings.voiceEngine === "web-speech" || settings.voiceEngine === "edge") {
        const text = await sttWebSpeech();
        onText(text);
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
        const chunks: BlobPart[] = [];
        rec.ondataavailable = (e) => chunks.push(e.data);
        const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
        rec.start();
        alert("Bicara sekarang… OK untuk berhenti.");
        rec.stop();
        await done;
        stream.getTracks().forEach((t) => t.stop());
        const text = await sttGemini(new Blob(chunks, { type: "audio/webm" }));
        onText(text);
      }
    } finally {
      setListening(false);
    }
  }

  return (
    <button
      className="btn btn--2"
      style={listening ? { background: "var(--danger)", borderColor: "var(--danger)", color: "#fff" } : undefined}
      onClick={() => void click()}
      disabled={disabled}
      aria-label="Rekam suara"
      title="Rekam suara"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="22" />
      </svg>
      {listening ? "●…" : ""}
    </button>
  );
}
