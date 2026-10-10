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
      if (settings.voiceEngine === "web-speech") {
        const SR = (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognition })
          .webkitSpeechRecognition;
        if (!SR) {
          alert("Browser ini belum mendukung Web Speech — coba Chrome/Edge.");
          return;
        }
        const rec = new SR();
        rec.lang = "id-ID";
        const text = await new Promise<string>((resolve, reject) => {
          rec.onresult = (e) => resolve(e.results[0][0].transcript);
          rec.onerror = () => reject(new Error("stt gagal"));
          rec.start();
        });
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
      style={{
        border: "none",
        borderRadius: 4,
        padding: "8px 12px",
        cursor: "pointer",
        background: listening ? "#a33" : "#eeeae3",
        fontSize: 14,
      }}
      onClick={() => void click()}
      disabled={disabled}
      aria-label="Rekam suara"
    >
      {listening ? "●…" : "🎤"}
    </button>
  );
}
