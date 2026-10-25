import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getMe,
  getWaChatMessages,
  getWaChats,
  getWaShopOrders,
  sendWaMessage,
  settleWaShopOrder,
  type WaChatMessage,
  type WaChatSummary,
  type WaShopOrder,
} from "../api";
import { AppHeader, PageLoader } from "../ui";
import { IconArrowLeft, IconChat, IconSearch, IconSend } from "../icons";

const MAX_TEXT = 4000;

function timeOf(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function listTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return timeOf(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Kemarin";
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Hari ini";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Kemarin";
  return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function initials(peer: string): string {
  const digits = peer.replace(/\D/g, "");
  return digits.slice(-2) || "?";
}

function avatarHue(peer: string): number {
  let h = 0;
  for (const ch of peer) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function parseImage(body: string): { url: string; caption: string } | null {
  if (!body.startsWith("[image] ")) return null;
  const raw = body.slice(8);
  // gambar QRIS bisa berupa URL maupun data URI (mock/balasan offline)
  const m = /((?:https?:\/\/|data:image\/)\S+)\s*$/.exec(raw);
  if (!m) return null;
  return { caption: raw.slice(0, m.index).trim(), url: m[1]! };
}

function preview(body: string): string {
  return body.startsWith("[image] ") ? "Gambar" : body;
}

function rp(n: number): string {
  return `Rp${Math.round(n).toLocaleString("id-ID")}`;
}

const ORDER_STATUS: Record<string, string> = {
  pending: "Menunggu pembayaran",
  paid: "Lunas",
  failed: "Gagal",
};

export function WaChats() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [chats, setChats] = useState<WaChatSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<WaChatMessage[]>([]);
  const [q, setQ] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [orders, setOrders] = useState<WaShopOrder[]>([]);
  const [simulator, setSimulator] = useState(false);
  const [settleBusy, setSettleBusy] = useState(false);
  const [settleMsg, setSettleMsg] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadChats = useCallback(async () => {
    try {
      setChats(await getWaChats());
    } catch {
      setErr("Gagal memuat daftar chat.");
    }
  }, []);

  const loadOrders = useCallback(async (peer: string) => {
    try {
      const r = await getWaShopOrders(peer);
      setOrders(r.orders);
      setSimulator(r.simulator);
    } catch {
      setOrders([]);
    }
  }, []);

  const loadMessages = useCallback(async (peer: string) => {
    setLoadingMsgs(true);
    try {
      setMessages(await getWaChatMessages(peer));
    } catch {
      setErr("Gagal memuat pesan.");
    } finally {
      setLoadingMsgs(false);
    }
  }, []);

  useEffect(() => {
    void getMe().then(setMe);
    void loadChats();
  }, [loadChats]);

  useEffect(() => {
    if (!selected) {
      setOrders([]);
      setSettleMsg("");
      return;
    }
    void loadMessages(selected);
    void loadOrders(selected);
    const t = window.setInterval(() => {
      void loadMessages(selected);
      void loadOrders(selected);
    }, 5000);
    return () => window.clearInterval(t);
  }, [selected, loadMessages, loadOrders]);

  useEffect(() => {
    const t = window.setInterval(() => void loadChats(), 15000);
    return () => window.clearInterval(t);
  }, [loadChats]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return chats;
    return chats.filter((c) => c.peer.toLowerCase().includes(s) || c.lastMessage.toLowerCase().includes(s));
  }, [chats, q]);

  const active = chats.find((c) => c.peer === selected) ?? null;
  const canManage = !!me?.permissions?.includes("app:users.manage");
  const visibleOrders = orders.slice(0, 3);

  async function settle(order: WaShopOrder) {
    if (!selected) return;
    setSettleBusy(true);
    setErr("");
    setSettleMsg("");
    try {
      await settleWaShopOrder(order.orderId);
      setSettleMsg(`Pesanan ${order.orderId} ditandai lunas (simulasi).`);
      await Promise.all([loadMessages(selected), loadOrders(selected)]);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setErr(
        code === "sudah_settle"
          ? "Pesanan sudah lunas."
          : code === "bukan_sandbox"
            ? "Simulator hanya tersedia di lingkungan uji (bukan produksi)."
            : code === "tidak_punya_hak"
              ? "Hanya admin perusahaan yang boleh memakai simulator pembayaran."
              : "Gagal menjalankan simulator pembayaran."
      );
    } finally {
      setSettleBusy(false);
    }
  }

  async function send() {
    const body = text.trim();
    if (!body || !selected) return;
    setBusy(true);
    setErr("");
    try {
      await sendWaMessage(selected, body.slice(0, MAX_TEXT));
      setText("");
      await loadMessages(selected);
      await loadChats();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal mengirim pesan.");
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

  const grouped = (() => {
    const out: Array<{ label: string; rows: WaChatMessage[] }> = [];
    for (const m of messages) {
      const label = dayLabel(m.createdAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(m);
      else out.push({ label, rows: [m] });
    }
    return out;
  })();

  return (
    <div className="app">
      <AppHeader me={me} />
      <main className="wa-chat-page">
        <section className={`wa-chat-list${selected ? " is-hidden-mobile" : ""}`} aria-label="Daftar chat WhatsApp">
          <header className="wa-chat-list__head">
            <a className="wa-chat-iconbtn" href="/whatsapp" aria-label="Kembali ke WhatsApp" title="Kembali ke WhatsApp">
              <IconArrowLeft size={20} />
            </a>
            <strong>Chat</strong>
            <span className="wa-chat-list__count">{chats.length}</span>
          </header>
          <div className="wa-chat-search">
            <IconSearch size={16} />
            <input
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari nomor atau pesan…"
              aria-label="Cari chat WhatsApp"
            />
          </div>
          <div className="wa-chat-list__body">
            {filtered.length === 0 ? (
              <p className="empty">{chats.length === 0 ? "Belum ada riwayat chat." : "Tidak ada chat yang cocok."}</p>
            ) : (
              filtered.map((c) => (
                <button
                  type="button"
                  key={c.peer}
                  className={`wa-chat-row${selected === c.peer ? " is-active" : ""}`}
                  onClick={() => setSelected(c.peer)}
                >
                  <span
                    className="wa-avatar"
                    style={{ background: `hsl(${avatarHue(c.peer)} 42% 46%)` }}
                    aria-hidden="true"
                  >
                    {initials(c.peer)}
                  </span>
                  <span className="wa-chat-row__main">
                    <span className="wa-chat-row__top">
                      <span className="wa-chat-row__name">{c.peer}</span>
                      <span className="wa-chat-row__time">{listTime(c.lastAt)}</span>
                    </span>
                    <span className="wa-chat-row__bottom">
                      <span className="wa-chat-row__snippet">
                        {c.direction === "out" ? "Anda: " : ""}
                        {preview(c.lastMessage) || "—"}
                      </span>
                      {c.count > 0 && <span className="wa-chat-row__badge">{c.count}</span>}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className={`wa-chat-pane${selected ? " is-open-mobile" : ""}`} aria-label="Isi percakapan">
          {!active ? (
            <div className="wa-chat-empty">
              <span className="wa-chat-empty__icon">
                <IconChat size={36} />
              </span>
              <strong>Riwayat Chat WhatsApp</strong>
              <p>Pilih percakapan di samping untuk melihat isi pesan.</p>
            </div>
          ) : (
            <>
              <header className="wa-chat-pane__head">
                <button
                  type="button"
                  className="wa-chat-iconbtn wa-chat-iconbtn--mobile"
                  onClick={() => setSelected(null)}
                  aria-label="Kembali ke daftar chat"
                >
                  <IconArrowLeft size={20} />
                </button>
                <span
                  className="wa-avatar wa-avatar--sm"
                  style={{ background: `hsl(${avatarHue(active.peer)} 42% 46%)` }}
                  aria-hidden="true"
                >
                  {initials(active.peer)}
                </span>
                <div className="wa-chat-pane__title">
                  <strong>{active.peer}</strong>
                  <span>{loadingMsgs ? "Memuat…" : `${messages.length} pesan`}</span>
                </div>
                <a className="wa-chat-iconbtn" href="/whatsapp" title="Kembali ke WhatsApp" aria-label="Kembali ke WhatsApp">
                  <IconArrowLeft size={20} />
                </a>
              </header>

              <div className="wa-chat-body">
                {grouped.length === 0 && <p className="empty">Belum ada pesan.</p>}
                {grouped.map((g) => (
                  <div key={g.label} className="wa-chat-daygroup">
                    <div className="wa-chat-day">{g.label}</div>
                    {g.rows.map((m) => {
                      const incoming = m.direction === "in";
                      return (
                        <div key={m.id} className={`wa-bubble-row${incoming ? " is-in" : " is-out"}`}>
                          <div className={`wa-bubble${incoming ? " wa-bubble--in" : " wa-bubble--out"}`}>
                            {(() => {
                              const img = parseImage(m.body);
                              if (!img) return <span className="wa-bubble__text">{m.body}</span>;
                              return (
                                <>
                                  <a href={img.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                                    <img className="wa-bubble__media" src={img.url} alt="Gambar QRIS" loading="lazy" />
                                  </a>
                                  {img.caption && <span className="wa-bubble__text">{img.caption}</span>}
                                </>
                              );
                            })()}
                            <span className="wa-bubble__meta">
                              {timeOf(m.createdAt)}
                              {!incoming && (
                                <span
                                  className={`wa-tick${m.status === "failed" ? " is-failed" : ""}`}
                                  aria-label={m.status}
                                  title={m.status}
                                >
                                  {m.status === "queued" || m.status === "pending" ? "✓" : m.status === "failed" ? "!" : "✓✓"}
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {err && (
                <p className="banner banner--err" role="alert" style={{ margin: "0 var(--space-s)" }}>
                  {err}
                </p>
              )}

              {settleMsg && (
                <p className="banner banner--ok" role="status" style={{ margin: "0 var(--space-s)" }}>
                  {settleMsg}
                </p>
              )}

              {visibleOrders.length > 0 && (
                <div className="wa-chat-orders" role="list" aria-label="Pesanan toko">
                  {visibleOrders.map((o) => (
                    <div className="wa-chat-order" key={o.orderId} role="listitem">
                      <span className="wa-chat-order__main">
                        <strong>{o.buyerName || o.buyerPhone || "Pembeli"}</strong>
                        <span className="wa-chat-order__items">
                          {o.items.map((i) => `${i.name} ×${i.qty}`).join(", ")}
                        </span>
                      </span>
                      <span className="wa-chat-order__side">
                        <span className="wa-chat-order__total">{rp(o.total)}</span>
                        <span className={`wa-chat-order__status is-${o.status}`}>{ORDER_STATUS[o.status] ?? o.status}</span>
                      </span>
                      {o.status === "pending" && simulator && canManage && (
                        <button
                          type="button"
                          className="btn btn--2 btn--sm"
                          onClick={() => void settle(o)}
                          disabled={settleBusy}
                          aria-busy={settleBusy}
                        >
                          {settleBusy ? "Memproses…" : "Tandai lunas (simulasi)"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
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
                  placeholder="Tulis pesan…"
                  aria-label="Tulis pesan WhatsApp"
                />
                <button
                  type="button"
                  className="btn wa-chat-send"
                  onClick={() => void send()}
                  disabled={busy || !text.trim()}
                  aria-label="Kirim pesan"
                  aria-busy={busy}
                >
                  {busy ? <span className="spinner" aria-hidden="true" /> : <IconSend size={18} />}
                </button>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
