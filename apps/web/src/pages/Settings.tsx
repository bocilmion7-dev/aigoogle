import { useCallback, useEffect, useState } from "react";
import type { AppSettings, ConnectionInfo } from "@aigoogle/shared";
import {
  getConnections,
  getMe,
  getSettings,
  getWaStatus,
  getWaWebhookEvents,
  putSettings,
  putWaSettings,
  putWaWebhookEvents,
} from "../api";
import { AppHeader } from "../ui";
import { ACCURATE_OAUTH_CTA } from "../oauth";

export function Settings() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [aset, setAset] = useState<AppSettings | null>(null);
  const [conns, setConns] = useState<ConnectionInfo[]>([]);
  const [waAuto, setWaAuto] = useState(false);
  const [waDaily, setWaDaily] = useState(false);
  const [waPhone, setWaPhone] = useState("");
  const [waWh, setWaWh] = useState<{ events: string[]; rateMin: number; options: Array<{ key: string; label: string }> } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void getMe().then(setMe);
  }, []);

  const canSettings = !!me?.permissions?.includes("app:settings.manage");

  useEffect(() => {
    if (!canSettings) return;
    setErr(null);
    void getSettings()
      .then(setAset)
      .catch(() => setErr("Gagal memuat pengaturan aplikasi."));
    void getConnections().then(setConns).catch(() => undefined);
    void getWaStatus()
      .then((w) => {
        setWaAuto(!!w.settings?.autoDueDate);
        setWaDaily(!!w.settings?.dailyReport);
        setWaPhone(w.settings?.ownerPhone ?? "");
      })
      .catch(() => undefined);
    void getWaWebhookEvents()
      .then((s) => setWaWh({ events: s.events ?? [], rateMin: s.rateMin ?? 10, options: s.options ?? [] }))
      .catch(() => undefined);
  }, [canSettings]);

  const saveAppSettings = useCallback(async () => {
    if (!aset) return;
    setMsg(null);
    setErr(null);
    try {
      await putSettings({
        voiceEngine: aset.voiceEngine,
        ocrMode: aset.ocrMode ?? "vision",
        ...(aset.waPricePerCredit !== undefined ? { waPricePerCredit: aset.waPricePerCredit } : {}),
      });
      await putWaSettings({ autoDueDate: waAuto, dailyReport: waDaily, ownerPhone: waPhone });
      if (waWh) await putWaWebhookEvents({ events: waWh.events, rateMin: waWh.rateMin });
      setMsg("Pengaturan disimpan.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan pengaturan.");
    }
  }, [aset, waAuto, waDaily, waPhone, waWh]);

  if (me === undefined) return <p style={{ padding: 24 }}>Memuat…</p>;
  if (me === null) {
    window.location.href = "/login";
    return null;
  }

  if (!canSettings) {
    return (
      <div className="app">
        <AppHeader me={me} />
        <main className="page page--narrow">
          <h1>Pengaturan</h1>
          <div className="card">
            <strong>Anda tidak punya akses menu Pengaturan.</strong>
            <p className="meta" style={{ marginTop: 6, marginBottom: 0 }}>
              Menu ini hanya untuk Admin platform. Hubungi administrator Anda jika Anda membutuhkannya.
            </p>
          </div>
          <a className="btn btn--ghost btn--sm" href="/app">
            ← Kembali ke dashboard
          </a>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <AppHeader me={me} />
      <main className="page page--narrow">
        <h1>Pengaturan</h1>
        <p className="page__sub">Pengaturan aplikasi platform — berlaku untuk semua perusahaan pengguna.</p>

        {msg && <p className="banner banner--ok" role="status">{msg}</p>}
        {err && <p className="banner banner--err" role="alert">{err}</p>}

        <h2 className="section-title">Akun</h2>
        <section className="card">
          <strong className="card__title">Login password</strong>
          <p className="small muted" style={{ margin: 0 }}>
            Email: {me.email}
            {me.needsPassword ? " · belum diset" : " · sudah aktif"}
          </p>
          <p className="meta" style={{ marginBottom: 0 }}>
            Lupa password? Reset via WhatsApp menyusul. Untuk sekarang, hubungi administrator sistem Anda.
          </p>
        </section>

        <h2 className="section-title">Aplikasi</h2>
        <section className="card">
          <strong className="card__title">Mode baca dokumen</strong>
          <div className="stack" style={{ gap: 0 }}>
            <label className="check">
              <input
                type="radio" name="ocr" checked={(aset?.ocrMode ?? "vision") === "vision"}
                onChange={() => aset && setAset({ ...aset, ocrMode: "vision" })}
              />
              <span>Vision & OCR — gambar/PDF dibaca AI (nota, bukti transfer, faktur, screenshot)</span>
            </label>
            <label className="check">
              <input
                type="radio" name="ocr" checked={aset?.ocrMode === "text"}
                onChange={() => aset && setAset({ ...aset, ocrMode: "text" })}
              />
              <span>Teks saja — hanya file teks (MD, TXT, DOCX, PPTX)</span>
            </label>
          </div>

          <strong className="card__title" style={{ marginTop: "var(--space-s)" }}>
            Mesin suara (chat & panggilan suara)
          </strong>
          <div className="stack" style={{ gap: 0 }}>
            <label className="check">
              <input
                type="radio" name="voice" checked={aset?.voiceEngine === "web-speech"}
                onChange={() => aset && setAset({ ...aset, voiceEngine: "web-speech" })}
              />
              <span>Browser (Web Speech) — ringan</span>
            </label>
            <label className="check">
              <input
                type="radio" name="voice" checked={aset?.voiceEngine === "edge"}
                onChange={() => aset && setAset({ ...aset, voiceEngine: "edge" })}
              />
              <span>Edge — STT di browser, TTS neural (gratis)</span>
            </label>
            <label className="check">
              <input
                type="radio" name="voice" checked={aset?.voiceEngine === "gemini-native"}
                onChange={() => aset && setAset({ ...aset, voiceEngine: "gemini-native" })}
              />
              <span>Gemini native audio — kualitas terbaik</span>
            </label>
          </div>

          <strong className="card__title" style={{ marginTop: "var(--space-s)" }}>Biaya WhatsApp</strong>
          <label className="field" style={{ maxWidth: 260 }}>
            Harga per kredit (Rp, biaya 1 pesan)
            <input
              className="input num"
              type="number"
              inputMode="numeric"
              min={1}
              max={1000000}
              value={aset?.waPricePerCredit ?? 200}
              onChange={(e) => aset && setAset({ ...aset, waPricePerCredit: Number(e.target.value) })}
            />
          </label>
        </section>

        <section className="card">
          <strong className="card__title">Otomasi WhatsApp</strong>
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
        </section>

        <section className="card">
          <strong className="card__title">Notifikasi perubahan data Accurate</strong>
          <p className="small muted" style={{ margin: "0 0 var(--space-xs)" }}>
            Kirim WhatsApp otomatis ke nomor pemilik di atas setiap ada perubahan data yang dipilih (webhook Accurate).
            Notifikasi per jenis data dibatasi sekali per jeda yang ditentukan agar tidak spam.
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
        </section>

        <section className="card">
          <strong className="card__title">Koneksi</strong>
          <p className="small muted" style={{ margin: "0 0 var(--space-xs)" }}>
            Accurate Online:{" "}
            {(conns.find((c) => c.provider === "accurate")?.status ?? "none") === "connected"
              ? `terhubung (${conns.find((c) => c.provider === "accurate")?.accountLabel})`
              : conns.find((c) => c.provider === "accurate")?.status ?? "none"}
          </p>
          {conns.find((c) => c.provider === "accurate")?.status !== "connected" && (
            <a className="btn" href={ACCURATE_OAUTH_CTA} style={{ marginBottom: "var(--space-xs)" }}>
              Hubungkan Accurate
            </a>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            Google Drive: {conns.find((c) => c.provider === "google")?.status ?? "none"} — menyusul
          </p>
        </section>

        <div className="btn-row">
          <button className="btn" disabled={!aset} onClick={() => void saveAppSettings()}>
            Simpan pengaturan
          </button>
        </div>
      </main>
    </div>
  );
}
