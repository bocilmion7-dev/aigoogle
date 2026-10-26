import { useCallback, useEffect, useState } from "react";
import { IconPackage, IconRefresh } from "../icons";

interface TrackData {
  orderId: string;
  courier: string;
  waybillId: string;
  status: string;
  statusLabel: string;
  history: Array<{ note: string; status: string; updatedAt: string }>;
  updatedAt: string;
}

const when = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

/** Halaman lacak PUBLIK — dibuka dari link WhatsApp pembeli, tanpa login. */
export function Lacak({ orderId }: { orderId: string }) {
  const [data, setData] = useState<TrackData | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/public/track/${encodeURIComponent(orderId)}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) {
        setData(null);
        setErr("Pesanan tidak ditemukan. Pastikan link lacak yang dibuka benar.");
        return;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      setData((await res.json()) as TrackData);
    } catch {
      setErr("Gagal memuat status pengiriman. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = /delivered|diterima/i.test(data?.statusLabel ?? "");
  const history = data ? data.history.slice().reverse() : [];

  return (
    <div className="app">
      <main className="page page--narrow">
        <header style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", marginBottom: "var(--space-s)" }}>
          <IconPackage size={22} />
          <div>
            <h1 style={{ margin: 0 }}>Lacak Pesanan</h1>
            <p className="meta" style={{ margin: 0 }}>
              #{orderId.replace("shop-", "")}
            </p>
          </div>
        </header>

        {loading && !data ? (
          <div className="card" role="status">
            <span className="spinner" aria-hidden="true" /> Memuat status pengiriman…
          </div>
        ) : err ? (
          <div className="card">
            <strong>{err}</strong>
            <div className="btn-row" style={{ marginTop: "var(--space-s)" }}>
              <button type="button" className="btn btn--2 btn--sm" onClick={() => void load()}>
                <IconRefresh size={15} /> Coba lagi
              </button>
            </div>
          </div>
        ) : data ? (
          <section className="card">
            <div className="orders-acc__row">
              <span>Status</span>
              <span>
                <span className={`orders-badge ${done ? "is-selesai" : "is-lunas"}`}>{data.statusLabel || "Diproses"}</span>
              </span>
            </div>
            <div className="orders-acc__row">
              <span>Kurir</span>
              <span>{data.courier || "-"}</span>
            </div>
            <div className="orders-acc__row">
              <span>No. resi</span>
              <span>{data.waybillId || "menyusul dari kurir"}</span>
            </div>

            <h2 className="orders-acc__title" style={{ marginTop: "var(--space-s)" }}>
              Riwayat pengiriman
            </h2>
            {history.length === 0 ? (
              <p className="meta" style={{ margin: 0 }}>
                Belum ada riwayat dari kurir. Halaman ini diperbarui otomatis.
              </p>
            ) : (
              <ol className="orders-track">
                {history.map((h, i) => (
                  <li key={`${h.updatedAt}-${i}`}>
                    <strong>{h.note || h.status}</strong>
                    <span className="meta">
                      {h.status}
                      {h.updatedAt ? ` · ${when(h.updatedAt)}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            )}

            <div className="btn-row" style={{ marginTop: "var(--space-s)" }}>
              <button type="button" className="btn btn--2 btn--sm" onClick={() => void load()} disabled={loading}>
                {loading ? <span className="spinner" aria-hidden="true" /> : <IconRefresh size={15} />} Perbarui
              </button>
              <span className="meta">Diperbarui: {when(data.updatedAt)}</span>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
