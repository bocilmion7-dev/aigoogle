import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearSandbox,
  getMe,
  getSandboxMessages,
  getSandboxSession,
  sendSandboxMessage,
  type SandboxSession,
  type WaChatMessage,
} from "../api";
import { AppHeader, PageLoader } from "../ui";
import { IconChat, IconRefresh, IconSend, IconTrash } from "../icons";

const MAX_TEXT = 2000;

const REASON: Record<string, string> = {
  shop_ai_nonaktif: "AI penjaga toko belum diaktifkan (menu WhatsApp → Toko & Riwayat).",
  anti_spam: "Terlalu banyak pesan dalam 1 menit — tunggu sebentar.",
  tenant_tanpa_owner: "Perusahaan ini belum punya admin.",
  kuota_ai_habis: "Kuota/token AI habis atau langganan tidak aktif.",
  accurate_belum_terhubung: "Accurate belum terhubung — AI tidak bisa membaca produk.",
  llm_gagal: "Model AI gagal membalas (cek log server).",
  tanpa_balasan: "AI tidak menghasilkan balasan.",
};

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function parseImage(body: string): { url: string; caption: string } | null {
  if (!body.startsWith("[image] ")) return null;
  const raw = body.slice(8);
  const m = /((?:https?:\/\/|data:image\/)\S+)\s*$/.exec(raw);
  if (!m) return null;
  return { caption: raw.slice(0, m.index).trim(), url: m[1]! };
}

export function Sandbox() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [session, setSession] = useState<SandboxSession | null>(null);
  const [messages, setMessages] = useState<WaChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await getSandboxSession();
      setSession(s);
      setMessages(s.messages);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal memuat sandbox.");
    }
  }, []);

  useEffect(() => {
    void getMe().then(setMe);
    void load();
  }, [load]);

  // settlement pembayaran datang asinkron (webhook Midtrans / simulator) —
  // polling ringan agar pesan "Pembayaran diterima…" muncul tanpa muat ulang manual
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && !busy) {
        void getSandboxMessages()
          .then(setMessages)
          .catch(() => null);
      }
    }, 4000);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setErr("");
    setNote("");
    // tampilkan pesan pembeli segera (server mencatat pesan yang sama)
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, body, direction: "in", status: "received", error: "", createdAt: new Date().toISOString() },
    ]);
    setText("");
    try {
      const r = await sendSandboxMessage(body.slice(0, MAX_TEXT));
      setMessages(r.messages);
      if (!r.replied) setNote(REASON[r.reason ?? ""] ?? "AI tidak membalas.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal mengirim pesan.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!window.confirm("Hapus seluruh riwayat percakapan sandbox?")) return;
    setBusy(true);
    try {
      await clearSandbox();
      setMessages([]);
      setNote("");
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menghapus riwayat.");
    } finally {
      setBusy(false);
    }
  }

  if (me === undefined) {
    return (
      <div className="app">
        <main className="page page--narrow">
          <PageLoader />
        </main>
      </div>
    );
  }
  if (me === null) {
    window.location.href = "/login";
    return null;
  }

  const ready = !!session?.shopAi && !!session?.accurateConnected && !!session?.aiAccess;

  return (
    <div className="app">
      <AppHeader me={me} />
      <main className="wa-chat-page wa-chat-page--sandbox" aria-label="Sandbox WhatsApp">
        <section className="wa-chat-pane is-open-mobile" aria-label="Percakapan sandbox">
          <header className="wa-chat-pane__head">
            <span className="wa-avatar wa-avatar--sm" style={{ background: "hsl(24 80% 46%)" }} aria-hidden="true">
              SB
            </span>
            <div className="wa-chat-pane__title">
              <strong>Sandbox WhatsApp</strong>
              <span>{busy ? "AI sedang mengetik…" : "Pipeline sama dengan WhatsApp live"}</span>
            </div>
            <a className="wa-chat-iconbtn" href="/whatsapp" title="Kembali ke WhatsApp" aria-label="Kembali ke WhatsApp">
              <IconChat size={18} />
            </a>
          </header>

          <div className="sandbox-chips" aria-label="Status fitur">
            <span className={`orders-badge ${session?.shopAi ? "is-selesai" : "is-gagal"}`}>
              AI toko {session?.shopAi ? "aktif" : "nonaktif"}
            </span>
            <span className={`orders-badge ${session?.accurateConnected ? "is-selesai" : "is-gagal"}`}>
              Accurate {session?.accurateConnected ? "terhubung" : "belum"}
            </span>
            <span className={`orders-badge ${session?.aiAccess ? "is-selesai" : "is-gagal"}`}>
              Kuota AI {session?.aiAccess ? "cukup" : "habis"}
            </span>
            <span className={`orders-badge ${session?.biteshipReady ? "is-selesai" : "is-gagal"}`}>
              Biteship {session?.biteshipReady ? "aktif" : "belum"}
            </span>
          </div>

          {!ready && (
            <p className="banner banner--err" role="status" style={{ margin: "0 var(--space-s)" }}>
              Sandbox belum bisa membalas penuh.{" "}
              {!session?.shopAi && "Aktifkan AI penjaga toko di menu WhatsApp. "}
              {!session?.accurateConnected && "Hubungkan Accurate. "}
              {!session?.aiAccess && "Isi kuota/token AI."}
            </p>
          )}

          <div className="wa-chat-body">
            {messages.length === 0 && !busy && (
              <p className="empty">
                Ketik pesan sebagai pembeli. Contoh: “halo, ada Anti Gores Iphone 5?” — balasan AI akan sama dengan
                WhatsApp sungguhan (termasuk QRIS), hanya tidak dikirim ke nomor siapa pun.
              </p>
            )}
            {messages.map((m) => {
              const incoming = m.direction === "in";
              const img = parseImage(m.body);
              return (
                <div key={m.id} className={`wa-bubble-row${incoming ? " is-in" : " is-out"}`}>
                  <div className={`wa-bubble${incoming ? " wa-bubble--in" : " wa-bubble--out"}`}>
                    {img ? (
                      <>
                        <a href={img.url} target="_blank" rel="noopener noreferrer">
                          <img className="wa-bubble__media" src={img.url} alt="Gambar QRIS" loading="lazy" />
                        </a>
                        {img.caption && <span className="wa-bubble__text">{img.caption}</span>}
                      </>
                    ) : (
                      <span className="wa-bubble__text">{m.body}</span>
                    )}
                    <span className="wa-bubble__meta">{timeOf(m.createdAt)}</span>
                  </div>
                </div>
              );
            })}
            {busy && (
              <div className="wa-bubble-row is-out">
                <div className="wa-bubble wa-bubble--out">
                  <span className="wa-bubble__text">
                    <span className="busy-dot" aria-hidden="true" /> AI sedang mengetik…
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {note && (
            <p className="banner banner--err" role="status" style={{ margin: "0 var(--space-s)" }}>
              {note}
            </p>
          )}
          {err && (
            <p className="banner banner--err" role="alert" style={{ margin: "0 var(--space-s)" }}>
              {err}
            </p>
          )}

          <div className="wa-chat-composer">
            <textarea
              className="input"
              rows={1}
              value={text}
              maxLength={MAX_TEXT}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Tulis pesan sebagai pembeli…"
              aria-label="Tulis pesan sandbox"
              disabled={busy}
            />
            <button
              type="button"
              className="btn wa-chat-send"
              onClick={() => void send()}
              disabled={busy || !text.trim()}
              aria-label="Kirim pesan sandbox"
              aria-busy={busy}
            >
              {busy ? <span className="spinner" aria-hidden="true" /> : <IconSend size={18} />}
            </button>
          </div>

          <div className="sandbox-foot">
            <button type="button" className="btn btn--2 btn--sm" onClick={() => void load()} disabled={busy}>
              <IconRefresh size={15} /> Muat ulang
            </button>
            <button type="button" className="btn btn--2 btn--sm" onClick={() => void clear()} disabled={busy}>
              <IconTrash size={15} /> Bersihkan riwayat
            </button>
            <span className="meta">Nomor semu: {session?.peer ?? "—"}</span>
          </div>
        </section>
      </main>
    </div>
  );
}
