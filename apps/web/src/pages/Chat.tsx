import { useEffect, useRef, useState } from "react";
import type { MessageInfo, SessionInfo } from "../chat-api";
import { CHAT_TIMEOUT_MS, isTimeoutError, listMessages, listSessions, streamChat } from "../chat-api";
import { MentionInput } from "../customer-mention";
import { renderRichText } from "../rich-text";
import { VoiceMode } from "../voice-mode";

interface UiMsg {
  role: "user" | "ai";
  content: string;
  /** nama proses berjalan (bukan nama tool) — tampil selagi AI bekerja */
  process?: string;
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
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function loadSessions() {
    try {
      setSessions(await listSessions());
    } catch (e) {
      setLoadErr(isTimeoutError(e) ? "Koneksi lambat — daftar sesi gagal dimuat." : "Gagal memuat daftar sesi.");
    }
  }
  function retryLoads() {
    setLoadErr(null);
    void loadSessions();
    if (sessionId) void openSession(sessionId);
  }

  useEffect(() => {
    void loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function openSession(id: string) {
    setSessionId(id);
    setError(null);
    setLoadErr(null);
    try {
      const history = await listMessages(id);
      setMsgs(history.map((m) => ({ role: m.role as "user" | "ai", content: m.content })));
    } catch (e) {
      setLoadErr(isTimeoutError(e) ? "Koneksi lambat — riwayat percakapan gagal dimuat." : "Gagal memuat riwayat percakapan.");
    }
  }

  async function send(text: string) {
    if (!text.trim() || busy) return;
    // perintah sistem /contoh — balas daftar template tanyaan tanpa memanggil AI
    if (text.trim() === "/contoh") {
      setInput("");
      setMsgs((m) => [
        ...m,
        { role: "user", content: "/contoh" },
        {
          role: "ai",
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
    // indikator tampil SEJAK AWAL (0 dtk) — tanpa ini layar diam ±4 dtk selama LLM turn 1
    setMsgs((m) => [...m, { role: "user", content: text }, { role: "ai", content: "", process: "Menganalisis pertanyaan…" }]);
    setInput("");
    try {
      await streamChat(
        text,
        sessionId,
        (e) => {
          // event "start" membawa sessionId buatan server → simpan;
          // tanpa ini tiap pesan dikirim sessionId=null → server bikin SESI BARU
          // per pesan → riwayat terputus & AI linglung saat balas "ya" dst.
          if (e.type === "start" && e.sessionId) setSessionId(e.sessionId);
          setMsgs((m) => {
            const copy = [...m];
            const last = { ...copy[copy.length - 1] };
            // nama proses (bukan nama tool) — tampil sbg status "thinking"
            if (e.type === "tool_call") last.process = e.label || "Memproses data…";
            // data sudah masuk → ganti status "Menganalisis…" jadi penyusunan jawaban
            // (turn LLM ke-2 bisa ±5 dtk — tanpa teks ini layar terlihat mandeg)
            if (e.type === "tool_result") last.process = e.ok ? "Menyusun jawaban…" : "Mencoba cara lain…";
            // teks mulai mengalir → proses disembunyikan, ganti cursor streaming
            if (e.type === "text_delta" || e.type === "done") last.process = undefined;
            if (e.type === "text_delta") last.content += e.delta;
            if (e.type === "error") setError(e.message);
            copy[copy.length - 1] = last;
            return copy;
          });
          if (e.type === "done") {
            setBusy(false);
            void loadSessions();
          }
        },
        AbortSignal.timeout(CHAT_TIMEOUT_MS)
      );
    } catch (e) {
      // rekam penyebab asli (selama ini dibuang → mustahil mendiagnosis)
      console.error("[chat] stream failed:", e);
      setError(
        isTimeoutError(e)
          ? "Waktu tunggu habis (2 menit) — coba lagi."
          : "Koneksi terputus — coba lagi."
      );
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
              <code>/contoh</code> untuk melihat contoh pertanyaan, atau <code>@</code> untuk memilih
              nama pelanggan.
              </p>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.role === "ai" ? "msg--ai" : ""}`}>
              <strong className="msg__who">{m.role === "user" ? "Anda" : "AI"}</strong>
              <div className="msg__body">
                {renderRichText(m.content)}
                {busy && i === msgs.length - 1 && !m.content && (
                  <span className="thinking" role="status" aria-label={m.process ?? "AI sedang berpikir"}>
                    <span className="thinking__dot" aria-hidden="true" />
                    <span className="thinking__dot" aria-hidden="true" />
                    <span className="thinking__dot" aria-hidden="true" />
                    <span className="thinking__label">{m.process ?? "Berpikir…"}</span>
                  </span>
                )}
                {busy && i === msgs.length - 1 && m.content && !m.process && (
                  <span className="cursor" aria-hidden="true" />
                )}
                {busy && i === msgs.length - 1 && m.content && m.process && (
                  <span className="thinking thinking--line" role="status" aria-label={m.process}>
                    <span className="thinking__dot" aria-hidden="true" />
                    <span className="thinking__dot" aria-hidden="true" />
                    <span className="thinking__dot" aria-hidden="true" />
                    <span className="thinking__label">{m.process}</span>
                  </span>
                )}
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
        {loadErr && (
          <div role="alert" className="banner banner--err" style={{ marginTop: "var(--space-xs)", marginBottom: 0 }}>
            {loadErr} —{" "}
            <button className="btn btn--ghost btn--sm" onClick={retryLoads}>
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
            onSubmit={(t) => void send(t)}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
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
