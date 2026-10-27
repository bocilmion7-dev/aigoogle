import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Pagar kegagalan untuk halaman yang dimuat terpisah (code-split).
 *
 * Kasus nyata: tab lama / HTML yang masih tersimpan menunjuk chunk
 * `Halaman-xxxx.js` yang sudah hilang setelah deploy (`rsync --delete`).
 * Tanpa pagar ini React melempar error saat import → layar kosong tanpa
 * penjelasan, dan "refresh" oleh pengguna bisa mengulang hal yang sama.
 *
 * Perilaku:
 *  - chunk gagal diunduh  → muat ulang SEKALI otomatis (ambil HTML + chunk baru)
 *  - gagal lagi / error lain → tampilkan pesan + tombol "Muat ulang"
 */
interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

function isChunkLoadError(e: Error): boolean {
  const m = `${e.name} ${e.message}`;
  return /ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
    m
  );
}

export class PageBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[page] gagal dimuat:", error.message, info.componentStack?.slice(0, 300));
    if (!isChunkLoadError(error)) return;
    // Offline: memuat ulang hanya akan gagal lagi — biarkan pesan tampil.
    if (navigator.onLine === false) return;
    // Satu kali saja per menit — mencegah loop bila server memang sedang bermasalah.
    try {
      const last = Number(sessionStorage.getItem("aigoogle:chunk-reload") ?? 0);
      if (Date.now() - last < 60_000) return;
      sessionStorage.setItem("aigoogle:chunk-reload", String(Date.now()));
    } catch {
      /* sessionStorage bisa diblokir — tetap coba sekali */
    }
    const url = new URL(window.location.href);
    url.searchParams.set("_r", String(Date.now() % 100000));
    window.location.replace(url.toString());
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return (
      <div className="app">
        <main className="page page--narrow">
          <div className="card" role="alert">
            <strong className="card__title">
              {offline ? "Tidak ada koneksi internet" : "Halaman gagal dimuat"}
            </strong>
            <p style={{ margin: 0 }}>
              {offline
                ? "Sambungkan internet lalu muat ulang halaman ini."
                : "Versi aplikasi baru saja diperbarui. Muat ulang untuk mengambil versi terbaru."}
            </p>
            <div className="btn-row" style={{ marginTop: "var(--space-s)" }}>
              <button type="button" className="btn" onClick={() => window.location.reload()}>
                Muat ulang
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }
}
