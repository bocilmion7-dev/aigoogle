import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "@aigoogle/shared";
import { WINPAY_DEFAULT_CLIENT_ID } from "@aigoogle/shared";
import { getMe, getSettings, putSettings, setD360Redirect } from "../api";
import { AppHeader } from "../ui";

/** Pengaturan PLATFORM (global, berlaku semua perusahaan) — khusus Admin Platform.
 *  Setelan milik perusahaan (Otomasi WA, Notifikasi webhook, Koneksi) ada di sisi perusahaan. */
export function Settings() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [aset, setAset] = useState<AppSettings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [d360Msg, setD360Msg] = useState<string | null>(null);

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
        waProvider: aset.waProvider ?? "d360",
        ...(aset.waD360ApiKey !== undefined ? { waD360ApiKey: aset.waD360ApiKey } : {}),
        ...(aset.waD360BaseUrl !== undefined ? { waD360BaseUrl: aset.waD360BaseUrl } : {}),
        ...(aset.waD360PartnerId !== undefined ? { waD360PartnerId: aset.waD360PartnerId } : {}),
        ...(aset.waD360PartnerKey !== undefined ? { waD360PartnerKey: aset.waD360PartnerKey } : {}),
        paymentProvider: aset.paymentProvider ?? "winpay",
        winpayEnv: aset.winpayEnv ?? "production",
        ...(aset.winpayClientId !== undefined ? { winpayClientId: aset.winpayClientId } : {}),
        ...(aset.winpayPrivateKey !== undefined ? { winpayPrivateKey: aset.winpayPrivateKey } : {}),
        ...(aset.winpayPublicKey !== undefined ? { winpayPublicKey: aset.winpayPublicKey } : {}),
      });
      setMsg("Pengaturan disimpan.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan pengaturan.");
    }
  }, [aset]);

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
              Menu ini hanya untuk Admin Platform (pengurus sistem). Hubungi administrator sistem Anda.
            </p>
          </div>
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
          <strong className="card__title">Pembayaran QRIS</strong>
          <div className="stack" style={{ gap: 0 }}>
            <label className="check">
              <input
                type="radio" name="payprov" checked={(aset?.paymentProvider ?? "winpay") === "winpay"}
                onChange={() => aset && setAset({ ...aset, paymentProvider: "winpay" })}
              />
              <span>Winpay (default) — QRIS MPM lewat SNAP API Winpay</span>
            </label>
            <label className="check">
              <input
                type="radio" name="payprov" checked={aset?.paymentProvider === "midtrans"}
                onChange={() => aset && setAset({ ...aset, paymentProvider: "midtrans" })}
              />
              <span>Midtrans</span>
            </label>
          </div>
          {(aset?.paymentProvider ?? "winpay") === "winpay" && (
            <>
              <label className="field" style={{ maxWidth: 420, marginTop: "var(--space-xs)" }}>
                Client ID
                <input
                  className="input"
                  type="text"
                  value={aset?.winpayClientId ?? WINPAY_DEFAULT_CLIENT_ID}
                  onChange={(e) => aset && setAset({ ...aset, winpayClientId: e.target.value })}
                  placeholder="Client ID merchant Winpay"
                />
              </label>
              <label className="field" style={{ maxWidth: 260 }}>
                Lingkungan
                <select
                  className="input"
                  value={aset?.winpayEnv ?? "production"}
                  onChange={(e) =>
                    aset && setAset({ ...aset, winpayEnv: e.target.value === "sandbox" ? "sandbox" : "production" })
                  }
                >
                  <option value="production">Produksi (snap.winpay.id)</option>
                  <option value="sandbox">Sandbox (sandbox-snap.winpay.id)</option>
                </select>
              </label>
              <label className="field" style={{ maxWidth: 560 }}>
                Private key merchant (PEM)
                <textarea
                  className="input"
                  rows={4}
                  style={{ fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
                  value={aset?.winpayPrivateKey ?? ""}
                  onChange={(e) => aset && setAset({ ...aset, winpayPrivateKey: e.target.value })}
                  placeholder="tempel private key RSA merchant (-----BEGIN PRIVATE KEY-----)"
                />
              </label>
              <label className="field" style={{ maxWidth: 560 }}>
                Public key Winpay (untuk verifikasi notifikasi)
                <textarea
                  className="input"
                  rows={3}
                  style={{ fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
                  value={aset?.winpayPublicKey ?? ""}
                  onChange={(e) => aset && setAset({ ...aset, winpayPublicKey: e.target.value })}
                  placeholder="public key Winpay dari dashboard (base64 / PEM)"
                />
              </label>
              <p className="meta" style={{ margin: 0 }}>
                Tempel private key merchant (hasil generate di server) untuk mengaktifkan topup QRIS. Public key
                Winpay dari dashboard dipakai memverifikasi notifikasi — tanpa itu pembayaran tetap terkonfirmasi
                otomatis lewat pengecekan status berkala.
              </p>
            </>
          )}
        </section>

        <section className="card">
          <strong className="card__title">Penyedia WhatsApp (Embedded Signup)</strong>
          <div className="stack" style={{ gap: 0 }}>
            <label className="check">
              <input
                type="radio" name="waprov" checked={(aset?.waProvider ?? "d360") === "d360"}
                onChange={() => aset && setAset({ ...aset, waProvider: "d360" })}
              />
              <span>360dialog (default) — perusahaan tempel API key dari Hub 360dialog</span>
            </label>
            <label className="check">
              <input
                type="radio" name="waprov" checked={aset?.waProvider === "meta"}
                onChange={() => aset && setAset({ ...aset, waProvider: "meta" })}
              />
              <span>Meta Cloud API — Embedded Signup iframe (wajib verifikasi bisnis Meta)</span>
            </label>
          </div>
          {(aset?.waProvider ?? "d360") === "d360" && (
            <>
              <label className="field" style={{ maxWidth: 420, marginTop: "var(--space-xs)" }}>
                API Key 360dialog platform (sandbox/utama)
                <input
                  className="input"
                  type="text"
                  value={aset?.waD360ApiKey ?? ""}
                  onChange={(e) => aset && setAset({ ...aset, waD360ApiKey: e.target.value })}
                  placeholder="tempel API key dari 360dialog"
                />
              </label>
              <label className="field" style={{ maxWidth: 420 }}>
                Base URL API
                <input
                  className="input"
                  type="text"
                  value={aset?.waD360BaseUrl ?? ""}
                  onChange={(e) => aset && setAset({ ...aset, waD360BaseUrl: e.target.value })}
                  placeholder="https://waba-v2.360dialog.io (sandbox: https://waba-sandbox.360dialog.io)"
                />
              </label>
              <p className="meta" style={{ margin: 0 }}>
                Sandbox hanya bisa kirim ke nomor penerima tetap (maks 200 pesan). Untuk produksi, daftarkan platform
                sebagai <b>360dialog Partner</b> — API key klien dibuat otomatis setelah Embedded Signup.
              </p>
              <strong className="card__title" style={{ marginTop: "var(--space-s)" }}>
                Partner (Embedded Signup otomatis)
              </strong>
              <label className="field" style={{ maxWidth: 420 }}>
                Partner ID
                <input
                  className="input"
                  type="text"
                  value={aset?.waD360PartnerId ?? ""}
                  onChange={(e) => aset && setAset({ ...aset, waD360PartnerId: e.target.value })}
                  placeholder="partner ID dari 360dialog"
                />
              </label>
              <label className="field" style={{ maxWidth: 420 }}>
                Partner API Key
                <input
                  className="input"
                  type="text"
                  value={aset?.waD360PartnerKey ?? ""}
                  onChange={(e) => aset && setAset({ ...aset, waD360PartnerKey: e.target.value })}
                  placeholder="Partner API key"
                />
              </label>
              <div className="btn-row">
                <button
                  className="btn btn--2"
                  onClick={() =>
                    void setD360Redirect()
                      .then((r) => setD360Msg("Redirect siap dipakai."))
                      .catch(() => setD360Msg("Gagal — pastikan Partner ID & Partner API Key tersimpan dulu."))
                  }
                >
                  Daftarkan redirect URL ke halaman WhatsApp
                </button>
                {d360Msg && <p className="meta" style={{ margin: 0, alignSelf: "center" }}>{d360Msg}</p>}
              </div>
            </>
          )}
        </section>

        <div className="btn-row">
          <button className="btn" disabled={!aset} onClick={() => void saveAppSettings()}>
            Simpan pengaturan
          </button>
        </div>

        <p className="meta" style={{ marginTop: "var(--space-s)" }}>
          Setelan milik perusahaan (Otomasi WhatsApp, Notifikasi perubahan data, Koneksi Accurate) diatur
          Admin perusahaan masing-masing di menu WhatsApp dan User & Peran.
        </p>
      </main>
    </div>
  );
}
