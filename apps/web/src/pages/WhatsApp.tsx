import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader, PageLoader } from "../ui";
import { IconActivity, IconBell, IconChat, IconCheck, IconClock, IconLink, IconPackage, IconPhone, IconPower, IconQr, IconRefresh, IconSend, IconSettings, IconWallet } from "../icons";
// package.json paket menunjuk file yang tak ada — impor langsung bundel ESM aslinya
import { getMe, getWaWebhookEvents, putWaSettings, putWaWebhookEvents, getWaWaserverSession, reconnectWaWaserver, disconnectWaWaserver, type WaWaserverSession, waSubscribe, getWaSubscribeStatus, type WaSubscribeResult } from "../api";
import { DEFAULT_WA_META_TOPUPS, DEFAULT_WA_SUB_PLANS, type WaMetaTopup, type WaSubPlan } from "@aigoogle/shared";

interface WaStatus {
  connected: boolean;
  waProvider: "meta" | "waserver";
  waserverReady?: boolean;
  accountProvider: string | null;
  account: { wabaId: string; phoneNumberId: string; displayName: string; status: string } | null;
  balance: number;
  costPerMessage: number;
  rupiahPerCredit: number;
  settings: { autoDueDate: boolean; dailyReport: boolean; ownerPhone: string; shopAi?: boolean };
  metaConfigured: boolean;
  embedUrl: string | null;
  billingEnabled: boolean;
  subPlans?: WaSubPlan[];
  metaTopups?: WaMetaTopup[];
  waSubscription?: { plan: string; status: string; expiresAt: string | null; active: boolean } | null;
  recent: Array<{ id: string; to: string; body: string; status: string; error: string; createdAt: string; direction?: string }>;

}

/** Hanya izinkan iframe Embedded Signup dari domain resmi Meta/Facebook. */
function safeMetaEmbedUrl(raw?: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function WhatsApp() {
  const [st, setSt] = useState<WaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metaTopupsOpen, setMetaTopupsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [waAuto, setWaAuto] = useState(false);
  const [waDaily, setWaDaily] = useState(false);
  const [waShop, setWaShop] = useState(false);
  const [waPhone, setWaPhone] = useState("");
  const [waWh, setWaWh] = useState<{ events: string[]; rateMin: number; options: Array<{ key: string; label: string }> } | null>(null);
  const [admMsg, setAdmMsg] = useState<string | null>(null);
  const [admBusy, setAdmBusy] = useState(false);
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
  const [subPlansOpen, setSubPlansOpen] = useState(false);
  const [subQris, setSubQris] = useState<WaSubscribeResult | null>(null);
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
    setWaShop(!!st.settings?.shopAi);
    setWaPhone(st.settings?.ownerPhone ?? "");
    void getWaWebhookEvents()
      .then((s) => setWaWh({ events: s.events ?? [], rateMin: s.rateMin ?? 10, options: s.options ?? [] }))
      .catch(() => undefined);
  }, [isAdmin, st]);

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
      await putWaSettings({ autoDueDate: waAuto, dailyReport: waDaily, ownerPhone: waPhone, shopAi: waShop });
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
    if (!subQris) return;
    const orderId = subQris.orderId;
    const planName = subQris.plan.name;
    const t = window.setInterval(() => {
      void getWaSubscribeStatus(orderId)
        .then((j) => {
          if (j.settled) {
            setSubQris(null);
            setSubMsg(`Langganan ${planName} aktif.`);
            load();
          } else if (j.status === "cancel" || j.status === "expire") {
            setSubQris(null);
            setSubMsg(null);
            setError("Langganan dibatalkan atau kedaluwarsa.");
          }
        })
        .catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(t);
  }, [subQris, load]);

  // Esc menutup popup paket / top up / QRIS
  useEffect(() => {
    if (!subPlansOpen && !subQris && !metaTopupsOpen && !qris) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSubPlansOpen(false);
      setSubQris(null);
      setMetaTopupsOpen(false);
      setQris(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [subPlansOpen, subQris, metaTopupsOpen, qris]);

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

  async function topup(baseAmount: number) {
    setError(null);
    setTopupMsg(null);
    setQris(null);
    setMetaTopupsOpen(false);
    setBusy(true);
    try {
      const res = await fetch("/api/wa/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: baseAmount }),
      });
      const j = (await res.json()) as {
        error?: string;
        orderId?: string;
        credits?: number;
        min?: number;
        amount?: number;      // total (termasuk fee)
        feeAmount?: number;   // biaya admin 0.2%
        baseAmount?: number;  // jumlah pokok
        qris?: { qrUrl: string; qrContent: string; referenceNo?: string; expiredAt: string };
      };
      if (res.ok && j.qris && j.orderId) {
        setTopupMsg(null);
        setQris({
          orderId: j.orderId,
          credits: j.credits ?? 0,
          amount: j.amount ?? baseAmount,
          feeAmount: j.feeAmount ?? 0,
          baseAmount: j.baseAmount ?? baseAmount,
          ...j.qris,
        });
        return;
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
      setBusy(false);
    }
  }

  async function subscribe(plan: WaSubPlan) {
    setError(null);
    setSubMsg(null);
    setSubQris(null);
    setSubPlansOpen(false);
    setSubBusy(true);
    try {
      const j = await waSubscribe(plan.id);
      setSubQris(j);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setError(code === "billing_dormant" ? "Pembayaran QRIS belum aktif di platform." : "Gagal membuat pesanan langganan — coba lagi.");
    } finally {
      setSubBusy(false);
    }
  }

  const subPlans = st.subPlans?.length ? st.subPlans : DEFAULT_WA_SUB_PLANS;
  const metaTopups = st.metaTopups?.length ? st.metaTopups : DEFAULT_WA_META_TOPUPS;
  const bestPlan = subPlans.reduce(
    (a, b) => (b.price / Math.max(1, b.months) < a.price / Math.max(1, a.months) ? b : a),
    subPlans[0]!
  );
  const subUntil = st.waSubscription?.expiresAt
    ? new Date(st.waSubscription.expiresAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
    : null;
  const gatewayConnected = st.waProvider === "waserver" && st.connected;
  const metaConnected = st.waProvider === "meta" && st.connected;
  const metaEmbedUrl = safeMetaEmbedUrl(st.embedUrl);

  return (
    <div className="app">
      <AppHeader />
      <main className="page page--narrow wa-page">
        <header className="wa-head">
          <div>
            <h1>WhatsApp</h1>
            <p className="page__sub">Gateway &amp; META</p>
          </div>
          <div className="wa-chips">
            <span className={`wa-chip ${(tab === "gateway" ? gatewayConnected : metaConnected) ? "is-ok" : "is-off"}`}>
              {tab === "gateway" ? <IconChat size={14} /> : <IconSend size={14} />}
              {(tab === "gateway" ? gatewayConnected : metaConnected) ? "Terhubung" : "Terputus"}
            </span>
          </div>
        </header>

        <div className="tabs tabs--fill">
          <button type="button" className="tab" onClick={() => setTab("gateway")} aria-pressed={tab === "gateway"}>
            <IconChat size={16} /> Gateway
          </button>
          <button type="button" className="tab" onClick={() => setTab("meta")} aria-pressed={tab === "meta"}>
            <IconSend size={16} /> META
          </button>
        </div>

        {/* ── Tab 1: WhatsApp Gateway (waserver) ── */}
        {tab === "gateway" && (
          <>
            <section className="card wa-card">
              <div className="wa-card-head">
                <span className={`wa-icon${gatewayConnected ? " is-ok" : ""}`}>
                  <IconChat size={18} />
                </span>
                <div className="wa-card-title">
                  <strong>Gateway</strong>
                  <span className="meta">
                    {gatewayConnected ? st.account?.displayName || "Nomor terhubung" : "Belum terhubung"}
                  </span>
                </div>
                <div className="wa-actions">
                  {!gatewayConnected ? (
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={wasOpenModal}
                      disabled={!!wasBusy}
                      aria-busy={!!wasBusy}
                      title="Hubungkan WhatsApp"
                    >
                      {wasBusy === "load" ? <span className="spinner" aria-hidden="true" /> : <IconLink size={16} />}
                      Hubungkan
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => void wasReconnect()}
                        disabled={!!wasBusy}
                        aria-busy={!!wasBusy}
                        aria-label="Sambungkan ulang"
                        title="Sambungkan ulang"
                      >
                        {wasBusy === "reconnect" ? <span className="spinner" aria-hidden="true" /> : <IconRefresh size={16} />}
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => void wasDisconnect()}
                        disabled={!!wasBusy}
                        aria-label="Putuskan"
                        title="Putuskan"
                      >
                        <IconPower size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {wasMsg && (
                <p className="banner banner--err" role="alert" style={{ margin: "var(--space-xs) 0 0" }}>
                  {wasMsg}
                </p>
              )}
            </section>

            <section className="card wa-card">
              <div className="wa-card-head">
                <span className={`wa-icon${st.waSubscription?.active ? " is-ok" : ""}`}>
                  <IconPackage size={18} />
                </span>
                <div className="wa-card-title">
                  <strong>Langganan</strong>
                  {st.waSubscription?.active ? (
                    <span className="wa-inline-ok">
                      <IconCheck size={13} /> s.d. {subUntil ?? "tanpa batas"}
                    </span>
                  ) : st.waSubscription?.expiresAt ? (
                    <span className="meta">Berakhir {subUntil}</span>
                  ) : (
                    <span className="meta">Belum aktif</span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => {
                    setSubMsg(null);
                    setError(null);
                    setSubPlansOpen(true);
                  }}
                  disabled={subBusy}
                  aria-busy={subBusy}
                  title={st.waSubscription?.active ? "Perpanjang langganan" : "Pilih paket langganan"}
                >
                  {subBusy ? (
                    <span className="spinner" aria-hidden="true" />
                  ) : st.waSubscription?.active ? (
                    <IconRefresh size={15} />
                  ) : (
                    <IconPackage size={15} />
                  )}
                  {st.waSubscription?.active ? "Perpanjang" : "Pilih Paket"}
                </button>
              </div>
              {subMsg && (
                <p className="banner banner--ok" role="status" style={{ margin: "var(--space-xs) 0 0" }}>
                  {subMsg}
                </p>
              )}
              {error && (
                <p className="banner banner--err" role="alert" style={{ margin: "var(--space-xs) 0 0" }}>
                  {error}
                </p>
              )}
            </section>
          </>
        )}

        {/* ── Tab 2: WhatsApp META ── */}
        {tab === "meta" && (
          <>
            <section className="card wa-card">
              <div className="wa-card-head">
                <span className={`wa-icon${metaConnected ? " is-ok" : ""}`}>
                  <IconSend size={18} />
                </span>
                <div className="wa-card-title">
                  <strong>META</strong>
                  <span className="meta">
                    {metaConnected ? st.account?.displayName || "Nomor terhubung" : "Belum terhubung"}
                  </span>
                </div>
                {metaConnected && (
                  <span className="wa-chip is-ok">
                    <IconCheck size={13} /> Resmi
                  </span>
                )}
              </div>
              {st.waProvider === "meta" &&
                (metaEmbedUrl ? (
                  <iframe title="Meta WhatsApp Embedded Signup" src={metaEmbedUrl} className="embed" style={{ marginTop: "var(--space-xs)" }} />
                ) : (
                  <p className="meta" style={{ margin: "var(--space-xs) 0 0" }}>
                    Formulir belum tersedia.
                  </p>
                ))}
              {st.waProvider === "waserver" && (
                <p className="meta" style={{ margin: "var(--space-xs) 0 0" }}>
                  Provider aktif: <strong>Waserver Gateway</strong> — kelola koneksi di tab Gateway.
                </p>
              )}
            </section>

            <section className="card wa-card">
              <div className="wa-card-head">
                <span className="wa-icon">
                  <IconWallet size={18} />
                </span>
                <div className="wa-card-title">
                  <strong>Saldo META</strong>
                  <span className="meta">
                    {st.balance} kredit · {st.rupiahPerCredit} Rp/kirim
                  </span>
                </div>
              </div>
              <div className="wa-topup-row">
                <button
                  className="btn btn--block"
                  onClick={() => {
                    setTopupMsg(null);
                    setError(null);
                    setMetaTopupsOpen(true);
                  }}
                  disabled={busy}
                  aria-busy={busy}
                  aria-label="Top up saldo META via Midtrans QRIS"
                >
                  {busy ? <span className="spinner" aria-hidden="true" /> : <IconWallet size={16} />}
                  {busy ? "Memproses…" : "Top Up"}
                </button>
              </div>
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
            </section>
          </>
        )}

        <section className="card wa-card">
          <div className="wa-card-head wa-card-head--split">
            <span className="wa-icon">
              <IconChat size={18} />
            </span>
            <div className="wa-card-title">
              <strong>Toko &amp; Riwayat</strong>
              <span className="meta">Percakapan pembeli &amp; AI penjaga toko</span>
            </div>
            <div className="wa-actions">
              <a className="btn btn--2 btn--sm" href="/sandbox" title="Uji AI tanpa mengirim WhatsApp">
                Sandbox
              </a>
              <a className="btn btn--2 btn--sm" href="/wa-chats" title="Buka riwayat chat WhatsApp">
                <IconChat size={16} /> Riwayat Chat
              </a>
            </div>
          </div>
          {isAdmin ? (
            <>
              <div className="wa-options">
                <label className="wa-option">
                  <input type="checkbox" checked={waShop} onChange={(e) => setWaShop(e.target.checked)} />
                  <IconChat size={16} />
                  <span>AI penjaga toko</span>
                </label>
              </div>
              <div className="wa-actions" style={{ marginTop: "var(--space-xs)" }}>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => void saveAdmin()}
                  disabled={admBusy}
                  aria-busy={admBusy}
                  title="Simpan status AI penjaga toko"
                >
                  {admBusy ? <span className="spinner" aria-hidden="true" /> : <IconCheck size={15} />}
                  Simpan
                </button>
              </div>
            </>
          ) : (
            <p className="meta" style={{ margin: 0 }}>
              Aktifkan AI penjaga toko lewat akun admin perusahaan.
            </p>
          )}
          {admMsg && (
            <p className="banner banner--ok" role="status" style={{ margin: "var(--space-xs) 0 0" }}>
              {admMsg}
            </p>
          )}
        </section>

        {isAdmin && (
          <section className="card wa-card">
            <div className="wa-card-head">
              <span className="wa-icon">
                <IconSettings size={18} />
              </span>
              <div className="wa-card-title">
                <strong>Otomasi</strong>
                <span className="meta">Pengingat &amp; notifikasi</span>
              </div>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => void saveAdmin()}
                disabled={admBusy}
                aria-busy={admBusy}
                title="Simpan setelan"
              >
                {admBusy ? <span className="spinner" aria-hidden="true" /> : <IconCheck size={15} />}
                Simpan
              </button>
            </div>
            <div className="wa-options">
              <label className="wa-option">
                <input type="checkbox" checked={waAuto} onChange={(e) => setWaAuto(e.target.checked)} />
                <IconClock size={16} />
                <span>Jatuh tempo</span>
              </label>
              <label className="wa-option">
                <input type="checkbox" checked={waDaily} onChange={(e) => setWaDaily(e.target.checked)} />
                <IconActivity size={16} />
                <span>Laporan harian</span>
              </label>
            </div>
            <label className="field" style={{ marginTop: "var(--space-xs)" }}>
              <span>
                <IconPhone size={14} /> Nomor pemilik
              </span>
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
            <details className="wa-details">
              <summary>
                <IconBell size={16} />
                Notifikasi Accurate
                <span className="wa-count">{waWh?.events.length ?? 0}</span>
              </summary>
              <div className="wa-details-body">
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
                <label className="field" style={{ maxWidth: 200 }}>
                  Jeda (menit)
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
              </div>
            </details>
            {admMsg && (
              <p className="banner banner--ok" role="status" style={{ margin: "var(--space-xs) 0 0" }}>
                {admMsg}
              </p>
            )}
          </section>
        )}

        <details className="card wa-card wa-details">
          <summary>
            <IconChat size={16} />
            Riwayat pesan
            <span className="wa-count">{st.recent.length}</span>
          </summary>
          <div className="wa-details-body">
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
          </div>
        </details>
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

      {metaTopupsOpen && (
        <div className="modal-overlay" onClick={() => setMetaTopupsOpen(false)}>
          <div
            className="modal modal--plans"
            role="dialog"
            aria-modal="true"
            aria-labelledby="topup-plan-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__head">
              <strong className="card__title" id="topup-plan-title">
                Top Up META
              </strong>
              <button
                type="button"
                className="modal__x"
                onClick={() => setMetaTopupsOpen(false)}
                aria-label="Tutup pilihan top up"
              >
                ×
              </button>
            </div>
            <p className="meta" style={{ margin: 0 }}>
              Pilih nominal. Kredit masuk otomatis setelah pembayaran QRIS lunas.
            </p>
            <div className="plan-grid">
              {metaTopups.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="plan-option"
                  onClick={() => void topup(t.amount)}
                >
                  <span className="plan-option__name">{t.label}</span>
                  <span className="plan-option__months">
                    {Math.floor(t.amount / st.rupiahPerCredit)} kredit
                  </span>
                  <span className="plan-option__price">Rp{t.amount.toLocaleString("id-ID")}</span>
                </button>
              ))}
            </div>
            <div className="modal__foot">
              <button type="button" className="btn" onClick={() => setMetaTopupsOpen(false)}>
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      {qris && (
        <div className="modal-overlay" onClick={() => { setQris(null); setTopupMsg(null); }}>
          <div
            className="modal modal--qr modal--sub-qr"
            role="dialog"
            aria-modal="true"
            aria-labelledby="topup-qr-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__head">
              <IconQr size={18} />
              <strong className="card__title" id="topup-qr-title">
                Top Up META
              </strong>
              <button
                type="button"
                className="modal__x"
                onClick={() => { setQris(null); setTopupMsg(null); }}
                aria-label="Tutup pembayaran"
              >
                ×
              </button>
            </div>
            <div className="qr-card">
              <p className="qr-card__status">
                {qris.credits} kredit · Rp{qris.amount.toLocaleString("id-ID")}
              </p>
              {qris.qrUrl ? (
                <img src={qris.qrUrl} alt="Kode QRIS top up" width={220} height={220} />
              ) : (
                <p style={{ fontFamily: "monospace", wordBreak: "break-all", margin: 0 }}>{qris.qrContent}</p>
              )}
              <p className="qr-card__status" role="status" aria-live="polite">
                <span className="busy-dot" aria-hidden="true" /> Menunggu pembayaran…
              </p>
              <p className="qr-card__hint">Scan dengan aplikasi QRIS apa pun. Status diperbarui otomatis.</p>
            </div>
            <p className="meta" style={{ margin: 0, textAlign: "center" }}>
              Order {qris.orderId}
              {qris.expiredAt
                ? ` · berlaku sampai ${new Date(qris.expiredAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </p>
            <div className="modal__foot">
              <button type="button" className="btn" onClick={() => { setQris(null); setTopupMsg(null); }}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {subPlansOpen && (
        <div className="modal-overlay" onClick={() => setSubPlansOpen(false)}>
          <div
            className="modal modal--plans"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sub-plan-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__head">
              <strong className="card__title" id="sub-plan-title">
                Pilih Paket Langganan
              </strong>
              <button
                type="button"
                className="modal__x"
                onClick={() => setSubPlansOpen(false)}
                aria-label="Tutup pilihan paket"
              >
                ×
              </button>
            </div>
            <p className="meta" style={{ margin: 0 }}>
              Harga & nama paket diatur Admin Platform. Pilih satu untuk melanjutkan ke pembayaran QRIS.
            </p>
            <div className="plan-grid">
              {subPlans.map((p) => {
                const best = p.id === bestPlan.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`plan-option${best ? " plan-option--best" : ""}`}
                    onClick={() => void subscribe(p)}
                  >
                    {best && <span className="plan-option__badge">Paling hemat</span>}
                    <span className="plan-option__name">{p.name}</span>
                    <span className="plan-option__months">{p.months} bulan akses</span>
                    <span className="plan-option__price">Rp{p.price.toLocaleString("id-ID")}</span>
                  </button>
                );
              })}
            </div>
            <div className="modal__foot">
              <button type="button" className="btn" onClick={() => setSubPlansOpen(false)}>
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      {subQris && (
        <div className="modal-overlay" onClick={() => setSubQris(null)}>
          <div
            className="modal modal--qr modal--sub-qr"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sub-qr-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__head">
              <span className="modal__spin" aria-hidden="true" />
              <strong className="card__title" id="sub-qr-title">
                Pembayaran Langganan
              </strong>
              <button
                type="button"
                className="modal__x"
                onClick={() => setSubQris(null)}
                aria-label="Tutup pembayaran"
              >
                ×
              </button>
            </div>
            <div className="qr-card">
              <p className="qr-card__status">
                {subQris.plan.name} · Rp{subQris.amount.toLocaleString("id-ID")}
              </p>
              {subQris.qris.qrUrl ? (
                <img src={subQris.qris.qrUrl} alt="QRIS pembayaran langganan" width={220} height={220} />
              ) : (
                <p style={{ fontFamily: "monospace", wordBreak: "break-all", margin: 0 }}>
                  {subQris.qris.qrContent}
                </p>
              )}
              <p className="qr-card__status" role="status" aria-live="polite">
                <span className="busy-dot" aria-hidden="true" /> Menunggu pembayaran…
              </p>
              <p className="qr-card__hint">
                Scan dengan aplikasi QRIS apa pun. Status diperbarui otomatis; popup tertutup sendiri setelah lunas.
              </p>
            </div>
            <p className="meta" style={{ margin: 0, textAlign: "center" }}>
              Order {subQris.orderId} · berlaku sampai{" "}
              {new Date(subQris.qris.expiredAt).toLocaleString("id-ID")}
            </p>
            <div className="modal__foot">
              <button type="button" className="btn" onClick={() => setSubQris(null)}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
