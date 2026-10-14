import { useEffect, useRef, useState } from "react";
import type { MessageInfo, SessionInfo } from "../chat-api";
import { listMessages, listSessions, streamChat } from "../chat-api";
import { VoiceMode } from "../voice-mode";

interface UiMsg {
  role: "user" | "ai";
  content: string;
  badges: string[];
}

// daftar contoh — dibalas sistem saat pengguna mengetik /contoh (tanpa AI)
const CONTOH_TANYAAN = [
  "Berapa total penjualan bulan ini?",
  "Berapa total pembelian bulan ini?",
  "Siapa saja pelanggan saya?",
  "Siapa saja pemasok saya?",
  "Rincikan penjualan per pelanggan",
  "Berapa piutang yang belum tertagih?",
  "Berapa utang yang belum dibayar?",
  "Barang apa yang paling laris bulan ini?",
  "Stok barang apa yang menipis?",
  "Berapa laba kotor bulan ini?",
];

export function Chat() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<UiMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void listSessions().then(setSessions);
  }, []);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function openSession(id: string) {
    setSessionId(id);
    setError(null);
    const history = await listMessages(id);
    setMsgs(history.map((m) => ({ role: m.role as "user" | "ai", content: m.content, badges: [] })));
  }

  async function send(text: string) {
    if (!text.trim() || busy) return;
    // perintah sistem /contoh — balas daftar template tanyaan tanpa memanggil AI
    if (text.trim() === "/contoh") {
      setInput("");
      setMsgs((m) => [
        ...m,
        { role: "user", content: "/contoh", badges: [] },
        {
          role: "ai",
          badges: [],
          content:
            "Contoh pertanyaan yang bisa Anda tanyakan:\n" +
            CONTOH_TANYAAN.map((q, i) => `${i + 1}. ${q}`).join("\n") +
            "\n\nKetik salah satunya di kolom bawah — atau tekan mic dan ucapkan.",
        },
      ]);
      return;
    }
    setBusy(true);
    setError(null);
    setMsgs((m) => [...m, { role: "user", content: text, badges: [] }, { role: "ai", content: "", badges: [] }]);
    setInput("");
    try {
      await streamChat(text, sessionId, (e) => {
        setMsgs((m) => {
          const copy = [...m];
          const last = { ...copy[copy.length - 1] };
          if (e.type === "tool_call") last.badges = [...last.badges, e.label ?? e.tool];
          if (e.type === "tool_result" && !e.ok) last.badges = [...last.badges, "Ditolak/gagal"];
          if (e.type === "text_delta") last.content += e.delta;
          if (e.type === "error") setError(e.message);
          copy[copy.length - 1] = last;
          return copy;
        });
        if (e.type === "done") {
          setBusy(false);
          void listSessions().then(setSessions);
        }
      });
    } catch {
      setError("Koneksi terputus — coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat">
      {voiceMode && (
        <VoiceMode
          sessionId={sessionId}
          setSessionId={setSessionId}
          onExit={() => {
            setVoiceMode(false);
            void listSessions().then(setSessions);
          }}
        />
      )}
      <aside aria-label="Riwayat percakapan">
        <div className="chat-sessions">
          {sessions.map((s) => (
            <button
              key={s.id}
              className="session"
              aria-current={sessionId === s.id ? "true" : undefined}
              onClick={() => void openSession(s.id)}
            >
              {s.title.slice(0, 28)}
            </button>
          ))}
        </div>
      </aside>

      <section style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div
          role="log"
          aria-live="polite"
          aria-label="Transkrip percakapan"
          className="chat-log"
        >
          {msgs.length === 0 && (
            <div className="empty" style={{ padding: "var(--space-l) 0" }}>
              <p style={{ color: "var(--ink-2)", fontSize: "var(--step-0)" }}>
                Tanya data akuntansi Anda — ketik atau pakai mic. Ketik{" "}
                <code>/contoh</code> untuk melihat contoh pertanyaan.
              </p>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.role === "ai" ? "msg--ai" : ""}`}>
              <strong className="msg__who">{m.role === "user" ? "Anda" : "AI"}</strong>
              {m.badges.map((b, bi) => (
                <span key={bi} className="badge" style={{ marginLeft: 8 }}>
                  {b}
                </span>
              ))}
              <div className="msg__body">
                {m.content}
                {busy && i === msgs.length - 1 && !m.content && (
                  <span className="thinking" role="status" aria-label="AI sedang berpikir">
                    <span className="thinking__dot" />
                    <span className="thinking__dot" />
                    <span className="thinking__dot" />
                  </span>
                )}
                {busy && i === msgs.length - 1 && m.content ? " ▌" : ""}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        {error && (
          <div role="alert" className="banner banner--err" style={{ marginTop: "var(--space-xs)", marginBottom: 0 }}>
            {error} —{" "}
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => void send(input || msgs[msgs.length - 2]?.content || "")}
            >
              Coba lagi
            </button>
          </div>
        )}
        <div className={`composer${composerFocused ? " composer--focus" : ""}`}>
          <input
            className="input"
            aria-label="Tanya data akuntansi"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !input.trim()) return;
              void send(input);
              (e.target as HTMLInputElement).blur(); // Enter-kirim: composer kembali ke ukuran semula
            }}
            placeholder="Tanya sesuatu…"
          />
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
          <button className="btn" onClick={() => void send(input)} disabled={busy}>
            {busy ? "…" : "Kirim"}
          </button>
        </div>
      </section>
    </div>
  );
}
