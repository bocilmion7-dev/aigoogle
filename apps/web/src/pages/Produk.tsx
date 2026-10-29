import { useEffect, useMemo, useRef, useState } from "react";
import { getMe } from "../api";
import { AppHeader, PageLoader } from "../ui";
import { IconCpu, IconPackage, IconRefresh, IconSearch } from "../icons";
import { aiStorefrontDescriptionBulk, getStorefrontProducts, syncStorefrontProducts, type StorefrontProductRow } from "../storefront-api";

const rp = (n: number | null) => (n === null ? "—" : `Rp${Math.round(n).toLocaleString("id-ID")}`);
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

export function Produk() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [products, setProducts] = useState<StorefrontProductRow[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkScope, setBulkScope] = useState<"empty" | "all">("empty");
  const [bulkTone, setBulkTone] = useState<"menjual" | "informatif" | "ringkas">("menjual");
  const [bulkKeywords, setBulkKeywords] = useState("");
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkStop, setBulkStop] = useState(false);
  const [bulkStats, setBulkStats] = useState({ total: 0, processed: 0, updated: 0, failed: 0 });
  const [bulkCurrent, setBulkCurrent] = useState("");
  const [bulkErr, setBulkErr] = useState("");
  const [bulkMsg, setBulkMsg] = useState("");
  const stopRef = useRef(false);

  useEffect(() => {
    void getMe().then(setMe);
  }, []);
  useEffect(() => {
    if (me === null) window.location.href = "/login";
    else if (me && !me.permissions?.includes("app:users.manage")) window.location.replace("/app");
  }, [me]);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const r = await getStorefrontProducts();
      setProducts(r.products);
      setSyncedAt(r.syncedAt);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal memuat produk.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!me || !me.permissions?.includes("app:users.manage")) return;
    void load();
  }, [me]);

  async function sync() {
    setSyncing(true);
    setErr("");
    setMsg("");
    try {
      const r = await syncStorefrontProducts();
      setSyncedAt(r.syncedAt);
      setMsg(
        `Sinkron selesai: ${r.scanned} produk dipindai, ${r.created} baru, ${r.updated} diperbarui` +
          (r.truncated ? ` (dibatasi ${r.scanned} dari ${r.total}).` : ".")
      );
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal sinkron dari Accurate.");
    } finally {
      setSyncing(false);
    }
  }

  async function runBulkDescription() {
    if (bulkRunning || products.length === 0) return;
    setBulkRunning(true);
    setBulkStop(false);
    stopRef.current = false;
    setBulkErr("");
    setBulkMsg("");
    setBulkCurrent("");
    setBulkStats({ total: 0, processed: 0, updated: 0, failed: 0 });
    let after: string | null = null;
    let done = false;
    let stats = { total: 0, processed: 0, updated: 0, failed: 0 };
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      while (!done && !stopRef.current) {
        const body = {
          scope: bulkScope,
          tone: bulkTone,
          keywords: bulkKeywords.trim() || undefined,
          ...(after ? { after } : {}),
          limit: 1,
        } as const;
        let r;
        try {
          r = await aiStorefrontDescriptionBulk(body);
        } catch (e) {
          if (stopRef.current) break;
          // Satu retry untuk fetch/putus koneksi; prosesnya tetap per produk.
          await wait(1_500);
          r = await aiStorefrontDescriptionBulk(body);
        }
        stats = {
          total: stats.total || r.total,
          processed: stats.processed + r.processed,
          updated: stats.updated + r.updated,
          failed: stats.failed + r.failed,
        };
        setBulkStats(stats);
        setBulkCurrent(r.results?.[0]?.title ?? "");
        after = r.nextCursor;
        done = r.done;
        if (r.processed === 0) break;
        if (!done) await wait(1_100);
      }
      setBulkCurrent("");
      setBulkMsg(
        stopRef.current
          ? `Dihentikan. ${stats.updated} deskripsi berhasil dibuat.`
          : `Selesai. ${stats.updated} deskripsi dibuat${stats.failed ? `, ${stats.failed} gagal` : ""}.`
      );
      await load();
    } catch (e) {
      setBulkErr(e instanceof Error ? e.message : "Gagal generate deskripsi massal.");
    } finally {
      setBulkRunning(false);
      setBulkStop(false);
      stopRef.current = false;
    }
  }

  function requestStopBulk() {
    stopRef.current = true;
    setBulkStop(true);
  }

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return products;
    return products.filter((p) =>
      [p.title, p.name, p.itemNo, p.category].some((v) => v.toLowerCase().includes(query))
    );
  }, [products, q]);

  const noPrice = products.filter((p) => p.active && !(Number(p.price) > 0)).length;

  if (me === undefined || me === null || !me.permissions?.includes("app:users.manage")) return <PageLoader />;

  return (
    <div className="app">
      <AppHeader me={me} />
      <main className="page page--narrow">
        <header className="wa-head sf-prod-head">
          <div>
            <h1>Produk Storefront</h1>
            <p className="page__sub">Data Accurate + gambar, deskripsi, dan pengaturan tampilan</p>
          </div>
          <div className="btn-row sf-prod-actions">
            <button type="button" className="btn btn--2" onClick={() => setBulkOpen(true)} disabled={syncing || products.length === 0 || bulkRunning}>
              <IconCpu size={15} /> AI deskripsi semua
            </button>
            <button type="button" className="btn" onClick={() => void sync()} disabled={syncing || bulkRunning}>
              {syncing ? <span className="spinner" aria-hidden="true" /> : <IconRefresh size={15} />}
              {syncing ? "Menyinkronkan…" : "Sinkron Produk"}
            </button>
          </div>
        </header>

        {err && <p className="banner banner--err" role="alert">{err}</p>}
        {msg && <p className="banner banner--ok" role="status">{msg}</p>}

        <section className="sf-prod-summary">
          <div className="sf-stat"><span className="meta">Total</span><strong>{products.length}</strong></div>
          <div className="sf-stat"><span className="meta">Aktif</span><strong>{products.filter((p) => p.active).length}</strong></div>
          <div className="sf-stat"><span className="meta">Unggulan</span><strong>{products.filter((p) => p.featured).length}</strong></div>
          <div className="sf-stat"><span className="meta">Harga belum ada</span><strong>{noPrice}</strong></div>
          <div className="sf-stat sf-stat--wide">
            <span className="meta">Sinkron terakhir</span>
            <strong>{syncedAt ? new Date(syncedAt).toLocaleString("id-ID") : "Belum pernah"}</strong>
          </div>
        </section>

        <div className="orders-search sf-prod-search">
          <IconSearch size={16} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama, kode barang, atau kategori…" aria-label="Cari produk" />
        </div>

        {loading ? (
          <PageLoader />
        ) : products.length === 0 ? (
          <div className="card orders-empty">
            <IconPackage size={30} />
            <strong>Belum ada produk</strong>
            <p className="meta" style={{ margin: 0 }}>
              Sinkronkan dulu dari Accurate. Semua barang Accurate akan masuk ke sini tanpa menghapus data pelengkap.
            </p>
            <button type="button" className="btn" onClick={() => void sync()} disabled={syncing}>
              {syncing ? <span className="spinner" aria-hidden="true" /> : <IconRefresh size={15} />} Sinkron Produk
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card orders-empty">
            <strong>Tidak ada produk yang cocok</strong>
            <p className="meta" style={{ margin: 0 }}>Coba kata kunci lain.</p>
          </div>
        ) : (
          <ul className="sf-prod-grid" role="list">
            {filtered.map((p) => {
              const name = p.title || p.name;
              return (
                <li key={p.id}>
                  <a className="sf-prod-card" href={`/produk/${p.id}`}>
                    <span className="sf-prod-card__media">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="sf-prod-card__ph">{initials(name)}</span>
                      )}
                      {p.featured && <span className="sf-prod-card__star">Unggulan</span>}
                      {!p.active && <span className="sf-prod-card__off">Nonaktif</span>}
                    </span>
                    <span className="sf-prod-card__body">
                      <strong>{name}</strong>
                      <span className="meta">{p.itemNo}{p.category ? ` · ${p.category}` : ""}</span>
                      <span className="sf-prod-card__foot">
                        <strong>{rp(p.price)}</strong>
                        <span className="meta">Stok {p.stock === null ? "—" : p.stock}</span>
                      </span>
                      {!(Number(p.price) > 0) && <span className="sf-bad">Harga belum tersedia — sinkron ulang.</span>}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </main>


      {bulkOpen && (
        <div className="modal-overlay" role="presentation" onClick={() => !bulkRunning && setBulkOpen(false)}>
          <div className="modal sf-bulk-modal" role="dialog" aria-modal="true" aria-labelledby="sf-bulk-title" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <IconCpu size={18} />
              <strong className="card__title" id="sf-bulk-title">Generate deskripsi AI</strong>
              <button type="button" className="modal__x" onClick={() => setBulkOpen(false)} aria-label="Tutup" disabled={bulkRunning}>×</button>
            </div>
            <div className="sf-bulk-body">
              <p className="meta" style={{ margin: 0 }}>
                AI akan membuat deskripsi untuk semua produk yang dipilih, satu per satu secara otomatis.
                Proses memakai saldo token AI perusahaan.
              </p>
              <div className="sf-mode">
                <button type="button" className={`sf-mode__opt${bulkScope === "empty" ? " is-on" : ""}`} onClick={() => setBulkScope("empty")} disabled={bulkRunning}>
                  <strong>Hanya yang kosong</strong>
                  <span>{products.filter((p) => !p.description.trim()).length} produk belum punya deskripsi</span>
                </button>
                <button type="button" className={`sf-mode__opt${bulkScope === "all" ? " is-on" : ""}`} onClick={() => setBulkScope("all")} disabled={bulkRunning}>
                  <strong>Semua produk</strong>
                  <span>Timpa {products.length} deskripsi yang ada</span>
                </button>
              </div>
              {bulkScope === "all" && (
                <p className="banner banner--err" role="status" style={{ margin: 0 }}>
                  Mode ini akan menimpa deskripsi yang sudah Anda edit manual.
                </p>
              )}
              <div className="sf-bulk-fields">
                <label className="field">
                  Gaya bahasa
                  <select className="select" value={bulkTone} onChange={(e) => setBulkTone(e.target.value as typeof bulkTone)} disabled={bulkRunning}>
                    <option value="menjual">Menjual</option>
                    <option value="informatif">Informatif</option>
                    <option value="ringkas">Ringkas</option>
                  </select>
                </label>
                <label className="field">
                  Kata kunci tambahan (opsional)
                  <input className="input" value={bulkKeywords} onChange={(e) => setBulkKeywords(e.target.value)} maxLength={200} placeholder="Berlaku untuk semua produk" disabled={bulkRunning} />
                </label>
              </div>

              {(bulkRunning || bulkStats.processed > 0) && (
                <div className="sf-bulk-progress">
                  <div className="sf-bulk-progress__top">
                    <strong>{bulkRunning ? "Memproses…" : "Selesai"}</strong>
                    <span>{bulkStats.processed}/{bulkStats.total || products.length}</span>
                  </div>
                  <div className="sf-bulk-bar"><span style={{ width: `${Math.min(100, bulkStats.total ? (bulkStats.processed / bulkStats.total) * 100 : 0)}%` }} /></div>
                  {bulkCurrent && <p className="sf-bulk-current"><span className="spinner spinner--tiny" aria-hidden="true" /> Memproses: {bulkCurrent}</p>}
                  <div className="sf-bulk-stats">
                    <span>Berhasil <strong>{bulkStats.updated}</strong></span>
                    <span>Gagal <strong>{bulkStats.failed}</strong></span>
                    <span>Diproses <strong>{bulkStats.processed}</strong></span>
                  </div>
                </div>
              )}
              {bulkErr && <p className="banner banner--err" role="alert">{bulkErr}</p>}
              {bulkMsg && <p className="banner banner--ok" role="status">{bulkMsg}</p>}
            </div>
            <div className="modal__foot">
              <button type="button" className="btn btn--ghost" onClick={() => setBulkOpen(false)} disabled={bulkRunning}>
                Tutup
              </button>
              {bulkRunning ? (
                <button type="button" className="btn btn--2" onClick={requestStopBulk} disabled={bulkStop}>
                  {bulkStop ? "Menghentikan…" : "Hentikan setelah batch ini"}
                </button>
              ) : (
                <button type="button" className="btn" onClick={() => void runBulkDescription()} disabled={products.length === 0}>
                  <IconCpu size={16} /> Mulai generate
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
