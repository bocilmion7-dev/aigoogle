import { useEffect, useMemo, useRef, useState } from "react";
import "./storefront.css";
import { IconArrowLeft, IconCart, IconChat, IconCheck, IconHome, IconLayout, IconList, IconPackage, IconSearch, IconStar, IconTrash, IconTruck, IconWhatsApp } from "../icons";
import { storefrontBasePath } from "../storefront-host";
import {
  createStorefrontOrder,
  getPublicStorefront,
  getStorefrontOrder,
  quoteStorefrontShipping,
  trackStorefront,
  type PublicOrderStatus,
  type PublicStorefront,
  type ShippingOption,
  type StorefrontOrderResult,
  type StorefrontTracking,
} from "../storefront-api";

const rp = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `Rp${Math.round(n).toLocaleString("id-ID")}`;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
const digits = (v: string) => v.replace(/\D/g, "");

type Product = PublicStorefront["products"][number];
type Cart = Record<string, number>;

function waLink(number: string, text: string): string {
  if (!number) return "";
  return `https://wa.me/${digits(number)}?text=${encodeURIComponent(text)}`;
}

function cartKey(slug: string) {
  return `sf:cart:${slug}`;
}

function loadCart(slug: string): Cart {
  try {
    const raw = localStorage.getItem(cartKey(slug));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Cart = {};
    for (const [id, qty] of Object.entries(parsed)) {
      const n = Number(qty);
      if (Number.isFinite(n) && n > 0) out[id] = Math.min(999, Math.floor(n));
    }
    return out;
  } catch {
    return {};
  }
}

export function Storefront({ slug, subpath = "" }: { slug: string; subpath?: string }) {
  const [data, setData] = useState<PublicStorefront | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"featured" | "price-asc" | "price-desc">("featured");
  const [page, setPage] = useState(1);
  const [cart, setCart] = useState<Cart>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [order, setOrder] = useState<StorefrontOrderResult | null>(null);
  const [orderStatus, setOrderStatus] = useState<PublicOrderStatus | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [view, setView] = useState<"grid" | "list">(() => {
    try {
      return localStorage.getItem(`sf:view:${slug}`) === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const trackingPage = subpath === "lacak" || subpath === "tracking";
  const categoryPage = subpath === "kategori" || subpath.startsWith("kategori/");
  const productId = subpath.startsWith("p/") ? decodeURIComponent(subpath.slice(2)) : "";
  const detailPage = !!productId;

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await getPublicStorefront(slug);
      setData(r);
      document.title = trackingPage
        ? `Lacak Pesanan — ${r.store.companyName}`
        : categoryPage
          ? `Kategori — ${r.store.companyName}`
          : detailPage
            ? `${r.store.companyName} — Produk`
            : `${r.store.companyName}${r.store.tagline ? ` — ${r.store.tagline}` : ""}`;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Storefront tidak ditemukan.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (!data) return;
    document.title = trackingPage
      ? `Lacak Pesanan — ${data.store.companyName}`
      : categoryPage
        ? `Kategori — ${data.store.companyName}`
        : detailPage
          ? `${data.store.companyName} — Produk`
          : `${data.store.companyName}${data.store.tagline ? ` — ${data.store.tagline}` : ""}`;
  }, [data, trackingPage, categoryPage, detailPage]);

  useEffect(() => {
    setCart(loadCart(slug));
    try {
      setView(localStorage.getItem(`sf:view:${slug}`) === "list" ? "list" : "grid");
    } catch {
      setView("grid");
    }
  }, [slug]);

  useEffect(() => {
    try {
      localStorage.setItem(`sf:view:${slug}`, view);
    } catch {
      /* localStorage bisa diblokir */
    }
  }, [view, slug]);

  useEffect(() => {
    try {
      localStorage.setItem(cartKey(slug), JSON.stringify(cart));
    } catch {
      /* localStorage bisa diblokir */
    }
  }, [cart, slug]);

  useEffect(() => {
    const hash = window.location.hash;
    if (!data || trackingPage || categoryPage || detailPage) return;
    if (hash !== "#katalog" && hash !== "#semua-produk") return;
    const t = window.setTimeout(() => {
      document.getElementById("semua-produk")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    return () => window.clearTimeout(t);
  }, [data, trackingPage, categoryPage, detailPage]);

  useEffect(() => {
    setPage(1);
  }, [q, sort]);

  useEffect(() => {
    if (!order) return;
    let alive = true;
    const tick = async () => {
      try {
        const s = await getStorefrontOrder(slug, order.orderId);
        if (alive) setOrderStatus(s);
      } catch {
        /* biarkan status terakhir */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 5000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [order, slug]);

  const products = data?.products ?? [];
  const detailProduct = detailPage ? products.find((p) => p.id === productId) : undefined;
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const list = products.filter((p) => {
      if (!query) return true;
      return [p.title, p.description, p.category].some((v) => v.toLowerCase().includes(query));
    });
    if (sort === "price-asc") list.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    if (sort === "price-desc") list.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
    if (sort === "featured") list.sort((a, b) => Number(b.featured) - Number(a.featured));
    return list;
  }, [products, q, sort]);
  const latest = useMemo(
    () =>
      [...products]
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
        .slice(0, 8),
    [products]
  );
  const bestsellers = useMemo(
    () =>
      [...products]
        .sort(
          (a, b) =>
            (b.soldQty ?? 0) - (a.soldQty ?? 0) ||
            Number(b.featured) - Number(a.featured) ||
            a.sortOrder - b.sortOrder
        )
        .slice(0, 8),
    [products]
  );
  const PAGE_SIZE = 20;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const cartItems = useMemo(
    () => products.filter((p) => (cart[p.id] ?? 0) > 0).map((p) => ({ ...p, qty: cart[p.id]! })),
    [products, cart]
  );
  const cartCount = cartItems.reduce((a, p) => a + p.qty, 0);
  const cartTotal = cartItems.reduce((a, p) => a + (p.price ?? 0) * p.qty, 0);

  function add(id: string, qty = 1) {
    setCart((c) => ({ ...c, [id]: Math.min(999, (c[id] ?? 0) + qty) }));
  }
  function setQty(id: string, qty: number) {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[id];
      else next[id] = Math.min(999, qty);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="sf sf--loading">
        <div className="sf-loader">
          <span className="sf-spinner" />
          <span>Menyiapkan toko…</span>
        </div>
      </div>
    );
  }
  if (err || !data) {
    return (
      <div className="sf sf--error">
        <div className="sf-error-card">
          <strong>Storefront tidak tersedia</strong>
          <p>{err || "Alamat toko tidak ditemukan."}</p>
          <button type="button" className="sf-btn" onClick={() => void load()}>Coba lagi</button>
        </div>
      </div>
    );
  }

  const { store } = data;
  const service = store.mode === "service";
  const wa = (text: string) => waLink(store.whatsapp, text);
  const waGeneral = wa(`Halo ${store.companyName}, saya ingin bertanya.`);
  const base = storefrontBasePath(store.slug);
  const catalogHref = base || "/";
  const categoryHref = `${base}/kategori`;
  const trackingHref = `${base}/lacak`;

  return (
    <div className={`sf sf--${store.template} sf-theme-${store.theme || "warm"}${service ? " sf--service" : " sf--product"}`}>
      <header className="sf-nav">
        <a className="sf-brand" href={catalogHref}>
          {store.logoUrl ? (
            <img className="sf-brand__logo" src={store.logoUrl} alt={store.companyName} />
          ) : (
            <span className="sf-brand__mark">{initials(store.companyName)}</span>
          )}
          <span>
            <strong>{store.companyName}</strong>
            {store.tagline && <small>{store.tagline}</small>}
          </span>
        </a>
        <nav className="sf-nav__links" aria-label="Navigasi toko">
          <a href={catalogHref + "#semua-produk"}>Katalog</a>
          {!service && <a href={trackingHref}>Lacak</a>}
          {store.whatsapp && <a href={waGeneral} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
        </nav>
      </header>

      <nav className="sf-bottomnav" aria-label="Navigasi toko">
        <a href={catalogHref} aria-current={!trackingPage && !categoryPage && !detailPage ? "page" : undefined}>
          <IconHome size={20} />
          <span>Home</span>
        </a>
        <a href={categoryHref} aria-current={categoryPage ? "page" : undefined}>
          <IconLayout size={20} />
          <span>Kategori</span>
        </a>
        {service ? (
          <a href={waGeneral} target="_blank" rel="noopener noreferrer">
            <IconWhatsApp size={20} />
            <span>Konsultasi</span>
          </a>
        ) : (
          <button type="button" onClick={() => setCartOpen(true)}>
            <span className="sf-bottomnav__icon">
              <IconCart size={20} />
              {cartCount > 0 && <span className="sf-bottomnav__badge">{cartCount > 99 ? "99+" : cartCount}</span>}
            </span>
            <span>Keranjang</span>
          </button>
        )}
        <a href={trackingHref} aria-current={trackingPage ? "page" : undefined}>
          <IconTruck size={20} />
          <span>Tracking</span>
        </a>
      </nav>

      {trackingPage ? (
        <TrackingPage store={store} slug={store.slug} />
      ) : categoryPage ? (
        <CategoryPage store={store} products={products} view={view} onView={setView} onAdd={add} />
      ) : detailPage ? (
        detailProduct ? (
          <ProductPage
            store={store}
            product={detailProduct}
            related={products.filter((p) => p.id !== detailProduct.id && p.category === detailProduct.category).slice(0, 4)}
            onAdd={(qty) => add(detailProduct.id, qty)}
            onPhoto={setPhoto}
            cartCount={cartCount}
            onOpenCart={() => setCartOpen(true)}
          />
        ) : (
          <main className="sf-product-missing">
            <IconPackage size={38} />
            <h1>Produk tidak ditemukan</h1>
            <p>Produk mungkin sudah tidak aktif atau tautannya berubah.</p>
            <a className="sf-btn" href={catalogHref}><IconArrowLeft size={16} /> Kembali ke katalog</a>
          </main>
        )
      ) : (
        <main>
          <section className={`sf-hero${store.bannerUrl ? " has-banner" : ""}`}>
            {store.bannerUrl && (
              <div className="sf-hero__banner" aria-hidden="true">
                <img src={store.bannerUrl} alt="" loading="eager" decoding="async" fetchPriority="high" />
              </div>
            )}
            <div className="sf-hero__copy">
              <span className="sf-kicker">{service ? "Layanan & Konsultasi" : "Katalog Pilihan"}</span>
              <h1>{store.companyName}</h1>
              <p>{store.tagline || (service ? "Konsultasikan kebutuhan Anda langsung dengan tim kami." : "Temukan produk pilihan dari toko kami.")}</p>
              {store.description && <p className="sf-hero__desc">{store.description}</p>}
              <div className="sf-hero__meta">
                {service ? (
                  <>
                    <span><IconChat size={13} /> Konsultasi langsung</span>
                    <span><IconCheck size={13} /> Respon cepat</span>
                    <span><IconWhatsApp size={13} /> Tim profesional</span>
                  </>
                ) : (
                  <>
                    <span><IconCheck size={13} /> Stok akurat</span>
                    <span><IconTruck size={13} /> Kirim ke seluruh Indonesia</span>
                    <span><IconChat size={13} /> CS responsif</span>
                  </>
                )}
              </div>
            </div>
            <div className="sf-hero__art" aria-hidden="true">
              <span className="sf-hero__panel" />
              <span className="sf-hero__orb">{service ? <IconChat size={54} /> : <IconPackage size={54} />}</span>
              <span className="sf-hero__sticker">100%</span>
              <span className="sf-hero__sticker sf-hero__sticker--2">{service ? "pro" : "asli"}</span>
            </div>
          </section>

          {latest.length > 0 && (
            <section className="sf-shelf">
              <div className="sf-section-head">
                <div>
                  <span className="sf-kicker">{service ? "Baru" : "Baru masuk"}</span>
                  <h2>{service ? "Layanan terkini" : "Produk terkini"}</h2>
                </div>
                <a className="sf-shelf__all" href="#semua-produk">Lihat semua</a>
              </div>
              <div className="sf-rail">
                {latest.map((p) => <ProductCard key={p.id} product={p} store={store} onAdd={add} />)}
              </div>
            </section>
          )}

          {bestsellers.length > 0 && (
            <section className="sf-shelf">
              <div className="sf-section-head">
                <div>
                  <span className="sf-kicker">Paling dicari</span>
                  <h2>{service ? "Layanan terlaris" : "Produk terlaris"}</h2>
                </div>
                <a className="sf-shelf__all" href="#semua-produk">Lihat semua</a>
              </div>
              <div className="sf-rail">
                {bestsellers.map((p) => <ProductCard key={p.id} product={p} store={store} onAdd={add} />)}
              </div>
            </section>
          )}

          <section className="sf-catalog" id="semua-produk">
            <div className="sf-section-head">
              <div>
                <span className="sf-kicker">{service ? "Layanan" : "Katalog"}</span>
                <h2>{service ? "Semua layanan" : "Semua produk"}</h2>
                <p className="sf-subcount">{filtered.length} {service ? "layanan" : "produk"} · halaman {safePage} dari {pageCount}</p>
              </div>
              {!service && (
                <div className="sf-tools">
                  <div className="sf-search">
                    <IconSearch size={16} />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari produk…" aria-label="Cari produk" />
                  </div>
                  <select className="sf-sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Urutkan produk">
                    <option value="featured">Unggulan</option>
                    <option value="price-asc">Harga terendah</option>
                    <option value="price-desc">Harga tertinggi</option>
                  </select>
                  <ViewToggle view={view} onChange={setView} />
                </div>
              )}
            </div>

            {filtered.length === 0 ? (
              <div className="sf-empty">
                <IconPackage size={36} />
                <strong>{products.length === 0 ? "Belum ada item" : "Tidak ada yang cocok"}</strong>
                <p>{products.length === 0 ? "Admin toko belum menambahkan katalog." : "Coba kata kunci atau kategori lain."}</p>
              </div>
            ) : (
              <>
                <div className={`sf-grid${view === "list" ? " sf-grid--list" : ""}`}>
                  {pageItems.map((p) => (
                    <ProductCard key={p.id} product={p} store={store} onAdd={add} />
                  ))}
                </div>
                <PageNav page={safePage} pageCount={pageCount} onChange={setPage} />
              </>
            )}
          </section>

          <div className="sf-proof">
            <div><IconTruck size={20} /><strong>Pengiriman terpercaya</strong><span>Ongkir transparan & resi terlacak</span></div>
            <div><IconCheck size={20} /><strong>Pembayaran aman</strong><span>QRIS & konfirmasi otomatis</span></div>
            <div><IconPackage size={20} /><strong>Produk pilihan</strong><span>Stok dan harga dari Accurate</span></div>
            <div><IconChat size={20} /><strong>Bantuan cepat</strong><span>Chat langsung dengan toko</span></div>
          </div>

          {!service && (
            <section className="sf-how">
              <span className="sf-kicker">Cara pesan</span>
              <h2>Belanja mudah dalam 4 langkah</h2>
              <div className="sf-how__grid">
                <div><span>01</span><strong>Pilih produk</strong><p>Lihat detail, foto, dan stok terkini.</p></div>
                <div><span>02</span><strong>Checkout</strong><p>Isi data, pilih ambil di toko atau kurir.</p></div>
                <div><span>03</span><strong>Bayar QRIS</strong><p>Scan QRIS, status terverifikasi otomatis.</p></div>
                <div><span>04</span><strong>Lacak</strong><p>Masukkan nomor resi untuk melihat perjalanan paket.</p></div>
              </div>
            </section>
          )}

          <section className="sf-cta">
            <div>
              <span className="sf-kicker">{service ? "Butuh diskusi?" : "Butuh bantuan?"}</span>
              <h2>{service ? "Ceritakan kebutuhan Anda" : "Tanya stok atau produk tertentu"}</h2>
              <p>{store.description || "Tim kami siap membantu Anda."}</p>
            </div>
            {store.whatsapp ? (
              <a className="sf-btn sf-btn--light" href={waGeneral} target="_blank" rel="noopener noreferrer">
                <IconWhatsApp size={16} /> Hubungi via WhatsApp
              </a>
            ) : null}
          </section>
        </main>
      )}

      <footer className="sf-footer">
        <span>{store.companyName}</span>
        <span className="sf-footer__links">
          <a href={catalogHref}>Katalog</a>
          {!service && <a href={trackingHref}>Lacak resi</a>}
          {store.whatsapp && <a href={waGeneral} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
        </span>
        <span>Storefront ini dikelola oleh pemilik usaha.</span>
      </footer>

      {store.whatsapp && (
        <a
          className="sf-wa-fab"
          href={waGeneral}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Chat WhatsApp toko"
        >
          <IconWhatsApp size={25} />
          <span>Chat</span>
        </a>
      )}

      {photo && <PhotoLightbox src={photo} onClose={() => setPhoto(null)} />}

      {cartOpen && (
        <div className="sf-modal" role="presentation" onClick={() => setCartOpen(false)}>
          <div className="sf-modal__panel sf-cart" role="dialog" aria-modal="true" aria-labelledby="sf-cart-title" onClick={(e) => e.stopPropagation()}>
            <div className="sf-modal__head">
              <strong id="sf-cart-title">Keranjang belanja</strong>
              <button type="button" onClick={() => setCartOpen(false)} aria-label="Tutup">×</button>
            </div>
            {cartItems.length === 0 ? (
              <div className="sf-cart__empty">
                <IconPackage size={34} />
                <strong>Keranjang masih kosong</strong>
                <p>Yuk pilih produk favorit Anda terlebih dahulu.</p>
                <button type="button" className="sf-btn sf-btn--ghost" onClick={() => setCartOpen(false)}>Lihat katalog</button>
              </div>
            ) : (
              <>
                <ul className="sf-cart__list">
                  {cartItems.map((p) => (
                    <li key={p.id}>
                      <span className="sf-cart__thumb">{p.imageUrl ? <img src={p.imageUrl} alt="" /> : initials(p.title)}</span>
                      <span className="sf-cart__main">
                        <strong>{p.title}</strong>
                        <span>{rp(p.price)}</span>
                      </span>
                      <span className="sf-qty">
                        <button type="button" onClick={() => setQty(p.id, p.qty - 1)} aria-label={`Kurangi ${p.title}`}>−</button>
                        <span>{p.qty}</span>
                        <button type="button" onClick={() => setQty(p.id, p.qty + 1)} aria-label={`Tambah ${p.title}`}>+</button>
                      </span>
                      <button type="button" className="sf-cart__del" onClick={() => setQty(p.id, 0)} aria-label={`Hapus ${p.title}`}><IconTrash size={15} /></button>
                    </li>
                  ))}
                </ul>
                <div className="sf-cart__total"><span>Total</span><strong>{rp(cartTotal)}</strong></div>
                <button type="button" className="sf-btn sf-btn--block" onClick={() => { setCartOpen(false); setCheckoutOpen(true); }}>
                  Checkout sekarang
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {checkoutOpen && (
        <Checkout
          slug={slug}
          items={cartItems}
          total={cartTotal}
          whatsapp={store.whatsapp}
          company={store.companyName}
          onClose={() => setCheckoutOpen(false)}
          onDone={(r) => {
            setOrder(r);
            setOrderStatus(null);
            setCheckoutOpen(false);
            setOrderOpen(true);
            setCart({});
          }}
        />
      )}

      {orderOpen && order && (
        <OrderPanel slug={slug} order={order} status={orderStatus} whatsapp={store.whatsapp} company={store.companyName} onClose={() => setOrderOpen(false)} />
      )}
    </div>
  );
}

function PageNav({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (p: number) => void }) {
  if (pageCount <= 1) return null;
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  const end = Math.min(pageCount, start + 4);
  const nums = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  return (
    <nav className="sf-pager" aria-label="Halaman produk">
      <button type="button" onClick={() => onChange(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Halaman sebelumnya">←</button>
      {start > 1 && <><button type="button" onClick={() => onChange(1)}>1</button>{start > 2 && <span>…</span>}</>}
      {nums.map((n) => (
        <button key={n} type="button" className={n === page ? "is-on" : ""} aria-current={n === page ? "page" : undefined} onClick={() => onChange(n)}>{n}</button>
      ))}
      {end < pageCount && <>{end < pageCount - 1 && <span>…</span>}<button type="button" onClick={() => onChange(pageCount)}>{pageCount}</button></>}
      <button type="button" onClick={() => onChange(Math.min(pageCount, page + 1))} disabled={page >= pageCount} aria-label="Halaman berikutnya">→</button>
    </nav>
  );
}

function ViewToggle({ view, onChange }: { view: "grid" | "list"; onChange: (v: "grid" | "list") => void }) {
  return (
    <div className="sf-viewtoggle" role="group" aria-label="Tampilan produk">
      <button type="button" aria-pressed={view === "grid"} className={view === "grid" ? "is-on" : ""} onClick={() => onChange("grid")} title="Tampilan grid" aria-label="Tampilan grid">
        <IconLayout size={16} />
      </button>
      <button type="button" aria-pressed={view === "list"} className={view === "list" ? "is-on" : ""} onClick={() => onChange("list")} title="Tampilan list" aria-label="Tampilan list">
        <IconList size={16} />
      </button>
    </div>
  );
}

function ProductCard({ product: p, store, onAdd }: { product: Product; store: PublicStorefront["store"]; onAdd: (id: string) => void }) {
  const service = store.mode === "service";
  const base = storefrontBasePath(store.slug);
  const habis = p.stock !== null && p.stock <= 0;
  return (
    <article className="sf-card">
      <div className="sf-card__media">
        <a className="sf-card__imagebtn" href={`${base}/p/${p.id}`} aria-label={`Lihat detail ${p.title}`}>
          {p.imageUrl ? <img src={p.imageUrl} alt={p.title} loading="lazy" /> : <span className="sf-card__ph">{initials(p.title)}</span>}
          <span className="sf-card__zoom"><IconSearch size={14} /> Lihat detail</span>
        </a>
        {p.featured && <span className="sf-card__tag"><IconStar size={10} /> Unggulan</span>}
        {habis && <span className="sf-card__tag sf-card__tag--off">Stok habis</span>}
      </div>
      <div className="sf-card__body">
        <div className="sf-card__title">
          <a href={`${base}/p/${p.id}`}>{p.title}</a>
          {p.category && <span>{p.category}</span>}
        </div>
        <div className="sf-card__foot">
          <strong>{service ? (p.price ? `Mulai ${rp(p.price)}` : "Konsultasi") : rp(p.price)}</strong>
        </div>
        {service ? (
          store.whatsapp ? (
            <a className="sf-btn sf-btn--wa" href={waLink(store.whatsapp, `Halo ${store.companyName}, saya ingin konsultasi tentang ${p.title}.`)} target="_blank" rel="noopener noreferrer">
              <IconWhatsApp size={16} /> Konsultasi
            </a>
          ) : <span className="sf-note">Nomor WhatsApp belum diatur.</span>
        ) : (
          <div className="sf-card__actions sf-card__actions--cart">
            <a className="sf-btn sf-btn--ghost" href={`${base}/p/${p.id}`}>Detail</a>
            <button
              type="button"
              className="sf-btn sf-addcart"
              onClick={() => onAdd(p.id)}
              disabled={habis || !(Number(p.price) > 0)}
              aria-label={habis ? "Stok habis" : !(Number(p.price) > 0) ? "Harga menyusul" : `Tambah ${p.title} ke keranjang`}
              title={habis ? "Stok habis" : !(Number(p.price) > 0) ? "Harga menyusul" : "Tambah ke keranjang"}
            >
              <IconCart size={17} />
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function CategoryPage({
  store,
  products,
  view,
  onView,
  onAdd,
}: {
  store: PublicStorefront["store"];
  products: Product[];
  view: "grid" | "list";
  onView: (v: "grid" | "list") => void;
  onAdd: (id: string) => void;
}) {
  const [active, setActive] = useState("Semua");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const base = storefrontBasePath(store.slug);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) map.set(p.category || "Lainnya", (map.get(p.category || "Lainnya") ?? 0) + 1);
    return map;
  }, [products]);
  const categories = [...counts.keys()].sort((a, b) => a.localeCompare(b, "id"));
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return products.filter((p) => {
      if (active !== "Semua" && (p.category || "Lainnya") !== active) return false;
      if (!query) return true;
      return [p.title, p.description, p.category].some((v) => v.toLowerCase().includes(query));
    });
  }, [products, active, q]);
  useEffect(() => setPage(1), [active, q]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 20));
  const safePage = Math.min(page, pageCount);
  const pageItems = filtered.slice((safePage - 1) * 20, safePage * 20);

  return (
    <main className="sf-category-page">
      <header className="sf-cathead">
        <a href={(base || "/")} className="sf-track__back"><IconArrowLeft size={14} /> Kembali ke Home</a>
        <span className="sf-kicker">Kategori</span>
        <h1>Jelajahi kategori</h1>
        <p>Pilih kategori untuk mempersempit pilihan produk atau layanan.</p>
      </header>

      <div className="sf-catcards">
        <button type="button" className={active === "Semua" ? "is-on" : ""} onClick={() => setActive("Semua")}>
          <span className="sf-catcards__mark"><IconLayout size={20} /></span>
          <strong>Semua</strong>
          <small>{products.length} item</small>
        </button>
        {categories.map((c) => (
          <button key={c} type="button" className={active === c ? "is-on" : ""} onClick={() => setActive(c)}>
            <span className="sf-catcards__mark">{initials(c)}</span>
            <strong>{c}</strong>
            <small>{counts.get(c)} item</small>
          </button>
        ))}
      </div>

      <div className="sf-catbar">
        <div className="sf-search">
          <IconSearch size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Cari di ${active.toLowerCase()}…`} aria-label="Cari produk" />
        </div>
        <ViewToggle view={view} onChange={onView} />
      </div>

      <div className="sf-catsummary">
        <strong>{filtered.length} item</strong>
        <span>{active === "Semua" ? "Semua kategori" : active} · halaman {safePage} dari {pageCount}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="sf-empty">
          <IconPackage size={36} />
          <strong>Tidak ada produk di kategori ini</strong>
          <p>Coba pilih kategori lain atau kembali ke Home.</p>
        </div>
      ) : (
        <>
          <div className={`sf-grid${view === "list" ? " sf-grid--list" : ""}`}>
            {pageItems.map((p) => <ProductCard key={p.id} product={p} store={store} onAdd={onAdd} />)}
          </div>
          <PageNav page={safePage} pageCount={pageCount} onChange={setPage} />
        </>
      )}
    </main>
  );
}

function ProductPage({
  store,
  product,
  related,
  onAdd,
  onPhoto,
  cartCount,
  onOpenCart,
}: {
  store: PublicStorefront["store"];
  product: Product;
  related: Product[];
  onAdd: (qty: number) => void;
  onPhoto: (url: string) => void;
  cartCount: number;
  onOpenCart: () => void;
}) {
  const service = store.mode === "service";
  const base = storefrontBasePath(store.slug);
  const images = product.images?.length ? product.images : product.imageUrl ? [product.imageUrl] : [];
  const [active, setActive] = useState(0);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const habis = product.stock !== null && product.stock <= 0;
  const max = product.stock !== null && product.stock > 0 ? Math.min(999, Math.floor(product.stock)) : 999;
  const wa = waLink(
    store.whatsapp,
    `Halo ${store.companyName}, saya ingin bertanya tentang ${product.title}${product.itemNo ? ` (${product.itemNo})` : ""}.`
  );
  const desc = product.description || "Belum ada deskripsi. Hubungi toko untuk informasi lebih lanjut.";
  const main = images[active] ?? images[0] ?? product.imageUrl;

  useEffect(() => {
    setActive(0);
    setQty(1);
    setAdded(false);
  }, [product.id]);

  function addToCart(open = false) {
    onAdd(qty);
    if (open) {
      onOpenCart();
      return;
    }
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1800);
  }

  return (
    <main className="sf-product-page">
      <nav className="sf-product-crumbs" aria-label="Breadcrumb">
        <a href={(base || "/")}><IconArrowLeft size={14} /> Katalog</a>
        {product.category && <><span>/</span><span>{product.category}</span></>}
      </nav>

      <div className="sf-product-layout">
        <div className="sf-gallery">
          <button
            type="button"
            className="sf-gallery__main"
            onClick={() => main && onPhoto(main)}
            aria-label="Perbesar foto produk"
          >
            {main ? <img src={main} alt={product.title} /> : <span className="sf-card__ph">{initials(product.title)}</span>}
            {main && <span className="sf-gallery__zoom"><IconSearch size={16} /> Perbesar</span>}
            {product.featured && <span className="sf-card__tag"><IconStar size={10} /> Unggulan</span>}
          </button>
          {images.length > 1 && (
            <div className="sf-gallery__thumbs" role="list" aria-label="Galeri produk">
              {images.map((url, i) => (
                <button
                  key={url + i}
                  type="button"
                  role="listitem"
                  className={i === active ? "is-on" : ""}
                  onClick={() => setActive(i)}
                  aria-label={`Lihat gambar ${i + 1}`}
                  aria-pressed={i === active}
                >
                  <img src={url} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="sf-product-info">
          <span className="sf-kicker">{product.category || (service ? "Layanan" : "Produk")}</span>
          <h1>{product.title}</h1>
          <div className="sf-product-badges">
            {product.featured && <span><IconStar size={12} /> Pilihan toko</span>}
            {!service && product.stock !== null && (
              <span className={habis ? "is-out" : "is-ok"}>{habis ? "Stok habis" : `Stok ${product.stock} tersedia`}</span>
            )}
            {product.itemNo && <span>Kode {product.itemNo}</span>}
          </div>
          <div className="sf-product-price">{service ? (product.price ? `Mulai ${rp(product.price)}` : "Harga sesuai konsultasi") : rp(product.price)}</div>
          <p className="sf-product-desc">{desc}</p>

          {!service ? (
            <>
              <div className="sf-product-buy">
                <span className="sf-qty sf-qty--lg">
                  <button type="button" onClick={() => setQty((n) => Math.max(1, n - 1))} aria-label="Kurangi jumlah">−</button>
                  <span>{qty}</span>
                  <button type="button" onClick={() => setQty((n) => Math.min(max, n + 1))} aria-label="Tambah jumlah">+</button>
                </span>
                <button type="button" className="sf-btn" disabled={habis || !(Number(product.price) > 0)} onClick={() => addToCart(false)}>
                  {added ? <><IconCheck size={16} /> Masuk keranjang</> : habis ? "Stok habis" : !(Number(product.price) > 0) ? "Harga menyusul" : "Tambah ke keranjang"}
                </button>
                <button type="button" className="sf-btn sf-btn--ghost" disabled={habis || !(Number(product.price) > 0)} onClick={() => addToCart(true)}>
                  Beli sekarang
                </button>
              </div>
              {cartCount > 0 && (
                <button type="button" className="sf-product-cartlink" onClick={onOpenCart}>
                  <IconPackage size={15} /> Lihat keranjang ({cartCount})
                </button>
              )}
            </>
          ) : store.whatsapp ? (
            <a className="sf-btn sf-btn--wa sf-btn--block" href={wa} target="_blank" rel="noopener noreferrer">
              <IconWhatsApp size={16} /> Konsultasi via WhatsApp
            </a>
          ) : null}

          {store.whatsapp && (
            <a className="sf-product-ask" href={wa} target="_blank" rel="noopener noreferrer">
              <IconWhatsApp size={14} /> Tanya stok, ukuran, atau detail lain
            </a>
          )}

          <div className="sf-product-trust">
            <div><IconTruck size={18} /><span><strong>Dikirim aman</strong><small>Ongkir dihitung saat checkout.</small></span></div>
            <div><IconCheck size={18} /><span><strong>Pembayaran QRIS</strong><small>Status diverifikasi otomatis.</small></span></div>
            <div><IconWhatsApp size={18} /><span><strong>Dibantu langsung</strong><small>Chat dengan tim toko.</small></span></div>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="sf-related">
          <div className="sf-section-head">
            <div><span className="sf-kicker">Rekomendasi</span><h2>Produk serupa</h2></div>
            <a className="sf-related__all" href={`${base}#semua-produk`}>Lihat semua</a>
          </div>
          <div className="sf-grid">
            {related.map((p) => (
              <article className="sf-card" key={p.id}>
                <div className="sf-card__media">
                  <a className="sf-card__imagebtn" href={`${base}/p/${p.id}`} aria-label={`Lihat ${p.title}`}>
                    {p.imageUrl ? <img src={p.imageUrl} alt={p.title} loading="lazy" /> : <span className="sf-card__ph">{initials(p.title)}</span>}
                  </a>
                </div>
                <div className="sf-card__body">
                  <div className="sf-card__title"><a href={`${base}/p/${p.id}`}>{p.title}</a></div>
                  <div className="sf-card__foot"><strong>{service ? (p.price ? `Mulai ${rp(p.price)}` : "Konsultasi") : rp(p.price)}</strong></div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function PhotoLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sf-lightbox" role="dialog" aria-modal="true" aria-label="Pratinjau foto" onClick={onClose}>
      <button type="button" className="sf-lightbox__close" onClick={onClose} aria-label="Tutup foto">×</button>
      <img src={src} alt="Pratinjau foto produk" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

function TrackingPage({ store, slug }: { store: PublicStorefront["store"]; slug: string }) {
  const base = storefrontBasePath(slug);
  const [resi, setResi] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState<StorefrontTracking | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!resi.trim() || busy) return;
    setBusy(true);
    setErr("");
    setData(null);
    try {
      setData(await trackStorefront(slug, resi.trim()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Nomor resi tidak ditemukan.");
    } finally {
      setBusy(false);
    }
  }

  const shipping = data?.shippingStatus || "";
  const label = shippingLabel(shipping);

  return (
    <main className="sf-track">
      <div className="sf-track__head">
        <span className="sf-kicker">Pelacakan</span>
        <h1>Lacak pesanan Anda</h1>
        <p>Masukkan nomor resi (contoh: WYB-…) atau ID pesanan untuk melihat status pengiriman.</p>
        <form className="sf-track__form" onSubmit={(e) => void submit(e)}>
          <IconTruck size={18} />
          <input ref={inputRef} value={resi} onChange={(e) => setResi(e.target.value)} placeholder="Nomor resi / ID pesanan" aria-label="Nomor resi" />
          <button type="submit" className="sf-btn" disabled={busy}>{busy ? "Mencari…" : "Lacak"}</button>
        </form>
        <a className="sf-track__back" href={base || "/"}>← Kembali ke katalog</a>
      </div>

      {err && <div className="sf-track__error" role="alert">{err}</div>}
      {!data && !err && (
        <div className="sf-track__hint">
          <IconPackage size={36} />
          <strong>Nomor resi ada di halaman pesanan atau pesan WhatsApp Anda.</strong>
          <p>Status akan diperbarui otomatis dari kurir.</p>
        </div>
      )}
      {data && (
        <section className="sf-track__card">
          <div className="sf-track__top">
            <div>
              <span className="sf-kicker">Nomor pesanan</span>
              <strong>#{data.orderId.replace("shop-", "")}</strong>
            </div>
            <span className={`sf-status ${data.status === "paid" ? "is-paid" : data.status === "failed" ? "is-failed" : ""}`}>
              {data.status === "paid" ? "Pembayaran diterima" : data.status === "failed" ? "Pembayaran gagal" : "Menunggu pembayaran"}
            </span>
          </div>
          <div className="sf-track__meta">
            <div><span>Kurir</span><strong>{data.courier || "—"}</strong></div>
            <div><span>Nomor resi</span><strong>{data.waybillId || "Menyusul"}</strong></div>
            <div><span>Status kirim</span><strong>{label}</strong></div>
            <div><span>Total</span><strong>{rp(data.total)}</strong></div>
          </div>
          {data.history.length === 0 ? (
            <p className="sf-track__empty">Belum ada riwayat perjalanan paket. Silakan cek kembali beberapa saat lagi.</p>
          ) : (
            <ol className="sf-timeline">
              {data.history.slice().reverse().map((h, i) => (
                <li key={`${h.updatedAt}-${i}`} className={i === 0 ? "is-latest" : ""}>
                  <span className="sf-timeline__dot" />
                  <div><strong>{h.note || shippingLabel(h.status)}</strong><span>{h.status} {h.updatedAt ? `· ${new Date(h.updatedAt).toLocaleString("id-ID")}` : ""}</span></div>
                </li>
              ))}
            </ol>
          )}
          {store.whatsapp && (
            <a className="sf-btn sf-btn--wa sf-btn--block" href={waLink(store.whatsapp, `Halo ${store.companyName}, saya ingin menanyakan pesanan #${data.orderId.replace("shop-", "")}.`)} target="_blank" rel="noopener noreferrer">
              <IconWhatsApp size={16} /> Tanya status via WhatsApp
            </a>
          )}
        </section>
      )}
    </main>
  );
}

function shippingLabel(status: string): string {
  const s = status.toLowerCase();
  if (/delivered|diterima/.test(s)) return "Diterima";
  if (/out_for_delivery|diantar/.test(s)) return "Sedang diantar";
  if (/in_transit|transit|dalam perjalanan/.test(s)) return "Dalam perjalanan";
  if (/picked|dijemput/.test(s)) return "Dijemput kurir";
  if (/pending|menunggu/.test(s)) return "Menunggu kurir";
  if (/cancelled|batal/.test(s)) return "Dibatalkan";
  return status || "Diproses";
}

function Checkout({
  slug,
  items,
  total,
  company,
  whatsapp,
  onClose,
  onDone,
}: {
  slug: string;
  items: Array<{ id: string; qty: number }>;
  total: number;
  company: string;
  whatsapp: string;
  onClose: () => void;
  onDone: (r: StorefrontOrderResult) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [fulfillment, setFulfillment] = useState<"pickup" | "courier">("pickup");
  const [address, setAddress] = useState("");
  const [postal, setPostal] = useState("");
  const [options, setOptions] = useState<ShippingOption[]>([]);
  const [picked, setPicked] = useState<ShippingOption | null>(null);
  const [busy, setBusy] = useState<"quote" | "order" | "">("");
  const [err, setErr] = useState("");

  const shippingFee = fulfillment === "courier" ? picked?.price ?? 0 : 0;
  const grand = total + shippingFee;

  async function quote() {
    setBusy("quote");
    setErr("");
    setPicked(null);
    try {
      const r = await quoteStorefrontShipping(slug, items.map((i) => ({ id: i.id, qty: i.qty })), postal);
      setOptions(r.options);
      if (r.options.length === 0) setErr("Tidak ada layanan kurir untuk kode pos ini.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal cek ongkir.");
    } finally {
      setBusy("");
    }
  }

  async function submit() {
    setErr("");
    if (!name.trim() || digits(phone).length < 8) {
      setErr("Nama dan nomor HP wajib diisi.");
      return;
    }
    if (fulfillment === "courier" && (!address.trim() || !picked)) {
      setErr("Lengkapi alamat dan pilih layanan kurir.");
      return;
    }
    setBusy("order");
    try {
      const r = await createStorefrontOrder(slug, {
        customerName: name.trim(),
        phone: phone.trim(),
        note: note.trim() || undefined,
        fulfillment,
        ...(fulfillment === "courier"
          ? { address: address.trim(), postalCode: digits(postal), courierCode: picked!.courierCode, serviceCode: picked!.serviceCode }
          : {}),
        items: items.map((i) => ({ id: i.id, qty: i.qty })),
      });
      onDone(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal membuat pesanan.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="sf-modal" role="presentation" onClick={onClose}>
      <div className="sf-modal__panel sf-checkout" role="dialog" aria-modal="true" aria-labelledby="sf-checkout-title" onClick={(e) => e.stopPropagation()}>
        <div className="sf-modal__head">
          <strong id="sf-checkout-title">Checkout pesanan</strong>
          <button type="button" onClick={onClose} aria-label="Tutup">×</button>
        </div>
        <div className="sf-form">
          <div className="sf-form__grid">
            <label className="sf-field">
              Nama
              <input className="sf-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" />
            </label>
            <label className="sf-field">
              Nomor HP / WhatsApp
              <input className="sf-input" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} inputMode="tel" autoComplete="tel" placeholder="0812xxxxxxx" />
            </label>
          </div>
          <div className="sf-choice">
            <button type="button" className={fulfillment === "pickup" ? "is-on" : ""} onClick={() => setFulfillment("pickup")}><IconPackage size={15} /> Ambil di toko</button>
            <button type="button" className={fulfillment === "courier" ? "is-on" : ""} onClick={() => setFulfillment("courier")}><IconTruck size={15} /> Kirim kurir</button>
          </div>
          {fulfillment === "courier" && (
            <>
              <label className="sf-field">
                Alamat lengkap
                <textarea className="sf-input" rows={3} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />
              </label>
              <div className="sf-inline">
                <label className="sf-field">
                  Kode pos
                  <input className="sf-input" value={postal} onChange={(e) => setPostal(e.target.value)} maxLength={5} inputMode="numeric" />
                </label>
                <button type="button" className="sf-btn sf-btn--ghost" onClick={() => void quote()} disabled={busy !== "" || digits(postal).length !== 5}>
                  {busy === "quote" ? "Mengecek…" : "Cek ongkir"}
                </button>
              </div>
              {options.length > 0 && (
                <div className="sf-ship-options">
                  {options.map((o) => (
                    <label key={`${o.courierCode}-${o.serviceCode}`} className={`sf-ship${picked?.serviceCode === o.serviceCode && picked?.courierCode === o.courierCode ? " is-on" : ""}`}>
                      <input type="radio" name="ship" checked={picked?.serviceCode === o.serviceCode && picked?.courierCode === o.courierCode} onChange={() => setPicked(o)} />
                      <span><strong>{o.courierName} {o.serviceName}</strong><small>{o.duration || "estimasi menyusul"}</small></span>
                      <strong>{rp(o.price)}</strong>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
          <label className="sf-field">
            Catatan (opsional)
            <textarea className="sf-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Contoh: tolong dibungkus rapi" />
          </label>
          {err && <p className="sf-error" role="alert">{err}</p>}
          <div className="sf-checkout__total">
            <span>Subtotal <strong>{rp(total)}</strong></span>
            {fulfillment === "courier" && <span>Ongkir <strong>{picked ? rp(picked.price) : "—"}</strong></span>}
            <span className="sf-checkout__grand">Total <strong>{rp(grand)}</strong></span>
          </div>
          <button type="button" className="sf-btn sf-btn--block" onClick={() => void submit()} disabled={busy !== ""}>
            {busy === "order" ? "Membuat pesanan…" : "Buat pesanan"}
          </button>
          {whatsapp && <p className="sf-note">Butuh bantuan? <a href={waLink(whatsapp, `Halo ${company}, saya butuh bantuan checkout.`)} target="_blank" rel="noopener noreferrer">Chat WhatsApp</a></p>}
        </div>
      </div>
    </div>
  );
}

function OrderPanel({
  slug,
  order,
  status,
  whatsapp,
  company,
  onClose,
}: {
  slug: string;
  order: StorefrontOrderResult;
  status: PublicOrderStatus | null;
  whatsapp: string;
  company: string;
  onClose: () => void;
}) {
  const base = storefrontBasePath(slug);
  const current = status ?? {
    orderId: order.orderId,
    status: "pending" as const,
    total: order.total,
    itemsSubtotal: order.itemsSubtotal,
    shippingFee: order.shippingFee,
    items: order.items,
    fulfillment: order.fulfillment,
    shipping: order.shipping,
    qrUrl: order.qrUrl,
    expiresAt: order.expiresAt,
    createdAt: new Date().toISOString(),
    customerName: "",
  };
  const paid = current.status === "paid";
  const failed = current.status === "failed";
  return (
    <div className="sf-modal" role="presentation" onClick={onClose}>
      <div className="sf-modal__panel sf-order" role="dialog" aria-modal="true" aria-labelledby="sf-order-title" onClick={(e) => e.stopPropagation()}>
        <div className="sf-modal__head">
          <strong id="sf-order-title">Pesanan dibuat</strong>
          <button type="button" onClick={onClose} aria-label="Tutup">×</button>
        </div>
        <div className="sf-order__body">
          <span className={`sf-status ${paid ? "is-paid" : failed ? "is-failed" : ""}`}>
            {paid ? "Pembayaran diterima" : failed ? "Pembayaran gagal" : "Menunggu pembayaran"}
          </span>
          <p className="sf-order__id">#{current.orderId.replace("shop-", "")}</p>
          {paid && <div className="sf-order__ok"><IconCheck size={20} /> Terima kasih, pesanan Anda sudah kami terima.</div>}
          {!paid && !failed && current.qrUrl && (
            <>
              <p className="sf-note">Scan QRIS berikut untuk membayar. Status halaman ini diperbarui otomatis.</p>
              <img className="sf-qr" src={current.qrUrl} alt="QRIS pembayaran" />
            </>
          )}
          {!paid && !failed && !current.qrUrl && (
            <p className="sf-order__note">Pesanan sudah diterima. Admin toko akan menghubungi Anda untuk pembayaran/konfirmasi.</p>
          )}
          <ul className="sf-order__items">
            {current.items.map((i, idx) => (
              <li key={`${i.name}-${idx}`}><span>{i.name} ×{i.qty}</span><strong>{rp(i.price * i.qty)}</strong></li>
            ))}
          </ul>
          <div className="sf-order__total"><span>Total</span><strong>{rp(current.total)}</strong></div>
          <a className="sf-btn sf-btn--ghost sf-btn--block" href={`${base}/lacak`}><IconTruck size={16} /> Lacak pesanan</a>
          {whatsapp && (
            <a className="sf-btn sf-btn--wa sf-btn--block" href={waLink(whatsapp, `Halo ${company}, saya baru membuat pesanan #${current.orderId.replace("shop-", "")}.`)} target="_blank" rel="noopener noreferrer">
              <IconWhatsApp size={16} /> Hubungi toko
            </a>
          )}
          <p className="sf-note">Simpan halaman ini atau hubungi toko jika ada pertanyaan.</p>
        </div>
      </div>
    </div>
  );
}
