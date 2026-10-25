import { useCallback, useEffect, useState } from "react";
import { DEFAULT_AI_SIGNUP_BONUS_TOKENS, DEFAULT_AI_SUB_PLANS, DEFAULT_AI_TOPUP_PACKAGES, DEFAULT_WA_META_TOPUPS, DEFAULT_WA_SUB_PLANS, type AiSubPlan, type AiTopupPackage, type AppSettings, type WaMetaTopup, type WaSubPlan } from "@aigoogle/shared";
import { getMe, getSettings, putSettings } from "../api";
import { AppHeader, PageLoader } from "../ui";
import { IconPlus, IconTrash } from "../icons";

/** Pengaturan PLATFORM (global, berlaku semua perusahaan) — khusus Admin Platform.
 *  Setelan milik perusahaan (Otomasi WA, Notifikasi webhook, Koneksi) ada di sisi perusahaan. */
export function Settings() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [aset, setAset] = useState<AppSettings | null>(null);
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
        waProvider: aset.waProvider ?? "waserver",
        waSubPlans: aset.waSubPlans ?? DEFAULT_WA_SUB_PLANS,
        waMetaTopups: aset.waMetaTopups ?? DEFAULT_WA_META_TOPUPS,
        aiTopupPackages: aset.aiTopupPackages ?? DEFAULT_AI_TOPUP_PACKAGES,
        aiSubPlans: aset.aiSubPlans ?? DEFAULT_AI_SUB_PLANS,
        aiSignupBonusTokens: aset.aiSignupBonusTokens ?? DEFAULT_AI_SIGNUP_BONUS_TOKENS,
      });
      setMsg("Pengaturan disimpan.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan pengaturan.");
    }
  }, [aset]);

  function updateSubPlan(i: number, patch: Partial<WaSubPlan>) {
    if (!aset) return;
    const list = (aset.waSubPlans ?? DEFAULT_WA_SUB_PLANS).map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    setAset({ ...aset, waSubPlans: list });
  }

  function updateMetaTopup(i: number, patch: Partial<WaMetaTopup>) {
    if (!aset) return;
    const list = (aset.waMetaTopups ?? DEFAULT_WA_META_TOPUPS).map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    setAset({ ...aset, waMetaTopups: list });
  }

  function updateAiPackage(i: number, patch: Partial<AiTopupPackage>) {
    if (!aset) return;
    const list = (aset.aiTopupPackages ?? DEFAULT_AI_TOPUP_PACKAGES).map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    setAset({ ...aset, aiTopupPackages: list });
  }

  function addAiPackage() {
    if (!aset) return;
    const list = aset.aiTopupPackages ?? DEFAULT_AI_TOPUP_PACKAGES;
    if (list.length >= 12) return;
    setAset({
      ...aset,
      aiTopupPackages: [...list, { id: `a${Date.now().toString(36)}`, price: 10000, tokens: 250000 }],
    });
  }

  function removeAiPackage(i: number) {
    if (!aset) return;
    const list = aset.aiTopupPackages ?? DEFAULT_AI_TOPUP_PACKAGES;
    if (list.length <= 1) return;
    setAset({ ...aset, aiTopupPackages: list.filter((_, idx) => idx !== i) });
  }

  function updateAiSubPlan(i: number, patch: Partial<AiSubPlan>) {
    if (!aset) return;
    const list = (aset.aiSubPlans ?? DEFAULT_AI_SUB_PLANS).map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    setAset({ ...aset, aiSubPlans: list });
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
              <span>Neural (server) — Azure TTS bila dikonfigurasi, fallback Edge/Google</span>
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
          <strong className="card__title">Paket Langganan WhatsApp Gateway</strong>
          <p className="meta" style={{ margin: "0 0 var(--space-xs)" }}>
            Tiga paket yang tampil di halaman WhatsApp perusahaan. Nama paket, durasi, dan harga bisa diubah kapan saja.
          </p>
          <div className="stack">
            {(aset?.waSubPlans ?? DEFAULT_WA_SUB_PLANS).map((p, i) => (
              <div key={p.id} className="panel">
                <span className="meta" style={{ fontWeight: 600 }}>Paket {i + 1}</span>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1.4fr) 90px minmax(110px, 1fr)", gap: "var(--space-xs)", marginTop: 6, alignItems: "end" }}>
                  <label className="field">
                    Nama paket
                    <input
                      className="input"
                      value={p.name}
                      maxLength={40}
                      onChange={(e) => updateSubPlan(i, { name: e.target.value })}
                      placeholder="mis. 1 Bulan"
                    />
                  </label>
                  <label className="field">
                    Durasi (bulan)
                    <input
                      className="input num"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={36}
                      value={p.months}
                      onChange={(e) => updateSubPlan(i, { months: Number(e.target.value) })}
                    />
                  </label>
                  <label className="field">
                    Harga (Rp)
                    <input
                      className="input num"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={10000000}
                      value={p.price}
                      onChange={(e) => updateSubPlan(i, { price: Number(e.target.value) })}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <strong className="card__title">Pilihan Top Up META</strong>
          <p className="meta" style={{ margin: "0 0 var(--space-xs)" }}>
            Tiga pilihan nominal yang tampil saat perusahaan menekan tombol Top Up META. Kredit dihitung otomatis dari harga per kredit.
          </p>
          <div className="stack">
            {(aset?.waMetaTopups ?? DEFAULT_WA_META_TOPUPS).map((p, i) => (
              <div key={p.id} className="panel">
                <span className="meta" style={{ fontWeight: 600 }}>Pilihan {i + 1}</span>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1.4fr) minmax(110px, 1fr)", gap: "var(--space-xs)", marginTop: 6, alignItems: "end" }}>
                  <label className="field">
                    Label
                    <input
                      className="input"
                      value={p.label}
                      maxLength={40}
                      onChange={(e) => updateMetaTopup(i, { label: e.target.value })}
                      placeholder="mis. 10 Ribu"
                    />
                  </label>
                  <label className="field">
                    Nominal (Rp)
                    <input
                      className="input num"
                      type="number"
                      inputMode="numeric"
                      min={2000}
                      max={10000000}
                      value={p.amount}
                      onChange={(e) => updateMetaTopup(i, { amount: Number(e.target.value) })}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-xs)", flexWrap: "wrap" }}>
            <strong className="card__title" style={{ marginBottom: 0 }}>Paket Top Up Token AI</strong>
            <button
              type="button"
              className="btn btn--2 btn--sm"
              onClick={addAiPackage}
              disabled={(aset?.aiTopupPackages ?? DEFAULT_AI_TOPUP_PACKAGES).length >= 12}
            >
              <IconPlus size={15} /> Tambah
            </button>
          </div>
          <p className="meta" style={{ margin: "4px 0 var(--space-xs)" }}>
            Jumlah paket bebas (maks 12). Token yang didapat diisi langsung per paket.
          </p>
          <div className="stack">
            {(aset?.aiTopupPackages ?? DEFAULT_AI_TOPUP_PACKAGES).map((p, i) => (
              <div key={p.id} className="panel">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 40px", gap: "var(--space-xs)", alignItems: "end" }}>
                  <label className="field">
                    Harga (Rp)
                    <input
                      className="input num"
                      type="number"
                      inputMode="numeric"
                      min={1000}
                      max={10000000}
                      value={p.price}
                      onChange={(e) => updateAiPackage(i, { price: Number(e.target.value) })}
                    />
                  </label>
                  <label className="field">
                    Token didapat
                    <input
                      className="input num"
                      type="number"
                      inputMode="numeric"
                      min={1000}
                      max={1000000000}
                      value={p.tokens}
                      onChange={(e) => updateAiPackage(i, { tokens: Number(e.target.value) })}
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => removeAiPackage(i)}
                    disabled={(aset?.aiTopupPackages ?? DEFAULT_AI_TOPUP_PACKAGES).length <= 1}
                    aria-label={`Hapus paket ${i + 1}`}
                    title="Hapus paket"
                  >
                    <IconTrash size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <strong className="card__title">Langganan AI Bulanan</strong>
          <p className="meta" style={{ margin: "4px 0 var(--space-xs)" }}>
            Tiga paket kartu langganan. Harga, token per bulan, durasi, dan fitur bisa diubah.
          </p>
          <div className="stack">
            {(aset?.aiSubPlans ?? DEFAULT_AI_SUB_PLANS).map((p, i) => (
              <div key={p.id} className="panel">
                <span className="meta" style={{ fontWeight: 600 }}>Kartu {i + 1}</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "var(--space-xs)", marginTop: 6, alignItems: "end" }}>
                  <label className="field">
                    Nama paket
                    <input className="input" value={p.name} maxLength={40} onChange={(e) => updateAiSubPlan(i, { name: e.target.value })} />
                  </label>
                  <label className="field">
                    Harga / bulan (Rp)
                    <input className="input num" type="number" min={1000} max={10000000} value={p.price} onChange={(e) => updateAiSubPlan(i, { price: Number(e.target.value) })} />
                  </label>
                  <label className="field">
                    Token / bulan
                    <input className="input num" type="number" min={1000} max={1000000000} value={p.tokens} onChange={(e) => updateAiSubPlan(i, { tokens: Number(e.target.value) })} />
                  </label>
                  <label className="field">
                    Durasi (bln)
                    <input className="input num" type="number" min={1} max={36} value={p.months} onChange={(e) => updateAiSubPlan(i, { months: Number(e.target.value) })} />
                  </label>
                </div>
                <label className="field" style={{ marginTop: "var(--space-xs)" }}>
                  Fitur (satu per baris)
                  <textarea
                    className="input"
                    rows={3}
                    style={{ resize: "vertical" }}
                    value={p.features.join("\n")}
                    onChange={(e) => updateAiSubPlan(i, { features: e.target.value.split("\n").map((f) => f.trim()).filter(Boolean) })}
                  />
                </label>
              </div>
            ))}
          </div>
          <strong className="card__title" style={{ marginTop: "var(--space-m)" }}>Bonus Token Pendaftaran Accurate</strong>
          <p className="meta" style={{ margin: "4px 0 var(--space-xs)" }}>
            Diberikan sekali untuk perusahaan yang pertama kali mendaftar via Accurate.
          </p>
          <label className="field" style={{ maxWidth: 280 }}>
            Jumlah token bonus
            <input
              className="input num"
              type="number"
              min={0}
              max={1000000000}
              value={aset?.aiSignupBonusTokens ?? DEFAULT_AI_SIGNUP_BONUS_TOKENS}
              onChange={(e) => aset && setAset({ ...aset, aiSignupBonusTokens: Number(e.target.value) })}
            />
          </label>
        </section>

        <section className="card">
          <strong className="card__title">Penyedia WhatsApp</strong>
          <div className="stack" style={{ gap: 0 }}>
            <label className="check">
              <input
                type="radio" name="waprov" checked={(aset?.waProvider ?? "waserver") === "waserver"}
                onChange={() => aset && setAset({ ...aset, waProvider: "waserver" })}
              />
              <span>Waserver — gateway WhatsApp milik platform (scan QR dari halaman WhatsApp)</span>
            </label>
            <label className="check">
              <input
                type="radio" name="waprov" checked={aset?.waProvider === "meta"}
                onChange={() => aset && setAset({ ...aset, waProvider: "meta" })}
              />
              <span>Meta Cloud API — Embedded Signup iframe (wajib verifikasi bisnis Meta)</span>
            </label>
          </div>
          {(aset?.waProvider ?? "waserver") === "waserver" && (
            <p className="meta" style={{ margin: "var(--space-xs) 0 0" }}>
              {aset?.waserverReady
                ? "Gateway aktif. Setiap perusahaan menghubungkan nomornya sendiri lewat halaman WhatsApp (scan QR)."
                : "Gateway belum dikonfigurasi di server — isi WASERVER_URL dan WASERVER_API_KEY pada environment API lalu muat ulang."}
            </p>
          )}
          {aset?.waProvider === "meta" && (
            <p className="meta" style={{ margin: "var(--space-xs) 0 0" }}>
              Perusahaan mendaftarkan nomor lewat formulir Embedded Signup Meta di halaman WhatsApp.
            </p>
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
