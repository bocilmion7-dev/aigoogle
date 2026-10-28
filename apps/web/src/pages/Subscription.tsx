import { useCallback, useEffect, useRef, useState } from "react";
import {
  emailInvoice,
  getAiSubscription,
  getAutoRenew,
  getBillingPayment,
  getInvoices,
  getMe,
  postAiSubscription,
  setAutoRenew as putAutoRenew,
  type AiSubscriptionPayload,
  type AiSubscriptionResult,
  type InvoiceRow,
} from "../api";
import { AppHeader, PageLoader } from "../ui";
import { IconCheck, IconDownload, IconSend } from "../icons";
import { track } from "../telemetry";

const rp = (n: number): string => `Rp${Math.round(n).toLocaleString("id-ID")}`;

export function Subscription() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [data, setData] = useState<AiSubscriptionPayload | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [qris, setQris] = useState<AiSubscriptionResult | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [invMsg, setInvMsg] = useState("");
  const [invBusy, setInvBusy] = useState("");
  const [invPage, setInvPage] = useState(1);
  const [invHasMore, setInvHasMore] = useState(false);
  const [invLoading, setInvLoading] = useState(false);
  const [autoRenew, setAutoRenew] = useState(false);
  const [renewBusy, setRenewBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setData(await getAiSubscription());
  }, []);
  const loadInvoices = useCallback(async (page = 1) => {
    setInvLoading(true);
    try {
      const r = await getInvoices(10, (page - 1) * 10);
      setInvoices(r.items);
      setInvHasMore(r.hasMore);
      setInvPage(page);
    } catch {
      setInvoices([]);
      setInvHasMore(false);
    } finally {
      setInvLoading(false);
    }
  }, []);

  useEffect(() => {
    void getMe().then(setMe);
    void load().catch(() => setErr("Gagal memuat paket langganan."));
    void loadInvoices(1);
    void getAutoRenew().then((r) => setAutoRenew(r.enabled)).catch(() => null);
  }, [load, loadInvoices]);
  useEffect(() => {
    if (me === null) window.location.href = "/login";
  }, [me]);

  useEffect(() => {
    if (!qris) return;
    pollRef.current = window.setInterval(() => {
      void getBillingPayment(qris.orderId)
        .then((s) => {
          if (s.settled) {
            setMsg(`Langganan ${qris.plan.name} aktif — ${qris.tokens.toLocaleString("id-ID")} token masuk.`);
            setQris(null);
            void load();
            void loadInvoices(1);
          } else if (["cancel", "expire", "deny"].includes(s.status)) {
            setQris(null);
            setErr("Pembayaran langganan dibatalkan atau kedaluwarsa.");
          }
        })
        .catch(() => undefined);
    }, 4000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [qris, load]);

  async function subscribe(planId: string) {
    setBusyPlan(planId);
    setErr("");
    setMsg("");
    track("subscribe_click", { plan: planId });
    try {
      const res = await postAiSubscription(planId);
      setQris(res);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setErr(
        code === "billing_dormant"
          ? "Pembayaran QRIS belum aktif di platform."
          : code === "paket_tidak_ditemukan"
            ? "Paket tidak tersedia — muat ulang halaman."
            : "Gagal membuat pembayaran langganan."
      );
    } finally {
      setBusyPlan(null);
    }
  }

  async function toggleAutoRenew() {
    setRenewBusy(true);
    setErr("");
    try {
      const next = !autoRenew;
      await putAutoRenew(next);
      setAutoRenew(next);
      setMsg(next ? "Perpanjangan otomatis diaktifkan." : "Perpanjangan otomatis dimatikan.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal mengubah perpanjangan otomatis.");
    } finally {
      setRenewBusy(false);
    }
  }

  async function sendInvoice(orderId: string) {
    setInvBusy(orderId);
    setInvMsg("");
    try {
      const r = await emailInvoice(orderId);
      setInvMsg(r.sent ? "Invoice dikirim ke email akun Anda." : "Pengiriman email tidak tersedia.");
    } catch (e) {
      setInvMsg(e instanceof Error ? e.message : "Gagal mengirim invoice.");
    } finally {
      setInvBusy("");
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
  if (me === null) return null;

  const renewRequested = new URLSearchParams(window.location.search).get("renew") === "1";
  const active = data?.subscription?.active ? data.subscription : null;
  const activeName = active ? (data?.plans.find((p) => p.id === active.plan)?.name ?? active.plan) : "";
  const activeUntil = active?.expiresAt
    ? new Date(active.expiresAt).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <div className="app">
      <AppHeader me={me} />
      <main className="page">
        <h1>Langganan AI</h1>
        <p className="page__sub">
          Paket bulanan dengan token rutin. Token masuk otomatis setelah pembayaran QRIS lunas.
        </p>
        {renewRequested && (
          <p className="banner banner--ok" role="status">
            Masa aktif Anda akan berakhir. Pilih paket di bawah untuk memperpanjang.
          </p>
        )}
        {data && (
          <p className="meta" style={{ marginTop: "calc(-1 * var(--space-2xs))" }}>
            Saldo token saat ini: <strong>{data.wallet.balanceTokens.toLocaleString("id-ID")}</strong>
          </p>
        )}

        {!active && data?.access.trialActive && (
          <div className="sub-active sub-active--trial">
            <span className="sub-active__icon">
              <IconCheck size={16} />
            </span>
            <div>
              <strong>Masa demo aktif</strong>
              <span>
                Berlaku sampai{" "}
                {data.access.trialEndsAt
                  ? new Date(data.access.trialEndsAt).toLocaleDateString("id-ID", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })
                  : "3 hari setelah pendaftaran"}
              </span>
            </div>
          </div>
        )}
        {active && (
          <div className="sub-active">
            <span className="sub-active__icon">
              <IconCheck size={16} />
            </span>
            <div>
              <strong>Langganan {activeName} aktif</strong>
              <span>Berlaku sampai {activeUntil ?? "tanpa batas"}</span>
            </div>
          </div>
        )}
        <section className="card" style={{ marginBottom: "var(--space-s)" }}>
          <strong className="card__title">Perpanjangan otomatis</strong>
          <p className="meta" style={{ marginTop: 0 }}>
            Kami kirim pengingat dan menyiapkan perpanjangan sebelum masa aktif habis. Pembayaran QRIS tetap perlu dikonfirmasi.
          </p>
          <label className="check">
            <input type="checkbox" checked={autoRenew} onChange={() => void toggleAutoRenew()} disabled={renewBusy} />
            <span>Aktifkan pengingat perpanjangan otomatis</span>
          </label>
        </section>

        {msg && (
          <p className="banner banner--ok" role="status" style={{ marginBottom: "var(--space-xs)" }}>
            {msg}
          </p>
        )}
        {err && (
          <p className="banner banner--err" role="alert" style={{ marginBottom: "var(--space-xs)" }}>
            {err}
          </p>
        )}

        {!data ? (
          <PageLoader label="Memuat paket…" />
        ) : (
          <div className="sub-grid">
            {data.plans.map((plan, i) => {
              const isActive = active?.plan === plan.id;
              return (
                <article key={plan.id} className={`sub-card sub-card--${i % 3}${isActive ? " is-active" : ""}`}>
                  <div className="sub-card__head">
                    <span className="sub-card__chip" aria-hidden="true" />
                    <svg className="sub-card__nfc" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                      <path d="M6 8c2 2 2 6 0 8M10 6c3 3 3 9 0 12M14 4c4 4 4 12 0 16" strokeLinecap="round" />
                    </svg>
                    <span className="sub-card__brand">AI ASISTEN</span>
                  </div>
                  {i === 1 && <span className="sub-card__badge">Paling populer</span>}
                  <div className="sub-card__name">{plan.name}</div>
                  <div className="sub-card__price">
                    {rp(plan.price)}
                    <span>/bulan</span>
                  </div>
                  <div className="sub-card__tokens">{plan.tokens.toLocaleString("id-ID")} token / bulan</div>
                  <ul className="sub-card__features">
                    {plan.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <div className="sub-card__meta">
                    <span>•••• {String(plan.tokens).slice(-4)}</span>
                    <span>{plan.months} bulan</span>
                  </div>
                  <button
                    type="button"
                    className="btn sub-card__cta"
                    onClick={() => void subscribe(plan.id)}
                    disabled={busyPlan !== null}
                    aria-busy={busyPlan === plan.id}
                  >
                    {busyPlan === plan.id ? <span className="spinner" aria-hidden="true" /> : null}
                    {isActive ? "Perpanjang" : busyPlan === plan.id ? "Menyiapkan…" : "Pilih paket"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
        <p className="meta" style={{ marginTop: "var(--space-m)" }}>
          <a href="/refund">Kebijakan refund &amp; kredit</a>
        </p>

        <section className="card" style={{ marginTop: "var(--space-m)" }}>
          <strong className="card__title">Riwayat pembayaran</strong>
          <p className="meta" style={{ marginTop: 0 }}>Unduh atau kirim invoice ke email akun Anda.</p>
          {invMsg && <p className="banner banner--ok" role="status">{invMsg}</p>}
          <div className={`table-wrap${invLoading ? " is-loading" : ""}`} aria-busy={invLoading}>
            <table className="table inv-table">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Jenis</th>
                  <th>Order</th>
                  <th>Nominal</th>
                  <th>Status</th>
                  <th className="inv-actions-cell">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={`${inv.orderId}-${inv.kind}`}>
                    <td style={{ whiteSpace: "nowrap" }}>{new Date(inv.createdAt).toLocaleDateString("id-ID")}</td>
                    <td>{inv.kind}</td>
                    <td><code style={{ fontSize: "var(--text-2xs)" }}>{inv.orderId}</code></td>
                    <td>Rp{inv.amount.toLocaleString("id-ID")}</td>
                    <td>{inv.status === "settlement" ? "Lunas" : inv.status === "pending" ? "Menunggu" : inv.status}</td>
                    <td className="inv-actions-cell">
                      <div className="inv-actions">
                        <a
                          className="btn btn--2 btn--sm inv-btn"
                          href={`/api/billing/invoice/${encodeURIComponent(inv.orderId)}`}
                          download
                          aria-label={`Unduh invoice ${inv.orderId}`}
                          title="Unduh invoice PDF"
                        >
                          <IconDownload size={14} /> PDF
                        </a>
                        <button
                          type="button"
                          className="btn btn--2 btn--sm inv-btn"
                          onClick={() => void sendInvoice(inv.orderId)}
                          disabled={invBusy === inv.orderId}
                          aria-busy={invBusy === inv.orderId}
                          aria-label={`Kirim invoice ${inv.orderId} ke email`}
                          title="Kirim invoice ke email"
                        >
                          {invBusy === inv.orderId ? <span className="spinner" aria-hidden="true" /> : <IconSend size={14} />}
                          Email
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!invLoading && invoices.length === 0 && (
                  <tr><td colSpan={6} className="empty">Belum ada pembayaran.</td></tr>
                )}
                {invLoading && invoices.length === 0 && (
                  <tr><td colSpan={6} className="empty">Memuat…</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {(invoices.length > 0 || invPage > 1 || invHasMore) && (
            <div className="inv-pager">
              <button
                type="button"
                className="btn btn--2 btn--sm"
                onClick={() => void loadInvoices(invPage - 1)}
                disabled={invPage <= 1 || invLoading}
              >
                Sebelumnya
              </button>
              <span className="meta" aria-live="polite">
                Halaman {invPage} · 10/halaman
              </span>
              <button
                type="button"
                className="btn btn--2 btn--sm"
                onClick={() => void loadInvoices(invPage + 1)}
                disabled={!invHasMore || invLoading}
              >
                Berikutnya
              </button>
            </div>
          )}
        </section>
      </main>

      {qris && (
        <div className="modal-overlay" onClick={() => setQris(null)}>
          <div
            className="modal modal--qr modal--sub-qr"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sub-pay-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__head">
              <span className="modal__spin" aria-hidden="true" />
              <strong className="card__title" id="sub-pay-title">
                Pembayaran Langganan
              </strong>
              <button type="button" className="modal__x" onClick={() => setQris(null)} aria-label="Tutup pembayaran">
                ×
              </button>
            </div>
            <div className="qr-card">
              <p className="qr-card__status">
                {qris.plan.name} · {rp(qris.amount)}
              </p>
              {qris.qris.qrUrl ? (
                <img src={qris.qris.qrUrl} alt="QRIS pembayaran langganan" width={220} height={220} />
              ) : (
                <p style={{ fontFamily: "monospace", wordBreak: "break-all", margin: 0 }}>{qris.qris.qrContent}</p>
              )}
              <p className="qr-card__status" role="status" aria-live="polite">
                <span className="busy-dot" aria-hidden="true" /> Menunggu pembayaran…
              </p>
              <p className="qr-card__hint">
                {qris.tokens.toLocaleString("id-ID")} token masuk otomatis setelah pembayaran lunas.
              </p>
            </div>
            <p className="meta" style={{ margin: 0, textAlign: "center" }}>
              Order {qris.orderId} · berlaku sampai {new Date(qris.qris.expiredAt).toLocaleString("id-ID")}
            </p>
            <div className="modal__foot">
              <button type="button" className="btn btn--2" onClick={() => setQris(null)}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
