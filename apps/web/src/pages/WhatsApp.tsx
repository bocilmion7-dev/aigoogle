import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../ui";
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
  const [d360Msg, setD360Msg] = useState<string | null>(null);
  const [d360Busy, setD360Busy] = useState(false);

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
  useEffect(() => {
    if (!isAdmin || !st) return;
    setWaAuto(!!st.settings?.autoDueDate);
    setWaDaily(!!st.settings?.dailyReport);
    setWaPhone(st.settings?.ownerPhone ?? "");
    void getWaWebhookEvents()
      .then((s) => setWaWh({ events: s.events ?? [], rateMin: s.rateMin ?? 10, options: s.options ?? [] }))
      .catch(() => undefined);
  }, [isAdmin, st]);

  // callback Connect Button: klien selesai Embedded Signup → generate & simpan API key channel
  async function onboardD360(client: string, channels: string[]) {
    setD360Busy(true);
    setD360Msg(null);
    try {
      await waD360Onboard(client, channels);
      setD360Msg("Nomor WhatsApp terhubung — API key perusahaan dibuat otomatis.");
      load();
    } catch (e) {
      setD360Msg(
        e instanceof Error && e.message.includes("d360_")
          ? "360dialog belum menandai channel siap (onboarding Meta diproses). Coba tombol lagi beberapa saat."
          : "Gagal menyelesaikan onboarding."
      );
    } finally {
      setD360Busy(false);
    }
  }

  async function saveAdmin() {
    setAdmMsg(null);
    try {
      await putWaSettings({ autoDueDate: waAuto, dailyReport: waDaily, ownerPhone: waPhone });
      if (waWh) await putWaWebhookEvents({ events: waWh.events, rateMin: waWh.rateMin });
      setAdmMsg("Setelan perusahaan disimpan.");
      load();
    } catch {
      setAdmMsg("Gagal menyimpan setelan.");
    }
  }

  if (!st) {
    return (
      <div className="app">
        <AppHeader />
        <main className="page page--narrow">
          <p className="meta">Memuat…</p>
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
      const j = (await res.json()) as { error?: string; orderId?: string; credits?: number; min?: number };
      if (res.status === 503 && j.orderId) {
        // billing dormant → mock settle untuk dev
        const s = await fetch(`/api/wa/topup/${j.orderId}/mock-settle`, { method: "POST" });
        if (s.ok) {
          load();
          alert(`Topup mock settle: +${j.credits} kredit`);
          return;
        }
      }
      if (!res.ok) setError(j.error === "minimal_topup" ? `Minimal topup Rp ${(j.min ?? 200).toLocaleString("id-ID")}` : j.error ?? "Gagal topup");
      else load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <AppHeader />
      <main className="page page--narrow">
        <h1>WhatsApp</h1>
        <p className="page__sub">Gateway pesan, saldo kredit, dan agregator Meta.</p>

        <section className="card">
          <strong className="card__title">Status</strong>
          <p className="small muted" style={{ margin: "0 0 4px" }}>
            {st.connected ? `Terhubung (${st.account?.displayName || st.account?.phoneNumberId})` : "Belum terhubung"}
          </p>
          <p className="small" style={{ margin: 0 }}>
            Saldo: <strong className="num">{st.balance}</strong> kredit ·{" "}
            <span className="num">{st.rupiahPerCredit}</span> Rp/kirim (diatur di menu Admin)
          </p>
        </section>

        {st.waProvider === "d360" ? (
          <section className="card">
            <strong className="card__title">Hubungkan nomor WhatsApp via 360dialog</strong>
            <p className="meta">
              API dikelola platform — tidak perlu mengurus API key. Tekan tombol, masuk dengan akun Meta Business
              Anda, pilih/daftarkan nomor — setelah selesai, nomor langsung terhubung ke sistem.
            </p>
            <div className="wa-connect">
              <ConnectButton
                partnerId={st.waD360PartnerId}
                label="Hubungkan WhatsApp Bisnis"
                callback={(cb) => void onboardD360(cb.client, cb.channels)}
              />
            </div>
            {!st.waD360PartnerId && (
              <p className="meta" style={{ margin: "var(--space-xs) 0 0" }}>
                Catatan: Partner ID platform belum diisi — popup akan membuka pendaftaran umum. Setelah Partner ID
                diisi Admin Platform di Pengaturan, pendaftaran otomatis terhubung ke platform dan API key dibuat
                otomatis.
              </p>
            )}
            {d360Busy && <p className="meta">Memproses onboarding…</p>}
            {d360Msg && <p className="banner banner--ok" role="status" style={{ marginTop: "var(--space-xs)", marginBottom: 0 }}>{d360Msg}</p>}
            {st.connected ? (
              <p className="banner banner--ok" role="status" style={{ marginTop: "var(--space-xs)", marginBottom: 0 }}>
                Nomor WhatsApp perusahaan terhubung — notifikasi & otomasi siap dikirim.
              </p>
            ) : st.platformReady ? (
              <p className="meta" style={{ margin: "var(--space-xs) 0 0" }}>
                Jalur sandbox platform siap (kirim terbatas ke nomor verified platform). Hubungkan nomor perusahaan
                Anda dengan tombol di atas agar notifikasi berjalan penuh.
              </p>
            ) : null}
          </section>
        ) : (
          <section className="card">
            <strong className="card__title">Daftar sebagai agregator (Meta Embedded Signup)</strong>
            <p className="meta">
              Platform kami membayar Meta. Anda daftarkan nomor bisnis Anda lewat form Meta di bawah.
              {!st.metaConfigured && " (Credential Meta App belum diset — menu aktif setelah konfigurasi.)"}
            </p>
            {st.embedUrl ? (
              <iframe title="Meta WhatsApp Embedded Signup" src={st.embedUrl} className="embed" />
            ) : (
              <p className="meta" style={{ marginBottom: 0 }}>
                Embed signup siap setelah META_APP_ID & META_EMBEDDED_CONFIG_ID diisi.
              </p>
            )}
          </section>
        )}

        <section className="card">
          <strong className="card__title">Topup saldo</strong>
          <p className="meta">
            1 kredit = <span className="num">{st.rupiahPerCredit}</span> rupiah (biaya kirim 1 pesan).
          </p>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="field" style={{ flex: "1 1 180px" }}>
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
            <button className="btn" onClick={() => void topup()} disabled={busy} aria-label="Topup saldo WhatsApp">
              Topup {amount.toLocaleString("id-ID")} Rp ({Math.floor(amount / st.rupiahPerCredit)} kredit)
            </button>
          </div>
          {error && (
            <p className="banner banner--err" role="alert" style={{ marginTop: "var(--space-xs)", marginBottom: 0 }}>
              {error}
            </p>
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
              Kirim WhatsApp otomatis ke nomor pemilik setiap ada perubahan data yang dipilih (webhook Accurate),
              dibatasi sekali per jeda per jenis data agar tidak spam.
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
            <div className="btn-row" style={{ marginTop: "var(--space-xs)" }}>
              <button className="btn" onClick={() => void saveAdmin()}>Simpan setelan perusahaan</button>
            </div>
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
                  <span style={{ color: m.status === "sent" ? "var(--accent)" : "var(--danger)" }}>{m.status}</span>
                  <span className="num">{m.to}</span>
                  <span className="muted" style={{ flex: 1, minWidth: 0 }}>
                    {m.body.slice(0, 60)}
                  </span>
                  {m.error && <span style={{ color: "var(--danger)" }}>{m.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
