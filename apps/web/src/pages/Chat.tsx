import { useEffect, useRef, useState } from "react";
import type { MessageInfo, SessionInfo } from "../chat-api";
import { listMessages, listSessions, streamChat } from "../chat-api";
import { getSettings } from "../api";
import { MicButton, speakWeb, ttsGemini } from "../voice";

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
        else speakWeb(aiText);
      }
    } catch {
      setError("Koneksi terputus — coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 16, maxWidth: 960, margin: "0 auto", padding: 16, fontFamily: "system-ui" }}>
      <aside style={{ width: 200, flexShrink: 0 }}>
        <button style={btn} onClick={() => { setSessionId(null); setMsgs([]); }}>
          + Percakapan baru
        </button>
        <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                style={{
                  ...btn,
                  background: sessionId === s.id ? "#3d6b54" : "#eeeae3",
                  color: sessionId === s.id ? "#fff" : "#333",
                  width: "100%",
                  textAlign: "left",
                  marginBottom: 6,
                }}
                onClick={() => void openSession(s.id)}
              >
                {s.title.slice(0, 28)}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 420 }}>
        <div
          style={{
            flex: 1,
            background: "#faf8f5",
            border: "1px solid #e3ddd4",
            borderRadius: 6,
            padding: 16,
            overflowY: "auto",
          }}
        >
          {msgs.length === 0 && (
            <div>
              <p style={{ color: "#555" }}>Tanya data akuntansi Anda — ketik atau pakai mic.</p>
              {SUGGESTED.map((s) => (
                <button
                  key={s}
                  style={{ ...btn, background: "#eeeae3", color: "#333", marginRight: 8, marginBottom: 8 }}
                  onClick={() => void send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <strong style={{ color: m.role === "user" ? "#3d6b54" : "#333" }}>
                {m.role === "user" ? "Anda" : "AI"}
              </strong>
              {m.badges.map((b, bi) => (
                <span
                  key={bi}
                  style={{
                    marginLeft: 8,
                    fontSize: 12,
                    background: "#e8efe9",
                    borderRadius: 4,
                    padding: "2px 8px",
                    color: "#3d6b54",
                  }}
                >
                  {b}
                </span>
              ))}
              <div style={{ whiteSpace: "pre-wrap", color: "#222" }}>
                {m.content}
                {busy && i === msgs.length - 1 ? " ▌" : ""}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        {error && (
          <div style={{ color: "#a33", marginTop: 8 }}>
            {error} —{" "}
            <button
              style={{ border: "none", background: "none", color: "#3d6b54", cursor: "pointer" }}
              onClick={() => void send(input || msgs[msgs.length - 2]?.content || "")}
            >
              Coba lagi
            </button>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            style={{ flex: 1, padding: 10, borderRadius: 4, border: "1px solid #e3ddd4" }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void send(input)}
            placeholder="Tanya sesuatu…"
          />
          <MicButton onText={(t) => void send(t)} disabled={busy} />
          <button style={btn} onClick={() => void send(input)} disabled={busy}>
            {busy ? "…" : "Kirim"}
          </button>
        </div>
      </section>
    </div>
  );
}

const btn: React.CSSProperties = {
  border: "none",
  borderRadius: 4,
  padding: "8px 12px",
  cursor: "pointer",
  background: "#3d6b54",
  color: "white",
  fontSize: 14,
};
