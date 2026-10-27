import "../app.css";
import { memo, useEffect, useRef, useState } from "react";
import { CHAT_TIMEOUT_MS, isTimeoutError, listMessages, listSessions, streamChat } from "../chat-api";
import { MentionInput } from "../customer-mention";
import { DocCapture } from "../doc-capture";
import { getAiWallet, getMe, notifyAiGate, notifyAiWalletChanged } from "../api";
import { renderRichText } from "../rich-text";
import { VoiceMode } from "../voice-mode";
import { track } from "../telemetry";
import { OnboardingChecklist } from "../onboarding";

interface UiMsg {
  role: "user" | "ai";
  content: string;
  /** nama proses berjalan (bukan nama tool) — tampil selagi AI bekerja */
  process?: string;
}

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
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<UiMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [perms, setPerms] = useState<string[]>([]);
  const [booted, setBooted] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const bootedRef = useRef(false);

  function saveLastSession(id: string | null) {
    try {
      if (id) localStorage.setItem("chat:lastSession", id);
      else localStorage.removeItem("chat:lastSession");
    } catch {
      /* localStorage bisa diblokir (mode privat) — riwayat tetap jalan */
    }
  }

  async function loadSessions(autoOpen = false) {
    try {
      const { sessions: list } = await listSessions(50, 0);
      // saat halaman dimuat: buka percakapan terakhir agar riwayat tidak tampak hilang
      if (autoOpen && !bootedRef.current) {
        bootedRef.current = true;
        let saved: string | null = null;
        try {
          saved = localStorage.getItem("chat:lastSession");
        } catch {
          /* abaikan */
        }
        const pick = list.find((s) => s.id === saved) ?? list[0];
        if (pick) void openSession(pick.id);
        else setBooted(true);
      }
    } catch (e) {
      setBooted(true);
      setLoadErr(isTimeoutError(e) ? "Koneksi lambat — daftar sesi gagal dimuat." : "Gagal memuat daftar sesi.");
    }
  }
  function retryLoads() {
    setLoadErr(null);
    void loadSessions(true);
    if (sessionId) void openSession(sessionId);
  }

  useEffect(() => {
    void getMe()
      .then((m) => setPerms(m?.permissions ?? []))
      .catch(() => null);
    // tampilkan popup akses AI (token habis / langganan-demo habis)
    void getAiWallet()
      .then((w) => {
        if (w.access?.reason === "token") notifyAiGate("token");
      })
      .catch(() => null);
    void loadSessions(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function openSession(id: string) {
    setSessionId(id);
    saveLastSession(id);
    setError(null);
    setLoadErr(null);
    try {
      const history = await listMessages(id);
      setMsgs(history.map((m) => ({ role: m.role as "user" | "ai", content: m.content })));
    } catch (e) {
      setLoadErr(isTimeoutError(e) ? "Koneksi lambat — riwayat percakapan gagal dimuat." : "Gagal memuat riwayat percakapan.");
    } finally {
      setBooted(true);
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
    track("chat_send", { chars: text.length, voice: voiceMode });
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
          if (e.type === "start" && e.sessionId) {
            setSessionId(e.sessionId);
            saveLastSession(e.sessionId);
          }
          if (e.type === "error") {
            if (e.code === "langganan_ai_habis") {
              notifyAiGate("subscription");
              return;
            }
            if (e.code === "saldo_ai_habis" || e.code === "token_ai_habis") {
              notifyAiGate("token");
              return;
            }
          }
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
            notifyAiWalletChanged();
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
            void loadSessions(true);
          }}
        />
      )}
      <section style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        {captureOpen ? (
          <DocCapture
            perms={perms}
            onClose={() => setCaptureOpen(false)}
            onDone={(text) => setMsgs((m) => [...m, { role: "ai", content: text }])}
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
            onClick={() => void send(input)}
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
