import { useCallback, useEffect, useState } from "react";
import { AppHeader, PageLoader } from "../ui";
// package.json paket menunjuk file yang tak ada — impor langsung bundel ESM aslinya
import { ConnectButton } from "360dialog-connect-button/dist/dialog-connect-button.esm.js";
import { getMe, getWaWebhookEvents, waD360Onboard, putWaSettings, putWaWebhookEvents } from "../api";

interface WaStatus {
  connected: boolean;
  platformReady: boolean;
  waProvider: "meta" | "d360";
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
  recent: Array<{ id: string; to: string; body: string; status: string; error: string; createdAt: string }>;
}

export function WhatsApp() {
  const [st, setSt] = useState<WaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(10000);
  const [busy, setBusy] = useState(false);
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
    { orderId: string; credits: number; amount: number; qrUrl: string; qrContent: string; expiredAt: string } | null
  >(null);
  const [topupMsg, setTopupMsg] = useState<string | null>(null);

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

  async function topup() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/wa/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const j = (await res.json()) as {
        error?: string;
        orderId?: string;
        credits?: number;
        min?: number;
        amount?: number;
        qris?: { qrUrl: string; qrContent: string; contractId: string; expiredAt: string };
      };
      if (res.ok && j.qris && j.orderId) {
        setTopupMsg(null);
        setQris({ orderId: j.orderId, credits: j.credits ?? 0, amount: j.amount ?? amount, ...j.qris });
        return;
      }
      if (res.status === 503 && j.orderId) {
        // billing dormant → mock settle untuk dev
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
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <AppHeader />
      <main className="page page--narrow">
        <h1>WhatsApp</h1>
        <p className="page__sub">Kirim pesan dan notifikasi otomatis untuk bisnis Anda.</p>

        <section className="card">
          <strong className="card__title">Status</strong>
          <p className="small muted" style={{ margin: "0 0 4px" }}>
            {st.connected
              ? st.account?.displayName
                ? `Terhubung (${st.account.displayName})`
                : "Terhubung"
              : "Belum terhubung"}
          </p>
          <p className="small" style={{ margin: 0 }}>
            Saldo: <strong className="num">{st.balance}</strong> kredit ·{" "}
            <span className="num">{st.rupiahPerCredit}</span> Rp/kirim
          </p>
        </section>

        {st.waProvider === "d360" ? (
          <section className="card">
            <strong className="card__title">Hubungkan nomor WhatsApp</strong>
            <p className="meta">
              Tekan tombol, masuk dengan akun Meta Business Anda, lalu pilih atau daftarkan nomor —
              setelah selesai, nomor langsung terhubung ke sistem.
            </p>
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
            {d360Msg && <p className="banner banner--ok" role="status" style={{ marginTop: "var(--space-xs)", marginBottom: 0 }}>{d360Msg}</p>}
            {st.connected ? (
              <p className="banner banner--ok" role="status" style={{ marginTop: "var(--space-xs)", marginBottom: 0 }}>
                Nomor WhatsApp perusahaan terhubung — notifikasi & otomasi siap dikirim.
              </p>
            ) : null}
          </section>
        ) : (
          <section className="card">
            <strong className="card__title">Hubungkan nomor WhatsApp</strong>
            <p className="meta">Daftarkan nomor bisnis Anda lewat formulir di bawah.</p>
            {st.embedUrl ? (
              <iframe title="Meta WhatsApp Embedded Signup" src={st.embedUrl} className="embed" />
            ) : (
              <p className="meta" style={{ marginBottom: 0 }}>
                Formulir belum tersedia — hubungi pengurus sistem.
              </p>
            )}
          </section>
        )}

        <section className="card">
          <strong className="card__title">Topup saldo</strong>
          <p className="meta">
            1 kredit = <span className="num">{st.rupiahPerCredit}</span> rupiah (biaya kirim 1 pesan).
          </p>
          <label className="field" style={{ display: "block" }}>
            Jumlah rupiah
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
          <button
            className="btn btn--block"
            style={{ marginTop: "var(--space-xs)" }}
            onClick={() => void topup()}
            disabled={busy}
            aria-busy={busy}
            aria-label="Topup saldo WhatsApp"
          >
            {busy && <span className="spinner" aria-hidden="true" />}
            Topup {amount.toLocaleString("id-ID")} Rp ({Math.floor(amount / st.rupiahPerCredit)} kredit)
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
              <img src={qris.qrUrl} alt="Kode QRIS pembayaran" width={200} height={200} />
              <div className="qris-info">
                <strong>
                  {qris.amount.toLocaleString("id-ID")} Rp · {qris.credits} kredit
                </strong>
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

        {isAdmin && (
          <section className="card">
            <strong className="card__title">Setelan perusahaan — Otomasi WhatsApp</strong>
            <div className="stack" style={{ gap: 0 }}>
              <label className="check">
                <input type="checkbox" checked={waAuto} onChange={(e) => setWaAuto(e.target.checked)} />
                <span>Ingatkan tagihan jatuh tempo ke pelanggan</span>
              </label>
              <label className="check">
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
                <label className="check" key={o.key}>
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
            <ul className="file-list">
              {st.recent.map((m) => (
                <li key={m.id} className="file-row">
                  <span style={{ color: m.status === "sent" ? "var(--accent)" : "var(--danger)" }}>{m.status === "sent" ? "Terkirim" : m.status === "pending" ? "Tertunda" : "Gagal"}</span>
                  <span className="num">{m.to}</span>
                  <span className="muted" style={{ flex: 1, minWidth: 0 }}>
                    {m.body.slice(0, 60)}
                  </span>
                  {m.error && (
                    <span style={{ color: "var(--danger)" }}>
                      {m.error === "belum_connect"
                        ? "Nomor belum terhubung"
                        : m.error.includes("rate")
                          ? "Batas kirim tercapai"
                          : "Gagal dikirim"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
