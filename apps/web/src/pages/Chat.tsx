import { useEffect, useRef, useState } from "react";
import type { MessageInfo, SessionInfo } from "../chat-api";
import { listMessages, listSessions, streamChat } from "../chat-api";
import { getSettings } from "../api";
import { MicButton, speakWeb, ttsEdge, ttsGemini } from "../voice";
import { IconPlus } from "../icons";

interface UiMsg {
  role: "user" | "ai";
  content: string;
  badges: string[];
}

const SUGGESTED = [
  "Berapa total penjualan bulan ini?",
  "Siapa saja pelanggan saya?",
  "Rincikan penjualan per pelanggan",
];

export function Chat() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<UiMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setBusy(true);
    setError(null);
    setMsgs((m) => [...m, { role: "user", content: text, badges: [] }, { role: "ai", content: "", badges: [] }]);
    setInput("");
    let aiText = "";
    try {
      await streamChat(text, sessionId, (e) => {
        if (e.type === "text_delta") aiText += e.delta;
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
      if (aiText) {
        const settings = await getSettings();
        if (settings.voiceEngine === "gemini-native") void ttsGemini(aiText).catch(() => {});
        else if (settings.voiceEngine === "edge") void ttsEdge(aiText).catch(() => {});
        else speakWeb(aiText);
      }
    } catch {
      setError("Koneksi terputus — coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat">
      <aside aria-label="Riwayat percakapan">
        <div className="chat-sessions">
          <button
            className="session session--new"
            aria-current={sessionId === null ? "true" : undefined}
            aria-label="Percakapan baru"
            title="Percakapan baru"
            onClick={() => { setSessionId(null); setMsgs([]); }}
          >
            <IconPlus size={14} /> Baru
          </button>
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
                Tanya data akuntansi Anda — ketik atau pakai mic.
              </p>
              <div className="btn-row" style={{ justifyContent: "flex-start" }}>
                {SUGGESTED.map((s) => (
                  <button key={s} className="btn btn--2 btn--sm" onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
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
                {busy && i === msgs.length - 1 ? " ▌" : ""}
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
        <div className="composer">
          <input
            className="input"
            aria-label="Tanya data akuntansi"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void send(input)}
            placeholder="Tanya sesuatu…"
          />
          <MicButton onText={(t) => void send(t)} disabled={busy} />
          <button className="btn" onClick={() => void send(input)} disabled={busy}>
            {busy ? "…" : "Kirim"}
          </button>
        </div>
      </section>
    </div>
  );
}
