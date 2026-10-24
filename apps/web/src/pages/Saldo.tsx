import { useCallback, useEffect, useRef, useState } from "react";
import {
  adjustAiWallet,
  getAiLedger,
  getAiWallet,
  getAiTopup,
  getAiWallets,
  getMe,
  mockSettleAiTopup,
  postAiTopup,
  type AiLedgerRow,
  type AiMemberWallet,
  type AiWalletSummary,
} from "../api";
import { AppHeader, PageLoader } from "../ui";

const rp = (n: number): string => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const PRESETS = [10_000, 25_000, 50_000, 100_000];
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
}

export function Saldo() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [wallet, setWallet] = useState<AiWalletSummary | null>(null);
  const [ledger, setLedger] = useState<AiLedgerRow[]>([]);
  const [amount, setAmount] = useState<number>(25_000);
  const [qris, setQris] = useState<QrisState | null>(null);
  const [dormant, setDormant] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [members, setMembers] = useState<AiMemberWallet[]>([]);
  const [adjUser, setAdjUser] = useState("");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjNote, setAdjNote] = useState("");
  const pollRef = useRef<number | null>(null);

  const isAdmin = !!me?.permissions?.includes("app:users.manage");
  const isPlatform = me?.tenant.provider === "platform";

  const load = useCallback(async () => {
    const [w, l] = await Promise.all([getAiWallet(), getAiLedger(50)]);
    setWallet(w);
    setLedger(l);
  }, []);

  useEffect(() => {
    void getMe().then(setMe);
    void load().catch(() => setErr("Gagal memuat saldo."));
  }, [load]);

  useEffect(() => {
    if (!isAdmin || isPlatform) return;
    void getAiWallets()
      .then(setMembers)
      .catch(() => null);
  }, [isAdmin, isPlatform]);

  useEffect(() => {
    if (!qris) return;
    pollRef.current = window.setInterval(() => {
      void getAiTopup(qris.orderId)
        .then((s) => {
          if (s.status === "settlement") {
            setMsg(`Top up berhasil — saldo bertambah ${rp(s.credits)}.`);
            setQris(null);
            void load();
          }
        })
        .catch(() => null);
    }, 4000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [qris, load]);

  async function topup() {
    setBusy(true);
    setErr("");
    setMsg("");
    setDormant(false);
    try {
      const res = await postAiTopup(amount);
      if (res.qris) {
        setQris({
          orderId: res.orderId,
          amount: res.amount,
          credits: res.credits,
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
      } else if (code === "bad_request") setErr("Nominal minimal Rp10.000.");
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
      await load();
    } catch {
      setErr("Gagal menyelesaikan top up uji.");
    } finally {
      setBusy(false);
    }
  }

  async function submitAdjust() {
    if (!adjUser || !adjAmount) return setErr("Pilih member & isi nominal.");
    setBusy(true);
    setErr("");
    try {
      const out = await adjustAiWallet(adjUser, Number(adjAmount), adjNote);
      setMsg(`Saldo member diperbarui — saldo sekarang ${rp(out.balance)}.`);
      setAdjAmount("");
      setAdjNote("");
      setMembers(await getAiWallets());
      await load();
    } catch {
      setErr("Gagal menyesuaikan saldo.");
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
            <p className="saldo-card__label">Saldo tersedia</p>
            <p className="saldo-card__value">{wallet ? rp(wallet.balance) : "…"}</p>
            {wallet && wallet.balance < wallet.minReserve && (
              <p className="saldo-card__warn" role="alert">
                Saldo di bawah minimum ({rp(wallet.minReserve)}) — AI diblokir sampai top up.
              </p>
            )}
          </div>
          <dl className="saldo-card__stats">
            <div>
              <dt>Pemakaian 30 hari</dt>
              <dd>{wallet ? rp(wallet.spent30d) : "…"}</dd>
            </div>
            <div>
              <dt>Token 30 hari</dt>
              <dd>{wallet ? wallet.tokens30d.toLocaleString("id-ID") : "…"}</dd>
            </div>
            <div>
              <dt>Panggilan</dt>
              <dd>{wallet ? wallet.calls30d.toLocaleString("id-ID") : "…"}</dd>
            </div>
          </dl>
        </section>

        <section className="card" style={{ marginTop: "var(--space-m)" }}>
          <h2>Top up saldo</h2>
          <p style={{ color: "var(--ink-2)", fontSize: "var(--step--1)" }}>
            Saldo tidak kedaluwarsa. Biaya admin + service charge Midtrans 2% ditambahkan ke total pembayaran QRIS.
          </p>
          <div className="saldo-presets" role="group" aria-label="Nominal top up">
            {PRESETS.map((p) => (
              <button
                key={p}
                className={`btn ${amount === p ? "" : "btn--2"}`}
                aria-pressed={amount === p}
                onClick={() => setAmount(p)}
              >
                {rp(p)}
              </button>
            ))}
          </div>
          <div className="saldo-topup-row">
            <label>
              <span>Nominal (Rp)</span>
              <input
                className="input"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(Math.max(0, Number(e.target.value.replace(/[^\d]/g, "")) || 0))}
              />
            </label>
            <button className="btn" onClick={() => void topup()} disabled={busy || amount < 10_000}>
              Buat QRIS
            </button>
          </div>

          {qris && (
            <div className="qris-panel" role="status">
              <p>
                Scan QRIS untuk membayar <strong>{rp(qris.amount)}</strong> — saldo masuk {rp(qris.credits)}.
              </p>
              {qris.qrUrl ? (
                <img src={qris.qrUrl} alt="QRIS pembayaran" className="qris-panel__img" />
              ) : (
                <p style={{ fontFamily: "monospace", wordBreak: "break-all", fontSize: "var(--step--1)" }}>
                  {qris.qrContent}
                </p>
              )}
              <p style={{ color: "var(--ink-2)", fontSize: "var(--step--1)" }}>
                Berlaku sampai {new Date(qris.expiredAt).toLocaleString("id-ID")} · status diperbarui otomatis.
              </p>
              {dormant && (
                <button className="btn btn--2 btn--sm" onClick={() => void mockPay()} disabled={busy}>
                  Tandai lunas (mode uji)
                </button>
              )}
            </div>
          )}
        </section>

        <section style={{ marginTop: "var(--space-l)" }}>
          <h2>Riwayat saldo</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Waktu</th>
                  <th scope="col">Jenis</th>
                  <th scope="col">Jumlah</th>
                  <th scope="col">Model / token</th>
                  <th scope="col">Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.createdAt).toLocaleString("id-ID")}</td>
                    <td>{KIND_LABEL[r.kind] ?? r.kind}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {r.amount >= 0 ? "+" : "−"}
                      {rp(Math.abs(r.amount))}
                    </td>
                    <td>
                      {r.model
                        ? `${r.model} · ${(r.promptTokens + r.completionTokens).toLocaleString("id-ID")} tok`
                        : "-"}
                    </td>
                    <td>{r.refId || r.meta || "-"}</td>
                  </tr>
                ))}
                {ledger.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: "var(--ink-2)" }}>
                      Belum ada riwayat.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {isAdmin && !isPlatform && (
          <section style={{ marginTop: "var(--space-l)" }}>
            <h2>Saldo member</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Nama</th>
                    <th scope="col">Peran</th>
                    <th scope="col">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.userId}>
                      <td>{m.name}</td>
                      <td>{m.role}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {m.balance === null ? "—" : rp(m.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="saldo-topup-row" style={{ marginTop: "var(--space-s)" }}>
              <label>
                <span>Member</span>
                <select className="input" value={adjUser} onChange={(e) => setAdjUser(e.target.value)}>
                  <option value="">Pilih member…</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Nominal (Rp, boleh minus)</span>
                <input
                  className="input"
                  inputMode="numeric"
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value.replace(/[^\d-]/g, ""))}
                />
              </label>
              <label>
                <span>Catatan</span>
                <input className="input" value={adjNote} onChange={(e) => setAdjNote(e.target.value)} />
              </label>
              <button className="btn" onClick={() => void submitAdjust()} disabled={busy}>
                Simpan
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
