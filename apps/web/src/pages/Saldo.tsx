import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAiLedger,
  getAiWallet,
  getAiTopup,
  getMe,
  mockSettleAiTopup,
  postAiTopup,
  type AiLedgerRow,
  type AiWalletSummary,
} from "../api";
import { AppHeader, PageLoader } from "../ui";
import { IconQr, IconWallet } from "../icons";
import { DEFAULT_AI_TOPUP_PACKAGES, type AiTopupPackage } from "@aigoogle/shared";

const rp = (n: number): string => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const tok = (n: number): string => `${Math.round(n).toLocaleString("id-ID")} token`;
const KIND_LABEL: Record<string, string> = {
  bonus: "Saldo awal",
  topup: "Top up",
  usage: "Pemakaian AI",
  adjust: "Penyesuaian admin",
  refund: "Pengembalian",
};

interface QrisState {
  orderId: string;
  amount: number;
  credits: number;
  qrUrl: string;
  qrContent: string;
  expiredAt: string;
  tokens?: number;
}

export function Saldo() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [wallet, setWallet] = useState<AiWalletSummary | null>(null);
  const [ledger, setLedger] = useState<AiLedgerRow[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const [qris, setQris] = useState<QrisState | null>(null);
  const [dormant, setDormant] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const pollRef = useRef<number | null>(null);

  const PAGE_SIZE = 10;

  const loadWallet = useCallback(async () => {
    setWallet(await getAiWallet());
  }, []);

  const loadLedger = useCallback(async (p: number) => {
    setLedgerBusy(true);
    try {
      // ambil 1 baris ekstra utk tahu masih ada halaman berikutnya
      const rows = await getAiLedger(PAGE_SIZE + 1, p * PAGE_SIZE);
      setLedger(rows.slice(0, PAGE_SIZE));
      setHasMore(rows.length > PAGE_SIZE);
    } finally {
      setLedgerBusy(false);
    }
  }, []);

  useEffect(() => {
    void getMe().then(setMe);
    void loadWallet().catch(() => setErr("Gagal memuat saldo."));
  }, [loadWallet]);

  useEffect(() => {
    if (!me) return;
    void loadLedger(page).catch(() => setErr("Gagal memuat riwayat saldo."));
  }, [me, page, loadLedger]);

  useEffect(() => {
    if (!qris) return;
    pollRef.current = window.setInterval(() => {
      void getAiTopup(qris.orderId)
        .then((s) => {
          if (s.status === "settlement") {
            setMsg(`Top up berhasil — saldo bertambah ${tok(qris.tokens ?? 0)}.`);
            setQris(null);
            void loadWallet();
            void loadLedger(page);
          }
        })
        .catch(() => null);
    }, 4000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [qris, loadWallet, loadLedger, page]);

  async function topup(pkg: AiTopupPackage) {
    setBusy(true);
    setErr("");
    setMsg("");
    setDormant(false);
    try {
      const res = await postAiTopup(pkg.id);
      if (res.qris) {
        setQris({
          orderId: res.orderId,
          amount: res.amount,
          credits: res.credits,
          tokens: res.tokens ?? pkg.tokens,
          qrUrl: res.qris.qrUrl,
          qrContent: res.qris.qrContent,
          expiredAt: res.qris.expiredAt,
        });
      }
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "billing_dormant") {
        setDormant(true);
        setErr("Pembayaran QRIS belum aktif di platform — hubungi admin.");
      } else if (code === "paket_tidak_ditemukan") setErr("Paket top up tidak tersedia — muat ulang halaman.");
      else setErr("Gagal membuat pembayaran. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  async function mockPay() {
    if (!qris) return;
    setBusy(true);
    try {
      await mockSettleAiTopup(qris.orderId);
      setMsg("Top up (mode uji) berhasil.");
      setQris(null);
      await loadWallet();
      if (page === 0) await loadLedger(0);
      else setPage(0);
    } catch {
      setErr("Gagal menyelesaikan top up uji.");
    } finally {
      setBusy(false);
    }
  }

  const packages = wallet?.topupPackages?.length ? wallet.topupPackages : DEFAULT_AI_TOPUP_PACKAGES;

  if (me === undefined) {
    return (
      <div className="app">
        <main className="page page--narrow">
          <PageLoader />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <AppHeader me={me} />
      <main className="page page--narrow">
        <h1>Saldo & Pemakaian AI</h1>

        {msg && (
          <p className="banner banner--ok" role="status">
            {msg}
          </p>
        )}
        {err && (
          <p className="banner banner--err" role="alert">
            {err}
          </p>
        )}

        <section className="card saldo-card">
          <div>
            <p className="saldo-card__label">Saldo token tersedia</p>
            <p className="saldo-card__value">{wallet ? tok(wallet.balanceTokens) : "…"}</p>
            {wallet && wallet.balanceTokens < wallet.minReserveTokens && (
              <p className="saldo-card__warn" role="alert">
                Saldo di bawah minimum ({tok(wallet.minReserveTokens)}) — AI diblokir sampai top up.
              </p>
            )}
            {wallet && (
              <p style={{ margin: "4px 0 0", color: "var(--ink-2)", fontSize: "var(--step--1)" }}>
                1.000 token = {rp(wallet.rupiahPer1kTokens)}
              </p>
            )}
          </div>
          <dl className="saldo-card__stats">
            <div>
              <dt>Token terpakai 30 hari</dt>
              <dd>{wallet ? wallet.spentTokens30d.toLocaleString("id-ID") : "…"}</dd>
            </div>
            <div>
              <dt>Token diproses model</dt>
              <dd>{wallet ? wallet.tokens30d.toLocaleString("id-ID") : "…"}</dd>
            </div>
            <div>
              <dt>Panggilan</dt>
              <dd>{wallet ? wallet.calls30d.toLocaleString("id-ID") : "…"}</dd>
            </div>
          </dl>
        </section>

        <section className="card">
          <h2>Top up saldo</h2>
          <p style={{ color: "var(--ink-2)", fontSize: "var(--step--1)" }}>
            Pilih paket — token masuk otomatis setelah pembayaran QRIS lunas. Saldo tidak kedaluwarsa.
          </p>
          <div className="topup-grid">
            {packages.map((p) => {
              const per1k = p.price / Math.max(1, p.tokens / 1000);
              const rate = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(per1k);
              return (
                <button
                  key={p.id}
                  type="button"
                  className="topup-card"
                  onClick={() => void topup(p)}
                  disabled={busy}
                >
                  <span className="topup-card__price">{rp(p.price)}</span>
                  <span className="topup-card__tokens">
                    <IconWallet size={15} /> {p.tokens.toLocaleString("id-ID")} token
                  </span>
                  <span className="topup-card__hint">≈ Rp{rate} / 1.000 token</span>
                </button>
              );
            })}
          </div>
          {busy && (
            <p className="meta" style={{ margin: "var(--space-xs) 0 0" }}>
              <span className="spinner" aria-hidden="true" /> Menyiapkan pembayaran…
            </p>
          )}
          <p className="meta" style={{ margin: "var(--space-xs) 0 0" }}>
            Butuh token rutin? <a href="/subscription">Lihat paket langganan bulanan</a>.
          </p>
        </section>

        <section style={{ marginTop: "var(--space-s)" }}>
          <h2>Riwayat saldo</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Waktu</th>
                  <th scope="col">Jenis</th>
                  <th scope="col">Jumlah (token)</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.createdAt).toLocaleString("id-ID")}</td>
                    <td>{KIND_LABEL[r.kind] ?? r.kind}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {r.tokens === undefined || r.tokens === 0
                        ? "—"
                        : `${r.tokens > 0 ? "+" : "−"}${Math.abs(r.tokens).toLocaleString("id-ID")}`}
                    </td>
                  </tr>
                ))}
                {ledger.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ color: "var(--ink-2)" }}>
                      Belum ada riwayat.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div
            className="row"
            style={{ justifyContent: "space-between", marginTop: "var(--space-xs)", flexWrap: "nowrap" }}
          >
            <button
              type="button"
              className="btn btn--2 btn--sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || ledgerBusy}
            >
              Sebelumnya
            </button>
            <span className="meta" aria-live="polite">
              {ledgerBusy ? "Memuat…" : `Halaman ${page + 1}`}
            </span>
            <button
              type="button"
              className="btn btn--2 btn--sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore || ledgerBusy}
            >
              Berikutnya
            </button>
          </div>
        </section>

      </main>

      {qris && (
        <div className="modal-overlay" onClick={() => setQris(null)}>
          <div
            className="modal modal--qr modal--sub-qr"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-topup-qr-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__head">
              <IconQr size={18} />
              <strong className="card__title" id="ai-topup-qr-title">
                Pembayaran Top Up
              </strong>
              <button type="button" className="modal__x" onClick={() => setQris(null)} aria-label="Tutup pembayaran">
                ×
              </button>
            </div>
            <div className="qr-card">
              <p className="qr-card__status">
                {tok(qris.tokens ?? 0)} · {rp(qris.amount)}
              </p>
              {qris.qrUrl ? (
                <img src={qris.qrUrl} alt="QRIS pembayaran" width={220} height={220} />
              ) : (
                <p style={{ fontFamily: "monospace", wordBreak: "break-all", margin: 0 }}>{qris.qrContent}</p>
              )}
              <p className="qr-card__status" role="status" aria-live="polite">
                <span className="busy-dot" aria-hidden="true" /> Menunggu pembayaran…
              </p>
              <p className="qr-card__hint">Scan dengan aplikasi QRIS apa pun. Status diperbarui otomatis.</p>
            </div>
            <p className="meta" style={{ margin: 0, textAlign: "center" }}>
              Order {qris.orderId} · berlaku sampai {new Date(qris.expiredAt).toLocaleString("id-ID")}
            </p>
            {dormant && (
              <button className="btn btn--2 btn--sm" onClick={() => void mockPay()} disabled={busy}>
                Tandai lunas (mode uji)
              </button>
            )}
            <div className="modal__foot">
              <button type="button" className="btn" onClick={() => setQris(null)}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
