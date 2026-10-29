import { useEffect, useMemo, useRef, useState } from "react";
import { getMe } from "../api";
import { AppHeader, PageLoader } from "../ui";
import { IconCheck, IconExternal, IconFileImage, IconLayout, IconRefresh, IconTrash, IconUpload } from "../icons";
import {
  checkStorefrontSlug,
  getStorefrontSettings,
  putStorefrontSettings,
  uploadStorefrontImage,
  type StorefrontMode,
  type StorefrontSettings,
} from "../storefront-api";
import { STOREFRONT_TEMPLATES, STOREFRONT_THEMES } from "../storefront-templates";

const slugify = (v: string) => v.trim().toLowerCase();

export function Template() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [settings, setSettings] = useState<StorefrontSettings | null>(null);
  const [slug, setSlug] = useState("");
  const [mode, setMode] = useState<StorefrontMode>("product");
  const [template, setTemplate] = useState("product-1");
  const [theme, setTheme] = useState("warm");
  const [bannerUrl, setBannerUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [active, setActive] = useState(true);
  const [slugState, setSlugState] = useState<{ checking: boolean; available: boolean | null; reason: string | null }>({
    checking: false,
    available: null,
    reason: null,
  });
  const [loadErr, setLoadErr] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const bannerInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getMe().then(setMe);
  }, []);
  useEffect(() => {
    if (me === null) window.location.href = "/login";
    else if (me && !me.permissions?.includes("app:users.manage")) window.location.replace("/app");
  }, [me]);

  useEffect(() => {
    if (!me || !me.permissions?.includes("app:users.manage")) return;
    void getStorefrontSettings()
      .then((s) => {
        setSettings(s);
        setSlug(s.slug);
        setMode(s.mode);
        setTemplate(s.template);
        setTheme(s.theme || "warm");
        setBannerUrl(s.bannerUrl);
        setLogoUrl(s.logoUrl);
        setTagline(s.tagline);
        setDescription(s.description);
        setWhatsapp(s.whatsapp);
        setActive(s.active);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "Gagal memuat pengaturan storefront."));
  }, [me]);

  useEffect(() => {
    if (!settings || !slug) return;
    if (slug === settings.slug) {
      setSlugState({ checking: false, available: true, reason: null });
      return;
    }
    const t = window.setTimeout(() => {
      setSlugState({ checking: true, available: null, reason: null });
      void checkStorefrontSlug(slug)
        .then((r) => setSlugState({ checking: false, available: r.available, reason: r.reason }))
        .catch((e) =>
          setSlugState({
            checking: false,
            available: null,
            reason: e instanceof Error ? e.message : "Gagal memeriksa slug.",
          })
        );
    }, 350);
    return () => window.clearTimeout(t);
  }, [settings, slug]);

  const templates = useMemo(() => STOREFRONT_TEMPLATES[mode], [mode]);
  const publicUrl = `${window.location.origin}/t/${slug || settings?.slug || ""}`;
  const currentTemplate = templates.find((t) => t.key === template)?.name ?? "Template";
  const currentTheme = STOREFRONT_THEMES.find((t) => t.key === theme)?.name ?? theme;

  function setStoreMode(next: StorefrontMode) {
    setMode(next);
    const allowed = STOREFRONT_TEMPLATES[next];
    if (!allowed.some((t) => t.key === template)) setTemplate(allowed[0]!.key);
  }

  async function persistLogo(url: string) {
    setUploadingLogo(true);
    setErr("");
    setMsg("");
    try {
      const s = await putStorefrontSettings({ logoUrl: url });
      setSettings(s);
      setLogoUrl(s.logoUrl);
      setMsg(url ? "Logo storefront disimpan." : "Logo storefront dihapus.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan logo.");
    } finally {
      setUploadingLogo(false);
    }
  }

  async function save() {
    if (!settings || saving) return;
    if (slugState.available === false) {
      setErr(slugState.reason || "Slug tidak tersedia.");
      return;
    }
    setSaving(true);
    setErr("");
    setMsg("");
    try {
      const s = await putStorefrontSettings({ slug, mode, template, theme, bannerUrl, logoUrl, tagline, description, whatsapp, active });
      setSettings(s);
      setSlug(s.slug);
      setMode(s.mode);
      setTemplate(s.template);
      setTheme(s.theme || theme);
      setBannerUrl(s.bannerUrl);
      setLogoUrl(s.logoUrl);
      setWhatsapp(s.whatsapp);
      setActive(s.active);
      setMsg("Pengaturan storefront disimpan.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan storefront.");
    } finally {
      setSaving(false);
    }
  }

  function copyUrl() {
    void navigator.clipboard?.writeText(publicUrl).then(
      () => setMsg("URL storefront disalin."),
      () => setErr("Gagal menyalin URL.")
    );
  }

  if (me === undefined || me === null || !me.permissions?.includes("app:users.manage")) return <PageLoader />;
  if (!settings && !loadErr) {
    return (
      <div className="app">
        <AppHeader me={me} />
        <main className="page page--narrow">
          <PageLoader />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <AppHeader me={me} />
      <main className="page sf-tpl-page">
        <header className="sf-tpl-head">
          <div>
            <span className="sf-tpl-eyebrow">Storefront</span>
            <h1>Template &amp; tampilan</h1>
            <p>Atur layout, banner, warna, dan identitas toko publik perusahaan ini.</p>
          </div>
          <div className="sf-tpl-head__actions">
            <a className="btn btn--2" href={publicUrl} target="_blank" rel="noopener noreferrer">
              <IconExternal size={16} /> Buka toko
            </a>
            <button type="button" className="btn" onClick={() => void save()} disabled={saving || slugState.available === false || slugState.checking}>
              {saving ? <span className="spinner" aria-hidden="true" /> : <IconCheck size={16} />}
              {saving ? "Menyimpan…" : "Simpan"}
            </button>
          </div>
        </header>

        {loadErr && <p className="banner banner--err" role="alert">{loadErr}</p>}
        {err && <p className="banner banner--err" role="alert">{err}</p>}
        {msg && <p className="banner banner--ok" role="status">{msg}</p>}

        {settings && (
          <div className="sf-tpl-layout">
            <div className="sf-tpl-main">
              <section className="sf-panel">
                <div className="sf-panel__head">
                  <span className="sf-panel__num">01</span>
                  <div>
                    <strong>Layout storefront</strong>
                    <p>Pilih jenis alur dan susunan halaman. Tampilan tidak bergantung pada warna.</p>
                  </div>
                </div>

                <div className="sf-mode">
                  <button type="button" className={`sf-mode__opt${mode === "product" ? " is-on" : ""}`} onClick={() => setStoreMode("product")}>
                    <strong>Produk</strong>
                    <span>Katalog → keranjang → order</span>
                  </button>
                  <button type="button" className={`sf-mode__opt${mode === "service" ? " is-on" : ""}`} onClick={() => setStoreMode("service")}>
                    <strong>Jasa</strong>
                    <span>Katalog → konsultasi WhatsApp</span>
                  </button>
                </div>

                <div className="sf-label">Susunan layout</div>
                <div className="sf-templates">
                  {templates.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className={`sf-template${template === t.key ? " is-on" : ""}`}
                      onClick={() => setTemplate(t.key)}
                      aria-pressed={template === t.key}
                    >
                      <span className={`sf-mini sf-mini--${t.key}`} aria-hidden="true">
                        <span className="sf-mini__bar" />
                        <span className="sf-mini__hero" />
                        <span className="sf-mini__grid"><i /><i /><i /><i /></span>
                      </span>
                      <span className="sf-template__text">
                        <strong>{t.name} {t.depth && <em className="sf-template__depth">Non-flat</em>}</strong>
                        <span className="meta">{t.description}</span>
                      </span>
                      {template === t.key && <span className="sf-template__pick"><IconCheck size={13} /> Dipilih</span>}
                    </button>
                  ))}
                </div>
              </section>

              <section className="sf-panel">
                <div className="sf-panel__head">
                  <span className="sf-panel__num">02</span>
                  <div>
                    <strong>Hero banner</strong>
                    <p>Gambar utama di bagian atas halaman toko. Rasio lebar 16:7.</p>
                  </div>
                </div>
                <div className={`sf-banner-edit${bannerUrl ? " has-image" : ""}`}>
                  <div className="sf-banner-edit__preview">
                    {bannerUrl ? (
                      <img src={bannerUrl} alt="Pratinjau hero banner" />
                    ) : (
                      <span className="sf-banner-edit__empty"><IconFileImage size={28} /> Belum ada banner</span>
                    )}
                  </div>
                  <div className="sf-banner-edit__actions">
                    <input
                      ref={bannerInput}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setUploadingBanner(true);
                        setErr("");
                        void uploadStorefrontImage(f)
                          .then((url) => setBannerUrl(url))
                          .catch((x) => setErr(x instanceof Error ? x.message : "Gagal upload banner."))
                          .finally(() => {
                            setUploadingBanner(false);
                            if (bannerInput.current) bannerInput.current.value = "";
                          });
                      }}
                    />
                    <button type="button" className="btn btn--2 btn--sm" onClick={() => bannerInput.current?.click()} disabled={uploadingBanner}>
                      {uploadingBanner ? <span className="spinner" aria-hidden="true" /> : <IconUpload size={15} />}
                      {uploadingBanner ? "Mengunggah…" : bannerUrl ? "Ganti banner" : "Unggah banner"}
                    </button>
                    {bannerUrl && (
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setBannerUrl("")}>
                        <IconTrash size={15} /> Hapus
                      </button>
                    )}
                    <span className="meta">JPG, PNG, WEBP, atau GIF · maks 6 MB.</span>
                  </div>
                </div>
              </section>

              <section className="sf-panel">
                <div className="sf-panel__head">
                  <span className="sf-panel__num">03</span>
                  <div>
                    <strong>Tema warna</strong>
                    <p>Warna bisa diganti tanpa mengubah susunan layout.</p>
                  </div>
                </div>
                <div className="sf-themes">
                  {STOREFRONT_THEMES.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className={`sf-theme${theme === t.key ? " is-on" : ""}`}
                      onClick={() => setTheme(t.key)}
                      aria-pressed={theme === t.key}
                    >
                      <span className="sf-theme__swatches" aria-hidden="true">
                        {t.colors.map((c) => <i key={c} style={{ background: c }} />)}
                      </span>
                      <strong>{t.name}</strong>
                      {theme === t.key && <IconCheck size={14} />}
                    </button>
                  ))}
                </div>
              </section>

              <section className="sf-panel">
                <div className="sf-panel__head">
                  <span className="sf-panel__num">04</span>
                  <div>
                    <strong>Identitas toko</strong>
                    <p>Informasi yang tampil di hero, CTA WhatsApp, dan footer.</p>
                  </div>
                </div>
                <div className="sf-logo-edit">
                  <div className="sf-logo-edit__preview">
                    {logoUrl ? <img src={logoUrl} alt="Logo toko" /> : <span className="meta">Belum ada logo</span>}
                  </div>
                  <div className="sf-logo-edit__actions">
                    <input
                      ref={logoInput}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setUploadingLogo(true);
                        setErr("");
                        void uploadStorefrontImage(f)
                          .then((url) => persistLogo(url))
                          .catch((x) => {
                            setErr(x instanceof Error ? x.message : "Gagal upload logo.");
                            setUploadingLogo(false);
                          })
                          .finally(() => {
                            if (logoInput.current) logoInput.current.value = "";
                          });
                      }}
                    />
                    <button type="button" className="btn btn--2 btn--sm" onClick={() => logoInput.current?.click()} disabled={uploadingLogo}>
                      {uploadingLogo ? <span className="spinner" aria-hidden="true" /> : <IconUpload size={15} />}
                      {uploadingLogo ? "Mengunggah…" : logoUrl ? "Ganti logo" : "Unggah logo"}
                    </button>
                    {logoUrl && (
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => void persistLogo("")} disabled={uploadingLogo}>
                        <IconTrash size={15} /> Hapus
                      </button>
                    )}
                    <span className="meta">PNG transparan disarankan. Maks 6 MB.</span>
                  </div>
                </div>

                <div className="sf-fields">
                  <label className="field">
                    Tagline
                    <input className="input" value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={140} placeholder="Kebutuhan harian, kualitas terpercaya" />
                  </label>
                  <label className="field">
                    Nomor WhatsApp
                    <input className="input" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} maxLength={32} inputMode="tel" placeholder="62812xxxxxxx" />
                  </label>
                  <label className="field sf-field--wide">
                    Deskripsi singkat
                    <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1200} rows={4} placeholder="Ceritakan singkat tentang perusahaan dan layanan Anda." />
                  </label>
                </div>
              </section>
            </div>

            <aside className="sf-tpl-side">
              <section className="sf-panel sf-panel--side">
                <div className="sf-side-title"><IconExternal size={16} /> Alamat toko</div>
                <label className="field">
                  Slug
                  <div className="sf-slug-row">
                    <span className="sf-slug-prefix">/t/</span>
                    <input
                      className="input"
                      value={slug}
                      onChange={(e) => setSlug(slugify(e.target.value))}
                      maxLength={40}
                      spellCheck={false}
                      autoCapitalize="none"
                      aria-invalid={slugState.available === false}
                    />
                  </div>
                  {slugState.checking && <span className="meta">Memeriksa ketersediaan…</span>}
                  {!slugState.checking && slugState.available === true && <span className="sf-ok"><IconCheck size={13} /> Slug tersedia</span>}
                  {!slugState.checking && slugState.available === false && <span className="sf-bad">{slugState.reason}</span>}
                </label>
                <div className="sf-url-row">
                  <code>{publicUrl}</code>
                  <button type="button" className="btn btn--2 btn--sm" onClick={copyUrl}>Salin</button>
                </div>
                <label className="sf-check sf-check--box">
                  <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                  <span><strong>Storefront aktif</strong><small>Dapat diakses publik lewat URL di atas.</small></span>
                </label>
              </section>

              <section className="sf-panel sf-panel--side">
                <div className="sf-side-title"><IconLayout size={16} /> Ringkasan</div>
                <dl className="sf-summary">
                  <div><dt>Jenis</dt><dd>{mode === "product" ? "Produk" : "Jasa"}</dd></div>
                  <div><dt>Layout</dt><dd>{currentTemplate}</dd></div>
                  <div><dt>Tema</dt><dd>{currentTheme}</dd></div>
                  <div><dt>Banner</dt><dd>{bannerUrl ? "Terpasang" : "Belum ada"}</dd></div>
                </dl>
                <div className="sf-side-note">
                  <IconRefresh size={15} />
                  <span>Perubahan baru berlaku setelah tombol <strong>Simpan</strong> ditekan.</span>
                </div>
              </section>
            </aside>
          </div>
        )}

        {settings && (
          <div className="sf-tpl-savebar sf-edit-savebar">
            <span>{msg || "Pastikan pengaturan sudah sesuai sebelum menyimpan."}</span>
            <button type="button" className="btn" onClick={() => void save()} disabled={saving || slugState.available === false || slugState.checking}>
              {saving ? <span className="spinner" aria-hidden="true" /> : <IconCheck size={16} />}
              {saving ? "Menyimpan…" : "Simpan pengaturan"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
