import "../app.css";
import { memo, useEffect, useRef, useState } from "react";
import { MentionInput } from "../customer-mention";
import { DocCapture } from "../doc-capture";
import { getAiWallet, getMe, notifyAiGate } from "../api";
import { renderRichText } from "../rich-text";
import { VoiceMode } from "../voice-mode";
import { OnboardingChecklist } from "../onboarding";
import { dismissChatNotice } from "../chat-notify";
import {
  appendChatMessage,
  bootChat,
  retryChatLoads,
  sendChat,
  setChatSessionId,
  useChatStore,
  type UiMsg,
} from "../chat-store";

/**
 * Baris pesan di-memo: saat streaming, hanya pesan terakhir yang berubah.
 * Tanpa ini seluruh riwayat (dan parser tabel) dirender ulang tiap delta.
 */
const MessageRow = memo(function MessageRow({
  m,
  isLast,
  busy,
}: {
  m: UiMsg;
  isLast: boolean;
  busy: boolean;
}) {
  return (
    <div className={`msg ${m.role === "ai" ? "msg--ai" : ""}`}>
      <strong className="msg__who">{m.role === "user" ? "Anda" : "AI"}</strong>
      <div className="msg__body">
        {renderRichText(m.content)}
        {busy && isLast && !m.content && (
          <span className="thinking" role="status" aria-label={m.process ?? "AI sedang berpikir"}>
            <span className="thinking__dot" aria-hidden="true" />
            <span className="thinking__dot" aria-hidden="true" />
            <span className="thinking__dot" aria-hidden="true" />
            <span className="thinking__label">{m.process ?? "Berpikir…"}</span>
          </span>
        )}
        {busy && isLast && m.content && !m.process && <span className="cursor" aria-hidden="true" />}
        {busy && isLast && m.content && m.process && (
          <span className="thinking thinking--line" role="status" aria-label={m.process}>
            <span className="thinking__dot" aria-hidden="true" />
            <span className="thinking__dot" aria-hidden="true" />
            <span className="thinking__dot" aria-hidden="true" />
            <span className="thinking__label">{m.process}</span>
          </span>
        )}
      </div>
    </div>
  );
});

export function Chat() {
  const { sessionId, msgs, busy, error, loadErr, booted } = useChatStore();
  const [input, setInput] = useState("");
  const [composerFocused, setComposerFocused] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [perms, setPerms] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dismissChatNotice();
    void getMe()
      .then((m) => setPerms(m?.permissions ?? []))
      .catch(() => null);
    // tampilkan popup akses AI (token habis / langganan-demo habis)
    void getAiWallet()
      .then((w) => {
        if (w.access?.reason === "token") notifyAiGate("token");
      })
      .catch(() => null);
    void bootChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  function submit(text: string): void {
    if (!text.trim() || busy) return;
    setInput("");
    void sendChat(text, { voice: voiceMode });
  }

  function retrySend(): void {
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    void sendChat(input || lastUser?.content || "", { voice: voiceMode });
  }

  return (
    <div className="chat">
      {voiceMode && (
        <VoiceMode
          sessionId={sessionId}
          setSessionId={setChatSessionId}
          onExit={() => {
            setVoiceMode(false);
            retryChatLoads();
          }}
        />
      )}
      <section style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        {captureOpen ? (
          <DocCapture
            perms={perms}
            onClose={() => setCaptureOpen(false)}
            onDone={appendChatMessage}
          />
        ) : (
          <>
        <div
          role="log"
          aria-live="polite"
          aria-label="Transkrip percakapan"
          className="chat-log"
        >
          {msgs.length === 0 && booted && (
            <div className="empty" style={{ padding: "var(--space-l) 0" }}>
              <OnboardingChecklist />
              <p style={{ color: "var(--ink-2)", fontSize: "var(--step-0)" }}>
              Tanya data akuntansi Anda — ketik atau pakai mic. Ketik{" "}
              <code>/contoh</code> untuk melihat contoh pertanyaan, atau <code>@</code> untuk memilih
              nama pelanggan.
              </p>
            </div>
          )}
          {msgs.map((m, i) => {
            const isLast = i === msgs.length - 1;
            return <MessageRow key={i} m={m} isLast={isLast} busy={busy && isLast} />;
          })}
          <div ref={bottomRef} />
        </div>
        {error && (
          <div role="alert" className="banner banner--err" style={{ marginTop: "var(--space-xs)", marginBottom: 0 }}>
            {error} —{" "}
            <button
              className="btn btn--ghost btn--sm"
              onClick={retrySend}
            >
              Coba lagi
            </button>
          </div>
        )}
        {loadErr && (
          <div role="alert" className="banner banner--err" style={{ marginTop: "var(--space-xs)", marginBottom: 0 }}>
            {loadErr} —{" "}
            <button className="btn btn--ghost btn--sm" onClick={retryChatLoads}>
              Coba lagi
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => window.location.reload()}>
              Muat ulang
            </button>
          </div>
        )}
        <div className={`composer${composerFocused ? " composer--focus" : ""}`}>
          <MentionInput
            className="input"
            value={input}
            onChange={setInput}
            onSubmit={submit}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
          />
          <span className="composer__mic">
            <button
              className="btn btn--2"
              onClick={() => setCaptureOpen(true)}
              disabled={busy}
              aria-label="Lampiran dokumen"
              title="Lampiran dokumen (browse file, foto, kamera)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21.4 11.6l-8.4 8.4a6 6 0 0 1-8.5-8.5l8.4-8.4a4 4 0 0 1 5.7 5.7l-8.4 8.4a2 2 0 0 1-2.8-2.8l7.8-7.8" />
              </svg>
            </button>
          </span>
          <span className="composer__mic">
            <button
              className="btn btn--2"
              onClick={() => setVoiceMode(true)}
              disabled={busy}
              aria-label="Buka mode suara"
              title="Buka mode suara"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            </button>
          </span>
          <button
            className="btn composer__send"
            onClick={() => submit(input)}
            disabled={busy}
            aria-label="Kirim pesan"
            aria-busy={busy}
            title="Kirim (Enter) · Shift+Enter baris baru"
          >
            {busy ? (
              <span className="composer__send-dots" aria-hidden="true">
                <span className="thinking__dot" />
                <span className="thinking__dot" />
                <span className="thinking__dot" />
              </span>
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M22 2 11 13" />
                <path d="M22 2 15 22 11 13 2 9z" />
              </svg>
            )}
          </button>
        </div>
          </>
        )}
      </section>
    </div>
  );
}
