import { useEffect, useState } from "react";
import {
  getMe,
  getShippingSettings,
  putShippingSettings,
  searchShippingAreas,
  type ShippingArea,
  type ShippingOrigin,
} from "../api";
import { AppHeader } from "../ui";
import { IconCheck, IconPackage, IconSearch } from "../icons";

export function Toko() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [origin, setOrigin] = useState<ShippingOrigin | null>(null);
  const [biteshipReady, setBiteshipReady] = useState(false);
  const [biteshipMode, setBiteshipMode] = useState<"off" | "test" | "live">("off");
  const [areaQ, setAreaQ] = useState("");
  const [areaResults, setAreaResults] = useState<ShippingArea[]>([]);
  const [areaSearched, setAreaSearched] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void getMe().then((m) => {
      setMe(m);
      if (!m) return;
      void getShippingSettings()
        .then((r) => {
          setOrigin(r.origin);
          setBiteshipReady(r.biteshipReady);
          setBiteshipMode(r.biteshipMode);
        })
        .catch(() => setErr("Gagal memuat pengaturan pengiriman."));
    });
  }, []);
  useEffect(() => {
    if (me === null) window.location.href = "/login";
  }, [me]);

  async function findArea() {
    setBusy("area");
    setErr("");
    try {
      const rows = await searchShippingAreas(areaQ.trim());
      setAreaResults(rows);
      setAreaSearched(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal mencari kode pos.");
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!origin) return;
    setBusy("save");
    setErr("");
    setMsg("");
    try {
      const r = await putShippingSettings(origin);
      setOrigin(r.origin);
      setBiteshipReady(r.biteshipReady);
      setBiteshipMode(r.biteshipMode);
      setMsg("Pengaturan pengiriman disimpan.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan pengaturan pengiriman.");
    } finally {
      setBusy("");
    }
  }

  if (me === undefined || me === null) return null;

  return (
    <div className="app">
      <AppHeader me={me} />
      <main className="page page--narrow">
        <header className="wa-head">
          <div>
            <h1>Akun Toko</h1>
            <p className="page__sub">Asal pengiriman &amp; koneksi kurir</p>
          </div>
        </header>

        {err && (
          <p className="banner banner--err" role="alert">
            {err}
          </p>
        )}
        {msg && (
          <p className="banner banner--ok" role="status">
            {msg}
          </p>
        )}

        <section className="card">
          <div className="wa-card-head">
            <span className={`wa-icon${biteshipReady ? " is-ok" : ""}`}>
              <IconPackage size={18} />
            </span>
            <div className="wa-card-title">
              <strong>Pengaturan Pengiriman</strong>
              <span className="meta">Alamat gudang asal &amp; kurir Biteship</span>
            </div>
          </div>

          {!biteshipReady && (
            <p className="banner banner--err" role="status">
              BITESHIP_API_KEY belum diatur — cek ongkir &amp; order kurir tidak aktif.
            </p>
          )}
          {biteshipReady && biteshipMode === "live" && (
            <p className="meta" style={{ margin: 0 }}>
              Mode <strong>Live (biteship_live)</strong> — order dikirim nyata.
            </p>
          )}

          {origin ? (
            <>
              <div className="orders-acc">
                <label className="orders-field">
                  <span>Nama kontak</span>
                  <input
                    className="input"
                    value={origin.contactName}
                    onChange={(e) => setOrigin({ ...origin, contactName: e.target.value })}
                    placeholder="Nama penanggung jawab gudang"
                  />
                </label>
                <label className="orders-field">
                  <span>No. HP</span>
                  <input
                    className="input"
                    value={origin.phone}
                    onChange={(e) => setOrigin({ ...origin, phone: e.target.value })}
                    placeholder="08xxxxxxxxxx"
                    inputMode="tel"
                  />
                </label>
                <label className="orders-field">
                  <span>Nama toko/organisasi</span>
                  <input
                    className="input"
                    value={origin.organization}
                    onChange={(e) => setOrigin({ ...origin, organization: e.target.value })}
                    placeholder="Nama toko"
                  />
                </label>
                <label className="orders-field">
                  <span>Alamat lengkap gudang</span>
                  <textarea
                    className="input"
                    rows={2}
                    value={origin.address}
                    onChange={(e) => setOrigin({ ...origin, address: e.target.value })}
                    placeholder="Jalan, nomor, kelurahan, kecamatan, kota"
                  />
                </label>
                {/* Pencarian kecamatan ditempatkan sebelum kode pos. */}
                <form
                  className="orders-search orders-search--sm"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void findArea();
                  }}
                >
                  <IconSearch size={15} />
                  <input
                    className="input"
                    value={areaQ}
                    onChange={(e) => {
                      setAreaQ(e.target.value);
                      setAreaSearched(false);
                      if (!e.target.value.trim()) setAreaResults([]);
                    }}
                    placeholder="Cari kecamatan / kode pos"
                    aria-label="Cari kecamatan atau kode pos"
                  />
                  <button
                    type="submit"
                    className="btn btn--2 btn--sm"
                    disabled={busy !== "" || !areaQ.trim()}
                  >
                    {busy === "area" ? "Mencari…" : "Cari"}
                  </button>
                </form>
                {areaSearched && !busy && !err && areaResults.length === 0 && (
                  <p className="meta" role="status" style={{ margin: 0 }}>
                    Area tidak ditemukan.
                  </p>
                )}
                {areaResults.length > 0 && (
                  <ul className="orders-cust__list" role="list">
                    {areaResults.map((ar) => (
                      <li key={`${ar.id}-${ar.postalCode}`}>
                        <button
                          type="button"
                          className="orders-cust__pick"
                          onClick={() => {
                            setOrigin({ ...origin, postalCode: ar.postalCode });
                            setAreaQ(ar.name);
                            setAreaResults([]);
                            setAreaSearched(false);
                          }}
                        >
                          {ar.name}
                          <span className="meta">{ar.postalCode}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <label className="orders-field">
                  <span>Kode pos</span>
                  <input
                    className="input"
                    value={origin.postalCode}
                    onChange={(e) => setOrigin({ ...origin, postalCode: e.target.value.replace(/\D/g, "").slice(0, 5) })}
                    placeholder="5 digit"
                    inputMode="numeric"
                  />
                </label>
              </div>
              <div className="orders-actions">
                <button type="button" className="btn btn--primary btn--block" onClick={() => void save()} disabled={busy !== ""}>
                  {busy === "save" ? <span className="spinner" aria-hidden="true" /> : <IconCheck size={15} />}
                  Simpan
                </button>
              </div>
            </>
          ) : (
            <p className="empty" style={{ padding: "1rem 0" }}>
              Memuat…
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
