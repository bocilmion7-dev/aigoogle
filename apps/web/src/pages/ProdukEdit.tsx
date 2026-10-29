import { useEffect, useRef, useState } from "react";
import { getMe } from "../api";
import { AppHeader, PageLoader } from "../ui";
import { IconArrowLeft, IconCheck, IconCpu, IconExternal, IconPackage, IconRefresh, IconStar, IconTrash, IconUpload } from "../icons";
import {
  aiStorefrontDescription,
  aiStorefrontImages,
  getStorefrontProduct,
  getStorefrontSettings,
  updateStorefrontProduct,
  uploadStorefrontImage,
  type StorefrontProductRow,
} from "../storefront-api";

const rp = (n: number | null) => (n === null ? "—" : `Rp${Math.round(n).toLocaleString("id-ID")}`);
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

export function ProdukEdit({ id }: { id: string }) {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [product, setProduct] = useState<StorefrontProductRow | null>(null);
  const [slug, setSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgProgress, setImgProgress] = useState(0);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [watermark, setWatermark] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  const [featured, setFeatured] = useState(false);
  const [sortOrder, setSortOrder] = useState(0);
  const [aiTone, setAiTone] = useState<"menjual" | "informatif" | "ringkas">("menjual");
  const [aiKeywords, setAiKeywords] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getMe().then(setMe);
  }, []);
  useEffect(() => {
    if (me === null) window.location.href = "/login";
    else if (me && !me.permissions?.includes("app:users.manage")) window.location.replace("/app");
  }, [me]);

  useEffect(() => {
    if (!me || !me.permissions?.includes("app:users.manage")) return;
    let alive = true;
    setLoading(true);
    void Promise.all([getStorefrontProduct(id), getStorefrontSettings().catch(() => null)])
      .then(([r, s]) => {
        if (!alive) return;
        const p = r.product;
        setProduct(p);
        setTitle(p.title);
        setCategory(p.category);
        setUnit(p.unit);
        setDescription(p.description);
        setImages(p.images?.length ? p.images : p.imageUrl ? [p.imageUrl] : []);
        setActive(p.active);
        setFeatured(p.featured);
        setSortOrder(p.sortOrder);
        if (s) setSlug(s.slug);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Gagal memuat produk."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, me]);

  async function upload(files: FileList) {
    const list = [...files].slice(0, Math.max(0, 8 - images.length));
    if (!list.length) return setErr("Maksimal 8 gambar per produk.");
    setUploading(true);
    setErr("");
    try {
      const urls: string[] = [];
      for (const file of list) urls.push(await uploadStorefrontImage(file));
      setImages((cur) => [...cur, ...urls].slice(0, 8));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal upload gambar.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function generateAi() {
    if (!product || aiBusy) return;
    setAiBusy(true);
    setErr("");
    setMsg("");
    try {
      const r = await aiStorefrontDescription(product.id, { tone: aiTone, keywords: aiKeywords.trim() || undefined });
      setDescription(r.description);
      setMsg("Deskripsi AI berhasil dibuat. Silakan edit lalu simpan.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal membuat deskripsi AI.");
    } finally {
      setAiBusy(false);
    }
  }

  async function suggestImages() {
    if (!product || imgBusy) return;
    setImgBusy(true);
    setImgProgress(0);
    setSuggestions([]);
    setErr("");
    setMsg("");
    try {
      const r = await aiStorefrontImages(product.id, (image, index, wm) => {
        setSuggestions((cur) => (cur.includes(image.url) ? cur : [...cur, image.url]));
        setImgProgress(index + 1);
        if (wm) setWatermark(wm);
      });
      setWatermark(r.watermark);
      setMsg(
        r.images.length === 3
          ? "3 gambar AI berhasil dibuat. Pilih gambar yang ingin dipakai."
          : "Sebagian gambar berhasil dibuat. Coba lagi untuk melengkapi."
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal membuat gambar AI.");
    } finally {
      setImgBusy(false);
    }
  }

  function useSuggestion(url: string) {
    setImages((cur) => (cur.includes(url) || cur.length >= 8 ? cur : [...cur, url]));
  }

  function useAllSuggestions() {
    setImages((cur) => {
      const next = [...cur];
      for (const url of suggestions) if (next.length < 8 && !next.includes(url)) next.push(url);
      return next;
    });
  }

  async function save() {
    if (!product || saving) return;
    setSaving(true);
    setErr("");
    setMsg("");
    try {
      const r = await updateStorefrontProduct(product.id, {
        title: title.trim(),
        category: category.trim(),
        description: description.trim(),
        images,
        imageUrl: images[0] ?? "",
        active,
        featured,
        sortOrder,
      });
      setProduct(r.product);
      setTitle(r.product.title);
      setImages(r.product.images);
      setMsg("Produk berhasil disimpan.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan produk.");
    } finally {
      setSaving(false);
    }
  }

  function moveCover(url: string) {
    setImages((cur) => [url, ...cur.filter((x) => x !== url)]);
  }
  function removeImage(url: string) {
    setImages((cur) => cur.filter((x) => x !== url));
  }

  if (me === undefined || me === null || !me.permissions?.includes("app:users.manage")) return <PageLoader />;
  if (loading) {
    return (
      <div className="app">
        <AppHeader me={me} />
        <main className="page"><PageLoader /></main>
      </div>
    );
  }
  if (!product) {
    return (
      <div className="app">
        <AppHeader me={me} />
        <main className="page page--narrow">
          <p className="banner banner--err" role="alert">{err || "Produk tidak ditemukan."}</p>
          <a className="btn" href="/produk"><IconArrowLeft size={15} /> Kembali ke produk</a>
        </main>
      </div>
    );
  }

  const name = product.title || product.name || product.itemNo;
  const publicLink = slug ? `/t/${slug}/p/${product.id}` : "";

  return (
    <div className="app">
      <AppHeader me={me} />
      <main className="page sf-edit-page">
        <header className="sf-edit-head">
          <div>
            <a className="sf-edit-back" href="/produk"><IconArrowLeft size={14} /> Produk storefront</a>
            <h1>Edit produk</h1>
            <p>{product.name || product.itemNo} · kode {product.itemNo}</p>
          </div>
          <div className="sf-edit-head__actions">
            {publicLink && (
              <a className="btn btn--2" href={publicLink} target="_blank" rel="noopener noreferrer">
                <IconExternal size={15} /> Lihat di toko
              </a>
            )}
            <button type="button" className="btn" onClick={() => void save()} disabled={saving}>
              {saving ? <span className="spinner" aria-hidden="true" /> : <IconCheck size={16} />}
              {saving ? "Menyimpan…" : "Simpan"}
            </button>
          </div>
        </header>

        {err && <p className="banner banner--err" role="alert">{err}</p>}
        {msg && <p className="banner banner--ok" role="status">{msg}</p>}

        <div className="sf-edit-layout">
          <div className="sf-edit-main">
            <section className="sf-panel">
              <div className="sf-panel__head">
                <span className="sf-panel__num">01</span>
                <div><strong>Gambar produk</strong><p>Urutan pertama menjadi cover. Maksimal 8 gambar.</p></div>
              </div>
              <div className="sf-edit-gallery">
                <div className="sf-edit-cover">
                  {images[0] ? <img src={images[0]} alt="Gambar utama" /> : <span className="sf-prod-card__ph">{initials(name)}</span>}
                  {images[0] && <span className="sf-edit-cover__label">Cover</span>}
                </div>
                <div className="sf-edit-thumbs">
                  {images.map((url) => (
                    <div key={url} className={`sf-edit-thumb${url === images[0] ? " is-cover" : ""}`}>
                      <img src={url} alt="" />
                      <div className="sf-edit-thumb__actions">
                        <button type="button" onClick={() => moveCover(url)} title="Jadikan cover" disabled={url === images[0]}><IconStar size={13} /></button>
                        <button type="button" onClick={() => removeImage(url)} title="Hapus"><IconTrash size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={(e) => e.target.files?.length && void upload(e.target.files)} />
              <button type="button" className="btn btn--2 btn--sm" onClick={() => fileRef.current?.click()} disabled={uploading || images.length >= 8}>
                {uploading ? <span className="spinner" aria-hidden="true" /> : <IconUpload size={15} />}
                {uploading ? "Mengunggah…" : images.length >= 8 ? "Maksimal 8 gambar" : "Tambah gambar"}
              </button>

              <div className="sf-ai-images">
                <div className="sf-ai-images__head">
                  <span className="sf-ai-box__icon"><IconCpu size={18} /></span>
                  <div>
                    <strong>Suggestion gambar AI</strong>
                    <p>3 variasi foto produk: studio, lifestyle, dan close-up. Watermark nama toko ditempel tipis otomatis. Proses ±1–2 menit karena kuota image generator.</p>
                  </div>
                  <button type="button" className="btn btn--2 btn--sm" onClick={() => void suggestImages()} disabled={imgBusy}>
                    {imgBusy ? <span className="spinner" aria-hidden="true" /> : <IconCpu size={15} />}
                    {imgBusy ? `Membuat ${imgProgress}/3…` : "Buat 3 gambar AI"}
                  </button>
                </div>
                {suggestions.length > 0 && (
                  <>
                    <div className="sf-ai-images__grid">
                      {suggestions.map((url, i) => (
                        <figure key={url} className="sf-ai-image">
                          <img src={url} alt={`Saran gambar AI ${i + 1}`} loading="lazy" />
                          <figcaption>
                            <span>{["Studio", "Lifestyle", "Close-up"][i] ?? `Saran ${i + 1}`}</span>
                            <button type="button" className="btn btn--sm" onClick={() => useSuggestion(url)} disabled={images.includes(url) || images.length >= 8}>
                              {images.includes(url) ? "Dipakai" : "Pakai"}
                            </button>
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                    <div className="sf-ai-images__foot">
                      <span className="meta">Watermark: <strong>{watermark}</strong></span>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={useAllSuggestions} disabled={images.length >= 8}>
                        Pakai semua
                      </button>
                    </div>
                  </>
                )}
              </div>
            </section>

            <section className="sf-panel">
              <div className="sf-panel__head">
                <span className="sf-panel__num">02</span>
                <div><strong>Informasi produk</strong><p>Informasi ini yang dibaca calon pembeli di storefront.</p></div>
              </div>
              <div className="sf-edit-fields">
                <label className="field sf-field--wide">
                  Judul tampilan
                  <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Nama produk dari Accurate" />
                </label>
                <label className="field">
                  Kategori
                  <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={80} placeholder="Contoh: Makanan ringan" />
                </label>
                <label className="field">
                  Satuan
                  <input className="input" value={unit} readOnly placeholder="Dari Accurate" />
                </label>
                <div className="sf-edit-fields__row">
                  <label className="sf-check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Tampilkan di storefront</label>
                  <label className="sf-check"><input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} /> Tandai unggulan</label>
                  <label className="field sf-edit-sort">
                    Urutan
                    <input className="input" type="number" min={0} max={9999} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value) || 0)} />
                  </label>
                </div>
              </div>
            </section>

            <section className="sf-panel">
              <div className="sf-panel__head">
                <span className="sf-panel__num">03</span>
                <div><strong>Deskripsi</strong><p>Ceritakan manfaat, bahan, ukuran, dan keunggulan produk.</p></div>
              </div>
              <label className="field">
                Deskripsi storefront
                <textarea className="input" rows={9} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder="Tulis deskripsi produk yang menarik…" />
                <span className="meta">{description.length}/2000 karakter</span>
              </label>

              <div className="sf-ai-box">
                <div className="sf-ai-box__head">
                  <span className="sf-ai-box__icon"><IconCpu size={18} /></span>
                  <div><strong>Tulis otomatis dengan AI</strong><p>AI membuat deskripsi dari nama, kategori, satuan, dan harga produk. Hasilnya bisa diedit.</p></div>
                </div>
                <div className="sf-ai-box__controls">
                  <label className="field">
                    Gaya bahasa
                    <select className="select" value={aiTone} onChange={(e) => setAiTone(e.target.value as typeof aiTone)}>
                      <option value="menjual">Menjual</option>
                      <option value="informatif">Informatif</option>
                      <option value="ringkas">Ringkas</option>
                    </select>
                  </label>
                  <label className="field">
                    Kata kunci tambahan
                    <input className="input" value={aiKeywords} onChange={(e) => setAiKeywords(e.target.value)} maxLength={200} placeholder="Contoh: arabika, medium roast, 250g" />
                  </label>
                  <button type="button" className="btn btn--2" onClick={() => void generateAi()} disabled={aiBusy}>
                    {aiBusy ? <span className="spinner" aria-hidden="true" /> : <IconCpu size={16} />}
                    {aiBusy ? "Menyusun…" : "Buat deskripsi AI"}
                  </button>
                </div>
                <span className="meta">Menggunakan saldo token AI perusahaan.</span>
              </div>
            </section>
          </div>

          <aside className="sf-edit-side">
            <section className="sf-panel sf-panel--side">
              <div className="sf-side-title"><IconPackage size={16} /> Data Accurate</div>
              <dl className="sf-summary">
                <div><dt>Kode</dt><dd>{product.itemNo}</dd></div>
                <div><dt>Nama Accurate</dt><dd>{product.name || "—"}</dd></div>
                <div><dt>Harga</dt><dd>{rp(product.price)}</dd></div>
                <div><dt>Stok</dt><dd>{product.stock === null ? "—" : product.stock}</dd></div>
                <div><dt>Satuan</dt><dd>{product.unit || "—"}</dd></div>
              </dl>
              <div className="sf-side-note"><IconRefresh size={15} /><span>Harga dan stok berasal dari sinkronisasi Accurate.</span></div>
            </section>
            <section className="sf-panel sf-panel--side">
              <div className="sf-side-title"><IconCheck size={16} /> Status tampil</div>
              <dl className="sf-summary">
                <div><dt>Status</dt><dd>{active ? "Aktif" : "Nonaktif"}</dd></div>
                <div><dt>Unggulan</dt><dd>{featured ? "Ya" : "Tidak"}</dd></div>
                <div><dt>Gambar</dt><dd>{images.length} / 8</dd></div>
                <div><dt>Deskripsi</dt><dd>{description.length} karakter</dd></div>
              </dl>
            </section>
          </aside>
        </div>

        <div className="sf-tpl-savebar sf-edit-savebar">
          <span>{msg || "Perubahan belum tersimpan."}</span>
          <button type="button" className="btn" onClick={() => void save()} disabled={saving}>
            {saving ? <span className="spinner" aria-hidden="true" /> : <IconCheck size={16} />}
            {saving ? "Menyimpan…" : "Simpan produk"}
          </button>
        </div>
      </main>
    </div>
  );
}
