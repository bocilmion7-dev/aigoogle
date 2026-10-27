import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { getMe } from "../api";
import { AppHeader } from "../ui";
import { IconCheck, IconClock, IconCoin, IconPackage, IconRefresh, IconWallet } from "../icons";

interface TxRow {
  id: string;
  kind: string;
  amount: number;
  orderId: string;
  note: string;
  createdAt: string;
}
interface WithdrawalRow {
  id: string;
  amount: number;
  status: string;
  bankName: string;
  bankNo: string;
  accountName: string;
  note: string;
  createdAt: string;
}
interface BankAccount {
  id: string;
  bankShortCode: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  activityId: string;
  createdAt: string;
}
interface OrderRow {
  orderId: string;
  buyerName: string;
  buyerPhone: string;
  status: string;
  total: number;
  createdAt: string;
  accurate?: { salesInvoice?: { number: string }; salesReceipt?: { number: string }; salesOrder?: { number: string } };
}
interface SalesPayload {
  wallet: {
    balance: number;
    pendingWithdrawal: number;
    available: number;
    txs: TxRow[];
    withdrawals: WithdrawalRow[];
  };
  bankAccounts: BankAccount[];
  report: {
    totalOrders: number;
    totalAmount: number;
    monthOrders: number;
    monthAmount: number;
    daily: Array<{ date: string; salesTotal: number; salesCount: number }>;
  };
  orders: OrderRow[];
}

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const KIND_LABEL: Record<string, string> = {
  sale: "Penjualan",
  withdraw: "Penarikan",
  adjust: "Penyesuaian",
  refund: "Pengembalian",
};

// Bank ternama Indonesia + kode Brick (validasi akun rekening)
const BANK_OPTIONS: Array<{ shortCode: string; name: string }> = [
  { shortCode: "BCA", name: "BCA" },
  { shortCode: "BRI", name: "BRI" },
  { shortCode: "BNI", name: "BNI" },
  { shortCode: "MANDIRI", name: "Mandiri" },
  { shortCode: "BTN", name: "BTN" },
  { shortCode: "DANAMON", name: "Danamon" },
  { shortCode: "PERMATA", name: "Permata" },
  { shortCode: "CIMB_NIAGA", name: "CIMB Niaga" },
  { shortCode: "MEGA", name: "Bank Mega" },
  { shortCode: "MAYBANK", name: "Maybank" },
  { shortCode: "PANIN", name: "Panin" },
  { shortCode: "UOB", name: "UOB Indonesia" },
  { shortCode: "OCBC", name: "OCBC Indonesia" },
  { shortCode: "HSBC", name: "HSBC Indonesia" },
  { shortCode: "J_TRUST", name: "J Trust" },
  { shortCode: "MAYAPADA", name: "Mayapada" },
  { shortCode: "MUAMALAT", name: "Bank Muamalat" },
  { shortCode: "SINARMAS", name: "Bank Sinarmas" },
  { shortCode: "BUMI_ARTA", name: "Bank Bumi Arta" },
  { shortCode: "MASPION", name: "Bank Maspion" },
  { shortCode: "GANESHA", name: "Bank Ganesha" },
  { shortCode: "ICBC", name: "ICBC Indonesia" },
  { shortCode: "QNB", name: "QNB Indonesia" },
  { shortCode: "WOORI", name: "Woori Saudara" },
  { shortCode: "BSI", name: "Bank Syariah Indonesia (BSI)" },
  { shortCode: "KB_BUKOPIN", name: "KB Bank (Bukopin)" },
  { shortCode: "HANA", name: "Hana Bank / Line Bank" },
  { shortCode: "MNC", name: "MNC Bank" },
  { shortCode: "RAYA", name: "Bank Raya" },
  { shortCode: "SBI", name: "Bank SBI Indonesia" },
  { shortCode: "HIBANK", name: "Hibank" },
  { shortCode: "DBS", name: "DBS Indonesia" },
  { shortCode: "BTPN", name: "BTPN" },
  { shortCode: "BNC", name: "Bank Neo Commerce (BNC)" },
  { shortCode: "BCA_DIGITAL", name: "BCA Digital" },
  { shortCode: "NATIONALNOBU", name: "Nobu Bank" },
  { shortCode: "SAHABAT_SAMPOERNA", name: "Bank Sahabat Sampoerna" },
  { shortCode: "AMAR", name: "Amar Bank" },
  { shortCode: "SEABANK", name: "Seabank" },
  { shortCode: "BCA_SYR", name: "BCA Syariah" },
  { shortCode: "JAGO", name: "Bank Jago" },
  { shortCode: "BTPN_SYR", name: "BTPN Syariah" },
  { shortCode: "MULTI_ARTA_SENTOSA", name: "Bank MAS" },
  { shortCode: "MANTAP", name: "Bank Mandiri Taspen" },
  { shortCode: "VICTORIA_INTERNASIONAL", name: "Bank Victoria" },
  { shortCode: "ALLO", name: "Allo Bank" },
  { shortCode: "BJB", name: "Bank BJB" },
  { shortCode: "DKI", name: "Bank DKI" },
  { shortCode: "BPD_DIY", name: "Bank BPD DIY" },
  { shortCode: "JATENG", name: "Bank Jateng" },
  { shortCode: "JATIM", name: "Bank Jatim" },
  { shortCode: "ACEH", name: "Bank Aceh" },
  { shortCode: "SUMUT", name: "Bank Sumut" },
  { shortCode: "NAGARI", name: "Bank Nagari" },
  { shortCode: "SUMSEL_BABEL", name: "Bank Sumsel Babel" },
  { shortCode: "LAMPUNG", name: "Bank Lampung" },
  { shortCode: "KALBAR", name: "Bank Kalbar" },
  { shortCode: "KALTIMTARA", name: "Bankaltimtara" },
  { shortCode: "SULSELBAR", name: "Bank Sulselbar" },
  { shortCode: "SULUTGO", name: "Bank SulutGo" },
  { shortCode: "NTT", name: "Bank NTT" },
  { shortCode: "PAPUA", name: "Bank Papua" },
  { shortCode: "SULTENG", name: "Bank Sulteng" },
  { shortCode: "SULTRA", name: "Bank Sultra" },
  { shortCode: "BANTEN", name: "Bank Banten" },
  { shortCode: "ARTHA", name: "Bank Artha Graha" },
  { shortCode: "MESTIKA_DHARMA", name: "Bank Mestika Dharma" },
  { shortCode: "SHINHAN", name: "Shinhan Bank" },
  { shortCode: "INDEX_SELINDO", name: "Bank Index Selindo" },
  { shortCode: "CAPITAL", name: "Bank Capital" },
  { shortCode: "COMMONWEALTH", name: "Bank Commonwealth" },
  { shortCode: "KROM", name: "Krom Bank" },
  { shortCode: "JASA_JAKARTA", name: "Bank Jasa Jakarta / Saqu" },
  { shortCode: "INA_PERDANA", name: "Bank Ina Perdana" },
  { shortCode: "OKE", name: "OK! Bank" },
  { shortCode: "CITIBANK", name: "Citibank" },
  { shortCode: "STANDARD_CHARTERED", name: "Standard Chartered" },
  { shortCode: "PRIMA_MASTER", name: "BPR Prima Master" },
  { shortCode: "DANA", name: "DANA" },
  { shortCode: "GOPAY", name: "GoPay" },
  { shortCode: "LINKAJA", name: "LinkAja" },
  { shortCode: "OVO", name: "OVO" },
  { shortCode: "SHOPEEPAY", name: "ShopeePay" },
];
const bankLabel = (shortCode: string) => BANK_OPTIONS.find((b) => b.shortCode === shortCode)?.name ?? shortCode;

export function Penjualan() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [data, setData] = useState<SalesPayload | null>(null);
  const [tab, setTab] = useState<"dompet" | "laporan">("dompet");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [amount, setAmount] = useState(0);
  const [accountId, setAccountId] = useState("");
  const [newBankShortCode, setNewBankShortCode] = useState("");
  const [newBankNo, setNewBankNo] = useState("");
  const [busy, setBusy] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [reportMode, setReportMode] = useState<"all" | "single" | "range">("all");
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const monthStartKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const [filterDate, setFilterDate] = useState(todayKey);
  const [filterStart, setFilterStart] = useState(monthStartKey);
  const [filterEnd, setFilterEnd] = useState(todayKey);
  const [openSection, setOpenSection] = useState<"withdrawals" | "ledger" | "">("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sales");
      if (!res.ok) throw new Error("gagal memuat");
      setData((await res.json()) as SalesPayload);
      setErr("");
    } catch {
      setErr("Gagal memuat laporan.");
    }
  }, []);

  useEffect(() => {
    void getMe().then((m) => {
      setMe(m);
      setIsAdmin(!!m?.permissions?.includes("app:users.manage"));
    });
    void load();
  }, [load]);

  const wallet = data?.wallet;
  const report = data?.report;
  const orders = data?.orders ?? [];
  const txs = wallet?.txs ?? [];
  const withdrawals = wallet?.withdrawals ?? [];
  const bankAccounts = data?.bankAccounts ?? [];

  // Filter pesanan sukses berdasarkan tanggal tunggal / periode
  const filteredOrders = useMemo(() => {
    const day = (o: OrderRow) => String(o.createdAt ?? "").slice(0, 10);
    if (reportMode === "single" && filterDate) {
      return orders.filter((o) => day(o) === filterDate);
    }
    if (reportMode === "range") {
      if (filterStart && filterEnd) {
        return orders.filter((o) => day(o) >= filterStart && day(o) <= filterEnd);
      }
      if (filterStart) return orders.filter((o) => day(o) >= filterStart);
      if (filterEnd) return orders.filter((o) => day(o) <= filterEnd);
    }
    return orders;
  }, [orders, reportMode, filterDate, filterStart, filterEnd]);
  const filteredTotal = filteredOrders.reduce((s, o) => s + (Number(o.total ?? 0) || 0), 0);
  const pageCount = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedOrders = filteredOrders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // reset halaman saat filter berubah
  useEffect(() => {
    setPage(1);
  }, [reportMode, filterDate, filterStart, filterEnd]);

  if (me === undefined) return null;
  if (me === null) {
    window.location.href = "/login";
    return null;
  }

  async function submitWithdraw(e: FormEvent) {
    e.preventDefault();
    if (!accountId) {
      setErr("Pilih rekening tujuan penarikan.");
      return;
    }
    setBusy("wd");
    setErr("");
    setMsg("");
    try {
      const res = await fetch("/api/sales/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, bankAccountId: accountId }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErr(
          j.error === "minimal_penarikan"
            ? "Minimal penarikan Rp10.000."
            : j.error === "saldo_kurang"
              ? "Saldo tidak mencukupi."
              : j.error === "rekening_tidak_ditemukan"
                ? "Rekening tujuan tidak ditemukan."
                : j.error === "rekening_wajib"
                  ? "Simpan dulu rekening tujuan penarikan."
                  : j.error ?? "Gagal mengajukan penarikan."
        );
        return;
      }
      setMsg("Penarikan diajukan — menunggu diproses.");
      setWithdrawOpen(false);
      setAmount(0);
      setAccountId("");
      await load();
    } catch {
      setErr("Gagal mengajukan penarikan.");
    } finally {
      setBusy("");
    }
  }

  async function submitNewAccount(e: FormEvent) {
    e.preventDefault();
    setBusy("acc");
    setErr("");
    setMsg("");
    try {
      const res = await fetch("/api/sales/bank-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankShortCode: newBankShortCode, accountNo: newBankNo }),
      });
      const j = (await res.json()) as { error?: string; account?: BankAccount };
      if (!res.ok) {
        setErr(
          j.error === "validasi_belum_dikonfigurasi"
            ? "Validasi rekening (Brick) belum dikonfigurasi."
            : j.error === "rekening_sudah_ada"
              ? "Rekening ini sudah tersimpan."
              : j.error === "rekening_tidak_valid"
                ? "Rekening tidak valid — pastikan nomor rekening benar."
                : j.error === "validasi_gagal"
                  ? "Gagal memvalidasi rekening. Coba lagi."
                  : j.error ?? "Gagal menyimpan rekening."
        );
        return;
      }
      setMsg(`Rekening tervalidasi: ${j.account?.accountName}. Sekarang isi jumlah penarikan.`);
      setNewBankShortCode("");
      setNewBankNo("");
      if (j.account) setAccountId(j.account.id);
      await load();
    } catch {
      setErr("Gagal menyimpan rekening.");
    } finally {
      setBusy("");
    }
  }

  async function removeAccount(id: string) {
    if (!window.confirm("Hapus rekening ini?")) return;
    setBusy(`rm-${id}`);
    try {
      const res = await fetch(`/api/sales/bank-accounts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("gagal");
      setMsg("Rekening dihapus.");
      if (accountId === id) setAccountId("");
      await load();
    } catch {
      setErr("Gagal menghapus rekening.");
    } finally {
      setBusy("");
    }
  }

  async function updateStatus(id: string, status: "approved" | "paid" | "rejected") {
    setBusy(`st-${id}`);
    try {
      const res = await fetch(`/api/sales/withdraw/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("gagal");
      setMsg("Status penarikan diperbarui.");
      await load();
    } catch {
      setErr("Gagal memperbarui status.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="app">
      <AppHeader me={me} />
      <main className="page page--narrow">
        <header className="wa-head">
          <div>
            <h1>Penjualan</h1>
          </div>
        </header>

        {err && (
          <p className="banner banner--err" role="alert">
            {err}
          </p>
        )}
        {msg && (
          <p className="banner banner--ok" role="status">
            {msg}
          </p>
        )}

        <div className="tabs tabs--fill">
          <button type="button" className="tab" onClick={() => setTab("dompet")} aria-pressed={tab === "dompet"}>
            <IconWallet size={16} /> Dompet
          </button>
          <button type="button" className="tab" onClick={() => setTab("laporan")} aria-pressed={tab === "laporan"}>
            <IconRefresh size={16} /> Laporan Penjualan
          </button>
        </div>

        {tab === "dompet" && (
          <>
            {/* ── Hero wallet ── */}
            {wallet && (
              <section className="sales-hero">
                <div className="sales-hero__top">
                  <span className="sales-hero__badge">
                    <IconWallet size={15} /> Wallet Penjualan
                  </span>
                  <button
                    type="button"
                    className="sales-hero__cta"
                    onClick={() => {
                      if (!accountId && bankAccounts[0]) setAccountId(bankAccounts[0].id);
                      setAddAccountOpen(false);
                      setWithdrawOpen(true);
                    }}
                    disabled={wallet.available <= 0}
                    aria-busy={busy === "wd"}
                  >
                    <IconRefresh size={14} /> Tarik Dana
                  </button>
                </div>
                <span className="sales-hero__label">Saldo tersedia</span>
                <strong className="sales-hero__value">{rp(wallet.available)}</strong>
                <div className="sales-hero__meta">
                  <span>
                    Saldo total <strong>{rp(wallet.balance)}</strong>
                  </span>
                  {wallet.pendingWithdrawal > 0 && (
                    <span>
                      Dalam proses <strong>{rp(wallet.pendingWithdrawal)}</strong>
                    </span>
                  )}
                </div>
              </section>
            )}

            {/* ── Stat ringkasan ── */}
            <section className="sales-stats">
              <div className="sales-stat">
                <span className="sales-stat__icon"><IconPackage size={16} /></span>
                <div className="sales-stat__body">
                  <strong>{report?.totalOrders ?? 0}</strong>
                  <span>Pesanan sukses</span>
                </div>
              </div>
              <div className="sales-stat">
                <span className="sales-stat__icon"><IconCoin size={16} /></span>
                <div className="sales-stat__body">
                  <strong>{rp(report?.totalAmount ?? 0)}</strong>
                  <span>Total penjualan</span>
                </div>
              </div>
              <div className="sales-stat">
                <span className="sales-stat__icon"><IconClock size={16} /></span>
                <div className="sales-stat__body">
                  <strong>{report?.monthOrders ?? 0}</strong>
                  <span>Bulan ini</span>
                </div>
              </div>
              <div className="sales-stat">
                <span className="sales-stat__icon"><IconCoin size={16} /></span>
                <div className="sales-stat__body">
                  <strong>{rp(report?.monthAmount ?? 0)}</strong>
                  <span>Nominal bulan ini</span>
                </div>
              </div>
            </section>

            {/* ── Modal penarikan ── */}
            {withdrawOpen && (
              <div className="modal-overlay" onClick={() => setWithdrawOpen(false)}>
                <div
                  className="modal modal--withdraw"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="withdraw-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="modal__head">
                    <IconWallet size={18} />
                    <strong className="card__title" id="withdraw-title">
                      Tarik Dana
                    </strong>
                    <button type="button" className="modal__x" onClick={() => setWithdrawOpen(false)} aria-label="Tutup">
                      ×
                    </button>
                  </div>

                  <div className="wd-summary">
                    <span>Saldo tersedia</span>
                    <strong>{rp(wallet?.available ?? 0)}</strong>
                  </div>

                  {addAccountOpen || bankAccounts.length === 0 ? (
                    <form className="sales-withdraw" onSubmit={submitNewAccount}>
                      <p className="sales-empty-note">
                        Tambah rekening tujuan — nomor rekening divalidasi otomatis agar akun benar.
                      </p>
                      <label>
                        Bank
                        <select
                          className="input"
                          value={newBankShortCode}
                          onChange={(e) => setNewBankShortCode(e.target.value)}
                          required
                        >
                          <option value="">— Pilih bank —</option>
                          {BANK_OPTIONS.map((b) => (
                            <option key={b.shortCode} value={b.shortCode}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Nomor rekening
                        <input
                          className="input num"
                          inputMode="numeric"
                          value={newBankNo}
                          onChange={(e) => setNewBankNo(e.target.value.replace(/\D/g, ""))}
                          placeholder="1234567890"
                          required
                          minLength={8}
                        />
                      </label>
                      <div className="sales-withdraw__actions">
                        <button className="btn btn--primary" type="submit" disabled={busy === "acc" || !newBankShortCode || newBankNo.length < 8} aria-busy={busy === "acc"}>
                          {busy === "acc" ? "Memvalidasi…" : "Validasi & Simpan"}
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => {
                            if (bankAccounts.length > 0) {
                              setAddAccountOpen(false);
                              setNewBankShortCode("");
                              setNewBankNo("");
                            } else {
                              setWithdrawOpen(false);
                            }
                          }}
                        >
                          Batal
                        </button>
                      </div>
                    </form>
                  ) : (
                    <form className="sales-withdraw" onSubmit={submitWithdraw}>
                      <label>
                        Rekening tujuan
                        <select
                          className="input"
                          value={accountId || bankAccounts[0]?.id || ""}
                          onChange={(e) => setAccountId(e.target.value)}
                          required
                        >
                          {bankAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.bankName} · {a.accountNo} · {a.accountName}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="wd-add-account"
                          onClick={() => setAddAccountOpen(true)}
                          disabled={!!busy}
                        >
                          + Tambah rekening baru
                        </button>
                      </label>
                      <label>
                        Jumlah penarikan
                        <input
                          className="input num"
                          type="number"
                          inputMode="numeric"
                          min={10000}
                          value={amount || ""}
                          onChange={(e) => setAmount(Number(e.target.value))}
                          placeholder="Minimal 10.000"
                        />
                      </label>
                      <div className="wd-quick">
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAmount(wallet?.available ?? 0)}>
                          Semua saldo
                        </button>
                      </div>
                      {amount > 0 && amount < 10000 && (
                        <p className="wd-hint">Minimal penarikan Rp10.000.</p>
                      )}
                      <div className="sales-withdraw__actions">
                        <button className="btn btn--primary" type="submit" disabled={busy === "wd" || amount < 10000} aria-busy={busy === "wd"}>
                          {busy === "wd" ? "Mengajukan…" : `Tarik ${amount >= 10000 ? rp(amount) : "Dana"}`}
                        </button>
                        <button type="button" className="btn btn--ghost" onClick={() => setWithdrawOpen(false)}>
                          Batal
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            )}

            {/* ── Riwayat penarikan (expandable) ── */}
            {withdrawals.length > 0 && (
              <details className="wa-details card" open={openSection === "withdrawals"}>
                <summary onClick={(e) => { e.preventDefault(); setOpenSection(openSection === "withdrawals" ? "" : "withdrawals"); }}>
                  <strong>Riwayat Penarikan</strong>
                  <span className="meta">{withdrawals.length} pengajuan</span>
                </summary>
                <div className="wa-details-body">
                  <ul className="sales-list">
                    {withdrawals.map((w) => (
                      <li key={w.id} className="sales-list__row">
                        <div className="sales-list__main">
                          <strong>
                            {rp(w.amount)}
                            {w.accountName ? ` · ${w.accountName}` : ""}
                          </strong>
                          <span className="sales-list__meta">
                            {[w.bankName, w.bankNo].filter(Boolean).join(" ") || "Belum isi bank"} ·{" "}
                            {new Date(w.createdAt).toLocaleString("id-ID")}
                          </span>
                        </div>
                        <div className="sales-list__side">
                          <span className={`wf-badge is-${w.status === "paid" ? "ordered" : w.status === "rejected" ? "failed" : w.status === "approved" ? "sent" : "offer"}`}>
                            {w.status === "paid" ? "Dibayar" : w.status === "approved" ? "Disetujui" : w.status === "rejected" ? "Ditolak" : "Pending"}
                          </span>
                          {isAdmin && (w.status === "pending" || w.status === "approved") && (
                            <div className="sales-list__actions">
                              {w.status === "pending" && (
                                <button className="btn btn--sm" onClick={() => void updateStatus(w.id, "approved")} disabled={!!busy}>
                                  <IconCheck size={13} /> Setujui
                                </button>
                              )}
                              <button className="btn btn--sm" onClick={() => void updateStatus(w.id, "paid")} disabled={!!busy}>
                                Tandai Dibayar
                              </button>
                              <button className="btn btn--ghost btn--sm" onClick={() => void updateStatus(w.id, "rejected")} disabled={!!busy}>
                                Tolak
                              </button>
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}

            {/* ── Pergerakan saldo (expandable) ── */}
            {txs.length > 0 && (
              <details className="wa-details card" open={openSection === "ledger"}>
                <summary onClick={(e) => { e.preventDefault(); setOpenSection(openSection === "ledger" ? "" : "ledger"); }}>
                  <strong>Pergerakan Saldo</strong>
                  <span className="meta">{txs.length} catatan</span>
                </summary>
                <div className="wa-details-body">
                  <ul className="sales-ledger">
                    {txs.map((t) => (
                      <li key={t.id} className="sales-ledger__row">
                        <span className="sales-ledger__label">
                          {KIND_LABEL[t.kind] ?? t.kind}
                          {t.note ? <em>{t.note}</em> : null}
                        </span>
                        <span className={`sales-ledger__amount ${t.amount >= 0 ? "is-in" : "is-out"}`}>
                          {t.amount >= 0 ? "+" : "−"}
                          {rp(Math.abs(t.amount))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}
          </>
        )}

        {tab === "laporan" && (
          <>
            {/* ── Filter ── */}
            <section className="card sales-filter-card">
              <div className="segmented" role="group" aria-label="Filter laporan penjualan">
                <button type="button" className="segmented__btn" aria-pressed={reportMode === "all"} onClick={() => setReportMode("all")}>
                  Semua
                </button>
                <button type="button" className="segmented__btn" aria-pressed={reportMode === "single"} onClick={() => setReportMode("single")}>
                  Tanggal
                </button>
                <button type="button" className="segmented__btn" aria-pressed={reportMode === "range"} onClick={() => setReportMode("range")}>
                  Periode
                </button>
              </div>
              {reportMode === "single" && (
                <div className="sales-report-dates">
                  <label>
                    Tanggal
                    <input className="input" type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
                  </label>
                </div>
              )}
              {reportMode === "range" && (
                <div className="sales-report-dates">
                  <label>
                    Dari
                    <input className="input" type="date" value={filterStart} onChange={(e) => setFilterStart(e.target.value)} />
                  </label>
                  <label>
                    Sampai
                    <input className="input" type="date" value={filterEnd} onChange={(e) => setFilterEnd(e.target.value)} />
                  </label>
                </div>
              )}
            </section>

            {/* ── Ringkasan hasil filter ── */}
            <section className="sales-stats sales-stats--3">
              <div className="sales-stat">
                <span className="sales-stat__icon"><IconPackage size={16} /></span>
                <div className="sales-stat__body">
                  <strong>{filteredOrders.length}</strong>
                  <span>Pesanan terfilter</span>
                </div>
              </div>
              <div className="sales-stat">
                <span className="sales-stat__icon"><IconCoin size={16} /></span>
                <div className="sales-stat__body">
                  <strong>{rp(filteredTotal)}</strong>
                  <span>Total terfilter</span>
                </div>
              </div>
              <div className="sales-stat">
                <span className="sales-stat__icon"><IconClock size={16} /></span>
                <div className="sales-stat__body">
                  <strong>{rp(report?.monthAmount ?? 0)}</strong>
                  <span>Nominal bulan ini</span>
                </div>
              </div>
            </section>

            {/* ── Tabel pesanan ── */}
            <section className="card">
              <div className="wa-card-head">
                <strong className="card__title">Daftar Pesanan</strong>
                <span className="meta">{filteredOrders.length} pesanan · {rp(filteredTotal)}</span>
              </div>
              {filteredOrders.length === 0 ? (
                <p className="empty" style={{ padding: "1rem 0" }}>
                  Tidak ada pesanan pada rentang tanggal ini.
                </p>
              ) : (
                <div className="orders-list-wrap">
                  <table className="sales-table sales-table--desktop">
                    <thead>
                      <tr>
                        <th>Pesanan</th>
                        <th>Pembeli</th>
                        <th>Tanggal</th>
                        <th>Total</th>
                        <th>Dokumen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedOrders.map((o) => (
                        <tr key={o.orderId}>
                          <td className="num">{o.orderId}</td>
                          <td>{o.buyerName || o.buyerPhone}</td>
                          <td className="num">
                            {o.createdAt ? new Date(o.createdAt).toLocaleDateString("id-ID") : "—"}
                          </td>
                          <td className="num">{rp(Number(o.total ?? 0))}</td>
                          <td className="num">
                            {o.accurate?.salesReceipt
                              ? `Receipt ${o.accurate.salesReceipt.number}`
                              : o.accurate?.salesInvoice
                                ? `Invoice ${o.accurate.salesInvoice.number}`
                                : "Lunas"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="sales-cards">
                    {pagedOrders.map((o) => {
                      const doc = o.accurate?.salesReceipt
                        ? `Receipt ${o.accurate.salesReceipt.number}`
                        : o.accurate?.salesInvoice
                          ? `Invoice ${o.accurate.salesInvoice.number}`
                          : "Lunas";
                      return (
                        <details className="sales-order-card" key={o.orderId}>
                          <summary className="sales-order-card__summary">
                            <span className="sales-order-card__main">
                              <strong>{o.buyerName || o.buyerPhone}</strong>
                              <span className="sales-order-card__id">{o.orderId}</span>
                            </span>
                            <span className="sales-order-card__total">{rp(Number(o.total ?? 0))}</span>
                          </summary>
                          <dl className="sales-order-card__body">
                            <div>
                              <dt>Pesanan</dt>
                              <dd>{o.orderId}</dd>
                            </div>
                            <div>
                              <dt>Pembeli</dt>
                              <dd>{o.buyerName || o.buyerPhone}</dd>
                            </div>
                            <div>
                              <dt>Tanggal</dt>
                              <dd>{o.createdAt ? new Date(o.createdAt).toLocaleDateString("id-ID") : "—"}</dd>
                            </div>
                            <div>
                              <dt>Total</dt>
                              <dd>{rp(Number(o.total ?? 0))}</dd>
                            </div>
                            <div>
                              <dt>Dokumen</dt>
                              <dd>{doc}</dd>
                            </div>
                          </dl>
                        </details>
                      );
                    })}
                  </div>

                  {pageCount > 1 && (
                    <div className="sales-pager">
                      <button type="button" className="btn btn--sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
                        ‹
                      </button>
                      <span className="sales-pager__info">
                        {currentPage} / {pageCount}
                      </span>
                      <button type="button" className="btn btn--sm" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>
                        ›
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
