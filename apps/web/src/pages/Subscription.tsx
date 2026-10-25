import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAiSubscription,
  getBillingPayment,
  getMe,
  postAiSubscription,
  type AiSubscriptionPayload,
  type AiSubscriptionResult,
} from "../api";
import { AppHeader, PageLoader } from "../ui";
import { IconCheck } from "../icons";

const rp = (n: number): string => `Rp${Math.round(n).toLocaleString("id-ID")}`;

export function Subscription() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [data, setData] = useState<AiSubscriptionPayload | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [qris, setQris] = useState<AiSubscriptionResult | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setData(await getAiSubscription());
  }, []);

  useEffect(() => {
    void getMe().then(setMe);
    void load().catch(() => setErr("Gagal memuat paket langganan."));
  }, [load]);

  useEffect(() => {
    if (!qris) return;
    pollRef.current = window.setInterval(() => {
      void getBillingPayment(qris.orderId)
        .then((s) => {
          if (s.settled) {
            setMsg(`Langganan ${qris.plan.name} aktif — ${qris.tokens.toLocaleString("id-ID")} token masuk.`);
            setQris(null);
            void load();
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
