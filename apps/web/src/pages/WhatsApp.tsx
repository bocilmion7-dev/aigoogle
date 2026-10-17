import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader, PageLoader } from "../ui";
import { IconCheck } from "../icons";
// package.json paket menunjuk file yang tak ada — impor langsung bundel ESM aslinya
import { ConnectButton } from "360dialog-connect-button/dist/dialog-connect-button.esm.js";
import { getMe, getWaWebhookEvents, waD360Onboard, putWaSettings, putWaWebhookEvents, getWaWaserverSession, reconnectWaWaserver, disconnectWaWaserver, type WaWaserverSession, waSubscribe, getWaSubscribeStatus } from "../api";

interface WaStatus {
  connected: boolean;
  platformReady: boolean;
  waProvider: "meta" | "d360" | "waserver";
  waserverReady?: boolean;
  accountProvider: string | null;
  waD360PartnerId: string;
  account: { wabaId: string; phoneNumberId: string; displayName: string; status: string } | null;
  balance: number;
  costPerMessage: number;
  rupiahPerCredit: number;
  settings: { autoDueDate: boolean; dailyReport: boolean; ownerPhone: string };
  metaConfigured: boolean;
  embedUrl: string | null;
  billingEnabled: boolean;
  recent: Array<{ id: string; to: string; body: string; status: string; error: string; createdAt: string; direction?: string }>;

}

export function WhatsApp() {
  const [st, setSt] = useState<WaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(10000);
  const [busy, setBusy] = useState<"winpay" | "midtrans" | null>(null);
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [waAuto, setWaAuto] = useState(false);
  const [waDaily, setWaDaily] = useState(false);
  const [waPhone, setWaPhone] = useState("");
  const [waWh, setWaWh] = useState<{ events: string[]; rateMin: number; options: Array<{ key: string; label: string }> } | null>(null);
  const [admMsg, setAdmMsg] = useState<string | null>(null);
  const [admBusy, setAdmBusy] = useState(false);
  const [d360Msg, setD360Msg] = useState<string | null>(null);
  const [d360Busy, setD360Busy] = useState(false);
  const [qris, setQris] = useState<
    | {
        orderId: string;
        credits: number;
        amount: number;      // total yang dibayar (termasuk biaya admin)
        feeAmount: number;   // biaya admin 0.2%
        baseAmount: number;  // jumlah pokok tanpa biaya admin
        qrUrl: string;
        qrContent: string;
        expiredAt: string;
        provider: "winpay" | "midtrans";
      }
    | null
  >(null);
  const [topupMsg, setTopupMsg] = useState<string | null>(null);
  const [openMsg, setOpenMsg] = useState<string | null>(null);
  const [was, setWas] = useState<WaWaserverSession | null>(null);
  const [wasOpen, setWasOpen] = useState(false);
  const [wasBusy, setWasBusy] = useState<"load" | "reconnect" | "disconnect" | null>(null);
  const [wasMsg, setWasMsg] = useState<string | null>(null);
  const wasDialogRef = useRef<HTMLDivElement | null>(null);

  // ── Tab + langganan waserver ─────────────────────────────────────────────
  const [tab, setTab] = useState<"gateway" | "meta">("gateway");
  const [subOrder, setSubOrder] = useState<string | null>(null);
  const [subMsg, setSubMsg] = useState<string | null>(null);
  const [subBusy, setSubBusy] = useState(false);

  const load = useCallback(() => {
    void fetch("/api/wa/status")
      .then(async (r) => {
        if (r.status === 401) {
          window.location.href = "/login";
          return null;
        }
        if (!r.ok) throw new Error("gagal");
        return r.json() as Promise<WaStatus>;
      })
      .then((j) => {
        if (!j) return;
        setSt({ ...j, recent: j.recent ?? [], settings: j.settings ?? { autoDueDate: false, dailyReport: false, ownerPhone: "" } });
      })
      .catch(() => setError("Gagal memuat status WhatsApp."));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // ── Waserver ───────────────────────────────────────────────────────────
  // Sesi + QR HANYA diminta saat tombol "Hubungkan" ditekan. Membuka halaman
  // tidak menyentuh gateway Baileys sama sekali — QR jadi tidak dipanggil
  // berulang-ulang dari server WhatsApp tiap kali halaman dimuat.
  const loadWas = useCallback(() => {
    setWasBusy("load");
    getWaWaserverSession()
      .then((j) => {
        setWas(j);
        setWasMsg(null);
        if (j.connected) {
          setWasOpen(false);
          load(); // begitu terhubung, muat ulang status agar saldo & riwayat ikut segar
        }
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "";
        setWasMsg(
          msg === "waserver_tidak_terjangkau"
            ? "Gateway waserver tidak terjangkau — hubungi pengurus sistem."
            : msg === "waserver_belum_dikonfigurasi"
              ? "Gateway waserver belum dikonfigurasi di server."
              : "Gagal menghubungi gateway waserver."
        );
        setWasOpen(false);
      })
      .finally(() => setWasBusy(null));
  }, [load]);

  function wasOpenModal() {
    setWasMsg(null);
    setWas(null);
    setWasOpen(true);
    loadWas();
  }

  function wasCloseModal() {
    setWasOpen(false);
  }

  // QR baru terbentuk beberapa saat setelah sesi dibuat — poll HANYA selama popup terbuka
  const wasPending = wasOpen && !!was && !was.connected;
  useEffect(() => {
    if (!wasPending) return;
    const t = window.setInterval(() => loadWas(), 4000);
    return () => window.clearInterval(t);
  }, [wasPending, loadWas]);

  // Esc menutup popup; fokus dikembalikan ke tombol pemicu
  useEffect(() => {
    if (!wasOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWasOpen(false);
    };
    window.addEventListener("keydown", onKey);
    wasDialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [wasOpen]);

  async function wasReconnect() {
    setWasBusy("reconnect");
    setWasMsg(null);
    setWas(null);
    try {
      await reconnectWaWaserver();
      wasOpenModal();
    } catch {
      setWasMsg("Gagal menyambungkan ulang sesi.");
      setWasBusy(null);
    }
  }

  async function wasDisconnect() {
    if (!window.confirm("Putuskan WhatsApp? Nomor harus di-scan QR ulang untuk terhubung kembali.")) return;
    setWasBusy("disconnect");
    setWasMsg(null);
    try {
      await disconnectWaWaserver();
      setWas(null);
      load();
    } catch {
      setWasMsg("Gagal memutus sesi.");
    } finally {
      setWasBusy(null);
    }
  }

  useEffect(() => {
    void getMe().then(setMe);
  }, []);
  const isAdmin = !!me?.permissions?.includes("app:users.manage");

  // polling status topup selama QRIS tampil
  useEffect(() => {
    if (!qris) return;
    const t = window.setInterval(() => {
      void fetch(`/api/wa/topup/${qris.orderId}/status`)
        .then((r) => (r.ok ? (r.json() as Promise<{ status: string; settled: boolean; credits: number }>) : null))
        .then((j) => {
          if (!j) return;
          if (j.settled) {
            setQris(null);
            setTopupMsg(`Pembayaran berhasil — +${j.credits} kredit masuk ke saldo.`);
            load();
          } else if (j.status === "cancel" || j.status === "expire") {
            setQris(null);
            setTopupMsg(null);
            setError("QRIS kedaluwarsa atau dibatalkan.");
          }
        })
        .catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(t);
  }, [qris, load]);
  useEffect(() => {
    if (!isAdmin || !st) return;
    setWaAuto(!!st.settings?.autoDueDate);
    setWaDaily(!!st.settings?.dailyReport);
    setWaPhone(st.settings?.ownerPhone ?? "");
    void getWaWebhookEvents()
      .then((s) => setWaWh({ events: s.events ?? [], rateMin: s.rateMin ?? 10, options: s.options ?? [] }))
      .catch(() => undefined);
  }, [isAdmin, st]);

  // callback Connect Button: klien selesai Embedded Signup → generate & simpan API key channel.
  // useCallback WAJIB — component memanggil ulang callback di tiap render bila identity berubah,
  // dan query ?client=&channels= dibersihkan agar onboarding tidak terpicu berulang.
  const onboardD360 = useCallback(
    async (client: string, channels: string[]) => {
      if (d360Busy) return;
      setD360Busy(true);
      setD360Msg(null);
      window.history.replaceState({}, "", "/whatsapp");
      try {
        await waD360Onboard(client, channels);
        setD360Msg("Nomor WhatsApp terhubung.");
        load();
      } catch (e) {
        setD360Msg(
          e instanceof Error && e.message.includes("d360_")
            ? "Pendaftaran belum selesai diproses — coba lagi beberapa saat."
            : "Gagal menghubungkan nomor."
        );
      } finally {
        setD360Busy(false);
      }
    },
    [d360Busy, load]
  );

  function fmtStamp(iso: string): string {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  async function saveAdmin() {
    setError(null);
    setAdmMsg(null);
    setAdmBusy(true);
    try {
      await putWaSettings({ autoDueDate: waAuto, dailyReport: waDaily, ownerPhone: waPhone });
      if (waWh) await putWaWebhookEvents({ events: waWh.events, rateMin: waWh.rateMin });
      setAdmMsg("Setelan perusahaan disimpan.");
      load();
    } catch {
      setAdmMsg("Gagal menyimpan setelan.");
    } finally {
      setAdmBusy(false);
    }
  }

  // polling status langganan waserver selama QR tampil
  // WAJIB diletakkan sebelum early return if(!st) — jika tidak, jumlah hook
  // berubah antar render (React #310: "Rendered more hooks than during the
  // previous render") dan halaman blank.
  useEffect(() => {
    if (!subOrder) return;
    const t = window.setInterval(() => {
      void getWaSubscribeStatus(subOrder)
        .then((j) => {
          if (j.settled) {
            setSubOrder(null);
            setSubMsg("Langganan WhatsApp Gateway aktif.");
            load();
          } else if (j.status === "cancel" || j.status === "expire") {
            setSubOrder(null);
            setSubMsg(null);
            setError("Langganan dibatalkan atau kedaluwarsa.");
          }
        })
        .catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(t);
  }, [subOrder, load]);

  if (!st) {
    return (
      <div className="app">
        <AppHeader />
        <main className="page page--narrow">
          <PageLoader />
        </main>
      </div>
    );
  }

  async function topup(provider: "winpay" | "midtrans" = "winpay") {
    setError(null);
    setTopupMsg(null);
    setQris(null);
    setBusy(provider);
    try {
      const res = await fetch("/api/wa/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, provider }),
      });
      const j = (await res.json()) as {
        error?: string;
        orderId?: string;
        credits?: number;
        min?: number;
        amount?: number;      // total (termasuk fee)
        feeAmount?: number;   // biaya admin 0.2%
        baseAmount?: number;  // jumlah pokok
        provider?: "winpay" | "midtrans";
        qris?: { qrUrl: string; qrContent: string; contractId?: string; referenceNo?: string; expiredAt: string };
      };
      if (res.ok && j.qris && j.orderId) {
        setTopupMsg(null);
        setQris({
          orderId: j.orderId,
          credits: j.credits ?? 0,
          amount: j.amount ?? amount,
          feeAmount: j.feeAmount ?? 0,
          baseAmount: j.baseAmount ?? amount,
          provider: j.provider ?? provider,
          ...j.qris,
        });
        return;
      }
      if (res.status === 503 && j.orderId) {
        const s = await fetch(`/api/wa/topup/${j.orderId}/mock-settle`, { method: "POST" });
        if (s.ok) {
          load();
          alert(`Topup mock settle: +${j.credits} kredit`);
          return;
        }
      }
      if (!res.ok) {
        setError(
          j.error === "minimal_topup"
            ? `Minimal topup Rp ${(j.min ?? 200).toLocaleString("id-ID")}`
            : j.error === "qris_gagal"
              ? "Gagal membuat kode QRIS — coba lagi."
              : j.error ?? "Gagal topup"
        );
      } else load();
    } finally {
      setBusy(null);
    }
  }

  async function subscribe(plan: "1bulan" | "2bulan" | "3bulan") {
    setError(null);
    setSubMsg(null);
    setSubOrder(null);
    setSubBusy(true);
    try {
      const j = await waSubscribe(plan);
      setSubOrder(j.orderId);
    } catch {
      setSubMsg("Gagal membuat pesanan langganan — coba lagi.");
    } finally {
      setSubBusy(false);
    }
  }

  return (
    <div className="app">
      <AppHeader />
      <main className="page page--narrow">
        <h1>WhatsApp Gateway Platform</h1>
        <p className="page__sub">
          Kirim & terima pesan WhatsApp lewat dua saluran: <strong>Gateway WhatsApp</strong> (self-hosted via
          Baileys, langganan bulanan) dan <strong>WhatsApp META</strong> (Business Platform resmi, pembelian kredit).
          Pilih tab di bawah untuk mengelola masing-masing saluran.
        </p>

        <div className="tabs">
          <button
            type="button"
            className={`tabs__btn ${tab === "gateway" ? "tabs__btn--active" : ""}`}
            onClick={() => setTab("gateway")}
            aria-pressed={tab === "gateway"}
          >
            WhatsApp Gateway
          </button>
          <button
            type="button"
            className={`tabs__btn ${tab === "meta" ? "tabs__btn--active" : ""}`}
            onClick={() => setTab("meta")}
            aria-pressed={tab === "meta"}
          >
            WhatsApp META
          </button>
        </div>

        {/* ── Tab 1: WhatsApp Gateway (waserver) ── */}
        {tab === "gateway" && (
          <>
            <section className="card">
              <strong className="card__title">Status WhatsApp Gateway</strong>
              {st.waProvider === "waserver" && st.connected ? (
                <>
                  <p className="small muted" style={{ margin: "0 0 4px" }}>
                    Terhubung{st.account?.displayName ? ` — nomor ${st.account.displayName}` : ""}
                    <span className="trust-tag">
                      <IconCheck size={14} /> Gateway Baileys
                    </span>
                  </p>
                  <p className="small" style={{ margin: 0 }}>
                    Saldo: <strong className="num">{st.balance}</strong> kredit ·{" "}
                    <span className="num">{st.rupiahPerCredit}</span> Rp/kirim
                  </p>
                </>
              ) : (
                <>
                  <p className="small muted" style={{ margin: "0 0 4px" }}>
                    Belum terhubung
                  </p>
                  <p className="small" style={{ margin: 0 }}>
                    Silakan scan QR di bawah untuk menghubungkan nomor WhatsApp ke gateway waserver.
                  </p>
                </>
              )}
              {wasMsg && (
                <p className="banner banner--err" role="alert" style={{ marginTop: "var(--space-xs)", marginBottom: 0 }}>
                  {wasMsg}
                </p>
              )}
              <div style={{ display: "flex", gap: "var(--space-xs)", marginTop: "var(--space-m)", flexWrap: "wrap" }}>
                {!st.connected && (
                  <button
                    type="button"
                    className="btn"
                    onClick={wasOpenModal}
                    disabled={!!wasBusy}
                    aria-busy={!!wasBusy}
                  >
                    {wasBusy === "load" && <span className="spinner" aria-hidden="true" />}
                    Hubungkan WhatsApp
                  </button>
                )}
                {st.connected && (
                  <button
                    type="button"
                    className="btn btn--2"
                    onClick={() => void wasReconnect()}
                    disabled={!!wasBusy}
                    aria-busy={!!wasBusy}
                  >
                    {wasBusy === "reconnect" && <span className="spinner" aria-hidden="true" />}
                    Sambungkan ulang
                  </button>
                )}
                {st.connected && (
                  <button
                    type="button"
                    className="btn btn--2"
                    onClick={() => void wasDisconnect()}
                    disabled={!!wasBusy}
                  >
                    Putuskan
                  </button>
                )}
              </div>
            </section>

            <section className="card">
              <strong className="card__title">Langganan WhatsApp Gateway (Midtrans)</strong>
              <p className="meta">
                Aktifkan akses gateway waserver lewat langganan bulanan dibayar via Midtrans QRIS.
              </p>
              <div className="grid-2" style={{ marginTop: "var(--space-xs)" }}>
                <button
                  type="button"
                  className="btn btn--block"
                  onClick={() => void subscribe("1bulan")}
                  disabled={subBusy || subOrder !== null}
                  aria-busy={subBusy}
                >
                  {subBusy && <span className="spinner" aria-hidden="true" />}
                  1 Bulan · 30.000 Rp
                </button>
                <button
                  type="button"
                  className="btn btn--block"
                  onClick={() => void subscribe("2bulan")}
                  disabled={subBusy || subOrder !== null}
                  aria-busy={subBusy}
                >
                  {subBusy && <span className="spinner" aria-hidden="true" />}
                  2 Bulan · 50.000 Rp
                </button>
                <button
                  type="button"
                  className="btn btn--block"
                  onClick={() => void subscribe("3bulan")}
                  disabled={subBusy || subOrder !== null}
                  aria-busy={subBusy}
                >
                  {subBusy && <span className="spinner" aria-hidden="true" />}
                  3 Bulan · 75.000 Rp
                </button>
              </div>
              {subMsg && (
                <p className="banner banner--ok" role="status" style={{ marginTop: "var(--space-xs)", marginBottom: 0 }}>
                  {subMsg}
                </p>
              )}
              {error && (
                <p className="banner banner--err" role="alert" style={{ marginTop: "var(--space-xs)", marginBottom: 0 }}>
                  {error}
                </p>
              )}
              {subOrder && (
                <div className="qris-panel" role="status">
                  <p className="meta" style={{ margin: "0 0 var(--space-xs)", fontWeight: 600 }}>
                    Pembayaran langganan via QRIS Midtrans · order {subOrder}
                  </p>
                  <p className="meta" style={{ margin: "0 0 var(--space-xs)" }}>
                    <span className="busy-dot" aria-hidden="true" /> Menunggu pembayaran…
                  </p>
                  <button
                    className="btn btn--2 btn--block"
                    style={{ marginTop: "var(--space-xs)" }}
                    onClick={() => setSubOrder(null)}
                  >
                    Tutup
                  </button>
                </div>
              )}
            </section>
          </>
        )}

        {/* ── Tab 2: WhatsApp META ── */}
        {tab === "meta" && (
          <>
            <section className="card">
              <strong className="card__title">Status WhatsApp META</strong>
              {(st.waProvider === "d360" || st.waProvider === "meta") && st.connected ? (
                <>
                  <p className="small muted" style={{ margin: "0 0 4px" }}>
                    Terhubung{st.account?.displayName ? ` (${st.account.displayName})` : ""}
                    <span className="trust-tag">
                      <IconCheck size={14} /> WhatsApp Business resmi Meta
                    </span>
                  </p>
                  <p className="small" style={{ margin: 0 }}>
                    Saldo: <strong className="num">{st.balance}</strong> kredit ·{" "}
                    <span className="num">{st.rupiahPerCredit}</span> Rp/kirim
                  </p>
                </>
              ) : (
                <>
                  <p className="small muted" style={{ margin: "0 0 4px" }}>
                    Belum terhubung
                  </p>
                  <p className="small" style={{ margin: 0 }}>
                    Daftarkan nomor bisnis lewat Meta Embedded Signup atau Connect Button di bawah.
                  </p>
                </>
              )}
              {d360Msg && <p className="banner banner--ok" role="status" style={{ marginTop: "var(--space-xs)", marginBottom: 0 }}>{d360Msg}</p>}
              <div style={{ marginTop: "var(--space-m)" }}>
                {st.waProvider === "d360" && (
                  <>
                    <div className="wa-connect">
                      <ConnectButton
                        partnerId={st.waD360PartnerId}
                        label="Hubungkan WhatsApp Bisnis"
                        callback={(cb) => void onboardD360(cb.client, cb.channels)}
                      />
                    </div>
                    {d360Busy && (
                      <p className="meta" style={{ margin: "var(--space-xs) 0 0" }}>
                        <span className="spinner" aria-hidden="true" /> Memproses…
                      </p>
                    )}
                    {st.connected ? (
                      <p className="banner banner--ok" role="status" style={{ marginTop: "var(--space-xs)", marginBottom: 0 }}>
                        Nomor WhatsApp Business perusahaan terhubung — notifikasi & otomasi siap dikirim lewat saluran resmi Meta.
                      </p>
                    ) : null}
                  </>
                )}
                {st.waProvider === "meta" && (
                  <>
                    <p className="meta">
                      Daftarkan nomor bisnis Anda lewat formulir Embedded Signup resmi Meta di bawah —
                      setelah disetujui Meta, nomor aktif sebagai WhatsApp Business Platform resmi.
                    </p>
                    <p className="trust-line">
                      <IconCheck size={15} /> Saluran resmi Meta Cloud API — aman & sesuai kebijakan WhatsApp.
                    </p>
                    {st.embedUrl ? (
                      <iframe title="Meta WhatsApp Embedded Signup" src={st.embedUrl} className="embed" />
                    ) : (
                      <p className="meta" style={{ marginBottom: 0 }}>
                        Formulir belum tersedia — hubungi pengurus sistem.
                      </p>
                    )}
                  </>
                )}
                {(st.waProvider !== "d360" && st.waProvider !== "meta") && (
                  <p className="meta">
                    Provider WhatsApp saat ini adalah{" "}
                    <strong>{st.waProvider === "waserver" ? "Waserver Gateway" : st.waProvider}</strong>. Untuk pakai
                    WhatsApp META, ubah penyedia di menu Pengaturan (Admin Platform).
                  </p>
                )}
              </div>
            </section>

            <section className="card">
              <strong className="card__title">Topup Saldo WhatsApp META</strong>
              <p className="meta">
                1 kredit = <span className="num">{st.rupiahPerCredit}</span> rupiah (biaya kirim 1 pesan).{" "}
                <span style={{ color: "var(--muted)" }}>Ditambah biaya admin service charges 0,2%.</span>
              </p>
              <label className="field" style={{ display: "block" }}>
                Jumlah rupiah (pokok)
                <input
                  className="input num"
                  type="number"
                  inputMode="numeric"
                  min={2000}
                  step={1000}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
              </label>
              <p className="meta" style={{ margin: "4px 0 0" }}>
                Total dibayar:{" "}
                {(amount + Math.floor(amount * 0.002)).toLocaleString("id-ID")} Rp
                (termasuk biaya admin 0,2% ·{" "}
                <span className="num">
                  {Math.floor(amount / st.rupiahPerCredit)} kredit
                </span>
                )
              </p>
              <button
                className="btn btn--block"
                style={{ marginTop: "var(--space-xs)" }}
                onClick={() => void topup()}
                disabled={busy !== null}
                aria-busy={busy === "winpay"}
                aria-label="Topup saldo WhatsApp META"
              >
                {busy === "winpay" && <span className="spinner" aria-hidden="true" />}
                {busy === "winpay"
                  ? "Memproses…"
                  : `Topup ${amount.toLocaleString("id-ID")} Rp (+0,2% admin)`}
              </button>
              <button
                className="btn btn--2 btn--block"
                style={{ marginTop: "var(--space-xs)" }}
                onClick={() => void topup("midtrans")}
                disabled={busy !== null}
                aria-busy={busy === "midtrans"}
                aria-label="Topup saldo META via Midtrans QRIS"
              >
                {busy === "midtrans" && <span className="spinner" aria-hidden="true" />}
                {busy === "midtrans"
                  ? "Memproses…"
                  : `Topup via Midtrans ${amount.toLocaleString("id-ID")} Rp (+0,2% admin)`}
              </button>
              {topupMsg && (
                <p className="banner banner--ok" role="status" style={{ marginTop: "var(--space-xs)", marginBottom: 0 }}>
                  {topupMsg}
                </p>
              )}
              {error && (
                <p className="banner banner--err" role="alert" style={{ marginTop: "var(--space-xs)", marginBottom: 0 }}>
                  {error}
                </p>
              )}
              {qris && (
                <div className="qris-panel" role="status">
                  <p
                    className="meta"
                    style={{
                      margin: "0 0 var(--space-xs)",
                      fontWeight: 600,
                      color: qris.provider === "midtrans" ? "var(--accent-strong)" : "var(--ink)",
                    }}
                  >
                    {qris.provider === "midtrans" ? "Pembayaran via QRIS Midtrans" : "Pembayaran via QRIS Winpay"}
                    <span className="meta" style={{ fontWeight: 400 }}>
                      {" "}
                      · order {qris.orderId}
                    </span>
                  </p>
                  <img src={qris.qrUrl} alt="Kode QRIS pembayaran" width={200} height={200} />
                  <div className="qris-info">
                    <strong>
                      {qris.baseAmount.toLocaleString("id-ID")} Rp · {qris.credits} kredit
                    </strong>
                    <p className="meta" style={{ margin: "4px 0 0" }}>
                      Biaya admin 0,2%:{" "}
                      {qris.feeAmount.toLocaleString("id-ID")} Rp · Total: {qris.amount.toLocaleString("id-ID")} Rp
                    </p>
                    <p className="meta" style={{ margin: "4px 0 0" }}>
                      Scan dengan aplikasi pembayaran apa pun (m-Banking, GoPay, OVO, DANA). Berlaku sampai{" "}
                      {qris.expiredAt
                        ? new Date(qris.expiredAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
                        : "15 menit lagi"}
                      .
                    </p>
                    <p className="meta" style={{ margin: "4px 0 0" }}>
                      <span className="busy-dot" aria-hidden="true" /> Menunggu pembayaran…
                    </p>
                    <button
                      className="btn btn--2 btn--block"
                      style={{ marginTop: "var(--space-xs)" }}
                      onClick={() => {
                        setQris(null);
                        setTopupMsg(null);
                      }}
                    >
                      Tutup
                    </button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {isAdmin && (
          <section className="card">
            <strong className="card__title">Setelan perusahaan — Otomasi WhatsApp</strong>
            <div className="stack" style={{ gap: 0 }}>
              <label className="check check--sm">
                <input type="checkbox" checked={waAuto} onChange={(e) => setWaAuto(e.target.checked)} />
                <span>Ingatkan tagihan jatuh tempo ke pelanggan</span>
              </label>
              <label className="check check--sm">
                <input type="checkbox" checked={waDaily} onChange={(e) => setWaDaily(e.target.checked)} />
                <span>Laporan harian ke pemilik usaha (jam 08.00)</span>
              </label>
            </div>
            <label className="field" style={{ maxWidth: 300, marginTop: "var(--space-xs)" }}>
              Nomor WhatsApp pemilik (format 62…)
              <input
                className="input num"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={waPhone}
                onChange={(e) => setWaPhone(e.target.value)}
                placeholder="628123456789"
              />
            </label>

            <strong className="card__title" style={{ marginTop: "var(--space-s)" }}>
              Notifikasi perubahan data Accurate
            </strong>
            <p className="small muted" style={{ margin: "0 0 var(--space-xs)" }}>
              Kirim WhatsApp otomatis ke nomor pemilik setiap ada perubahan data yang dipilih — dibatasi sekali
              per jeda per jenis data agar tidak spam.
            </p>
            <div className="stack" style={{ gap: 0 }}>
              {(waWh?.options ?? []).map((o) => (
                <label className="check check--sm" key={o.key}>
                  <input
                    type="checkbox"
                    checked={waWh?.events.includes(o.key) ?? false}
                    onChange={(e) =>
                      setWaWh((s) =>
                        s
                          ? { ...s, events: e.target.checked ? [...s.events, o.key] : s.events.filter((x) => x !== o.key) }
                          : s
                      )
                    }
                  />
                  <span>{o.label}</span>
                </label>
              ))}
            </div>
            <label className="field" style={{ maxWidth: 220, marginTop: "var(--space-xs)" }}>
              Jeda antar-notifikasi per jenis data (menit)
              <input
                className="input num"
                type="number"
                inputMode="numeric"
                min={1}
                max={1440}
                value={waWh?.rateMin ?? 10}
                onChange={(e) => setWaWh((s) => (s ? { ...s, rateMin: Number(e.target.value) } : s))}
              />
            </label>
            {admMsg && <p className="banner banner--ok" role="status" style={{ marginTop: "var(--space-xs)", marginBottom: 0 }}>{admMsg}</p>}
            <button
              className="btn btn--block"
              style={{ marginTop: "var(--space-xs)" }}
              onClick={() => void saveAdmin()}
              disabled={admBusy}
              aria-busy={admBusy}
            >
              {admBusy && <span className="spinner" aria-hidden="true" />}
              Simpan setelan perusahaan
            </button>
          </section>
        )}

        <section className="card">
          <strong className="card__title">Riwayat pesan (20 terakhir)</strong>
          {st.recent.length === 0 ? (
            <p className="empty" style={{ padding: "var(--space-m) 0" }}>
              Belum ada pesan terkirim.
            </p>
          ) : (
            <ul className="file-list msg-list">
              {st.recent.map((m, i) => {
                const open = openMsg === m.id;
                const isIn = m.direction === "in";
                const label = isIn
                  ? "Masuk"
                  : m.status === "sent"
                    ? "Terkirim"
                    : m.status === "queued"
                      ? "Antre"
                      : m.status === "pending"
                        ? "Tertunda"
                        : "Gagal";
                const tone = isIn || m.status === "sent" ? "sent" : m.status === "queued" || m.status === "pending" ? "pending" : "failed";
                const errText =
                  m.error === "belum_connect"
                    ? "Nomor belum terhubung"
                    : m.error.startsWith("waserver_")
                      ? "Gateway waserver menolak"
                      : m.error.includes("rate")
                        ? "Batas kirim tercapai"
                        : m.error
                          ? "Gagal dikirim"
                          : "";
                return (
                  <li key={m.id} className="file-row msg-row">
                    <button
                      type="button"
                      className="msg-row__head"
                      aria-expanded={open}
                      onClick={() => setOpenMsg(open ? null : m.id)}
                    >
                      <span className="msg-row__no num">{i + 1}</span>
                      <span className="msg-row__time num">{fmtStamp(m.createdAt)}</span>
                      <span className="msg-row__to num">{m.to}</span>
                      <span className={`msg-row__status is-${tone}`}>
                        {label}
                      </span>
                      <span className="msg-row__snippet muted">{m.body.slice(0, 60)}</span>
                    </button>
                    <div className="msg-row__detail" hidden={!open}>
                      {m.body}
                      {errText && <p className="msg-row__err">{errText}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      {wasOpen && (
        <div className="modal-overlay" onClick={wasCloseModal}>
          <div
            className="modal modal--qr"
            role="dialog"
            aria-modal="true"
            aria-labelledby="was-qr-title"
            ref={wasDialogRef}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__head">
              {wasBusy === "load" && <span className="modal__spin" aria-hidden="true" />}
              <strong className="card__title" id="was-qr-title">
                Hubungkan WhatsApp
              </strong>
              <button
                type="button"
                className="btn btn--2 btn--sm"
                onClick={wasCloseModal}
                aria-label="Tutup"
              >
                Tutup
              </button>
            </div>

            {was?.qr ? (
              <>
                <div className="qr-card">
                  <img src={was.qr} alt="QR login WhatsApp" width={220} height={220} />
                  <p className="qr-card__status" role="status" aria-live="polite">
                    {was.connected ? "Terhubung." : "Menunggu pemindaian…"}
                  </p>
                </div>
                <p className="qr-card__hint">
                  Buka HP tuan rumah: WhatsApp → <kbd>Perangkat tertaut</kbd> → <kbd>Tautkan perangkat</kbd>,
                  lalu arahkan kamera ke QR. QR kedaluwarsa otomatis dan diganti —
                  tekan <strong>Muat ulang QR</strong> bila perlu.
                </p>
                <div className="modal__foot">
                  <button
                    type="button"
                    className="btn btn--2"
                    onClick={() => loadWas()}
                    disabled={!!wasBusy}
                    aria-busy={!!wasBusy}
                  >
                    {wasBusy === "load" && <span className="spinner" aria-hidden="true" />}
                    Muat ulang QR
                  </button>
                  <button type="button" className="btn" onClick={wasCloseModal}>
                    Selesai
                  </button>
                </div>
              </>
            ) : wasMsg ? (
              <>
                <p className="banner banner--err" role="alert" style={{ margin: 0 }}>
                  {wasMsg}
                </p>
                <div className="modal__foot">
                  <button type="button" className="btn" onClick={wasCloseModal}>
                    Tutup
                  </button>
                </div>
              </>
            ) : (
              <p className="modal__empty" role="status">
                <span className="spinner" aria-hidden="true" /> Menyiapkan sesi WhatsApp…
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
