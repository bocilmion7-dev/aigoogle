import { useEffect, useRef, useState } from "react";
import { CHAT_TIMEOUT_MS, isTimeoutError, streamChat, type ChatEvent } from "./chat-api";
import { getSettings } from "./api";
import { speakWebAsync, stopSpeak, sttWebSpeech, toSpokenText, ttsEdge } from "./voice";
type Phase = "idle" | "listening" | "thinking" | "speaking";

const HINT: Record<Phase, string> = {
  idle: "Tekan mic lalu bicara",
  listening: "Mendengarkan…",
  thinking: "Memproses…",
  speaking: "Membalas…",
};

/**
 * Mode voice layar penuh (ala ChatGPT voice). Dipicu dari tombol mic di chat.
 * Percakapan memakai sesi chat yg sama — teks & riwayat tetap tersimpan.
 */
export function VoiceMode({
  sessionId,
  setSessionId,
  onExit,
}: {
  sessionId: string | null;
  setSessionId: (id: string) => void;
  onExit: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const busyRef = useRef(false);

  // keluar dari mode: hentikan semua suara & rekaman
  useEffect(() => {
    return () => {
      stopSpeak();
      abortRef.current?.();
    };
  }, []);

  // tombol Esc = keluar
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onExit]);

  async function handleMic() {
    // klik mic saat sedang mendengarkan = berhenti (stt_batal ditelan tanpa error)
    if (phase === "listening") {
      abortRef.current?.();
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    stopSpeak();
    // true selama stream chat berjalan — bedakan error stream dgn error mikrofon/STT
    let inStream = false;
    try {
      setPhase("listening");
      const text = await sttWebSpeech((abort) => {
        abortRef.current = abort;
      });
      if (!text.trim()) {
        setPhase("idle");
        return;
      }
      setPhase("thinking");
      let ai = "";
      inStream = true;
      await streamChat(
        text.trim(),
        sessionId,
        (e: ChatEvent) => {
          if (e.type === "start" && e.sessionId) setSessionId(e.sessionId);
          if (e.type === "text_delta") ai += e.delta;
          if (e.type === "error") setError(e.message);
        },
        AbortSignal.timeout(CHAT_TIMEOUT_MS),
        true
      );
      inStream = false;
      if (!ai) {
        setPhase("idle");
        return;
      }
      setPhase("speaking");
      // suara balasan mengikuti engine yg dipilih (edge = TTS neural server, selain itu Web Speech browser)
      const settings = await getSettings().catch(() => null);
      if (settings?.voiceEngine === "edge") await ttsEdge(toSpokenText(ai)).catch(() => speakWebAsync(ai));
      else await speakWebAsync(ai);
      setPhase("idle");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (inStream) {
        // rekam penyebab asli stream (dulu dibuang → tak bisa didiagnosis)
        console.error("[voice] stream failed:", e);
        setError(
          isTimeoutError(e)
            ? "Waktu tunggu habis (2 menit) — coba lagi."
            : "Koneksi terputus — coba lagi."
        );
      } else if (msg && msg !== "stt_batal" && msg !== "stt_kosong" && msg !== "stt_timeout") {
        setError(
          msg === "stt_mikrofon_ditolak"
            ? "Izin mikrofon ditolak — izinkan di pengaturan browser."
            : msg === "browser_ini_belum_mendukung_web_speech"
              ? "Browser ini belum mendukung Web Speech — coba Chrome atau Edge."
              : "Gagal mendengar — coba lagi."
        );
      }
      setPhase("idle");
    } finally {
      busyRef.current = false;
      abortRef.current = null;
    }
  }

  return (
    <div className="voice-mode" role="dialog" aria-modal="true" aria-label="Mode percakapan suara">
      <button className="voice-mode__exit" onClick={onExit} aria-label="Keluar mode suara" title="Kembali ke chat">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div className="voice-mode__center">
        <div
          className={`voice-mode__orb voice-mode__orb--${phase}`}
          aria-hidden="true"
        >
          <span className="voice-mode__core" />
        </div>
        <p className="voice-mode__hint" aria-live="polite">
          {HINT[phase]}
        </p>
        {error && (
          <p className="voice-mode__error" role="alert">
            {error}
          </p>
        )}
      </div>

      <button
        className={`voice-mode__mic${phase === "listening" ? " voice-mode__mic--live" : ""}`}
        onClick={() => void handleMic()}
        disabled={phase === "thinking" || phase === "speaking"}
        aria-label={phase === "listening" ? "Berhenti mendengarkan" : "Bicara"}
        title={phase === "listening" ? "Klik untuk berhenti" : "Tekan lalu bicara"}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
      </button>
    </div>
  );
}
