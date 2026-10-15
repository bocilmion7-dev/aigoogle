import { useEffect, useState } from "react";
import type { AiModuleKey, AiModuleModelRow, Me } from "@aigoogle/shared";
import { getAiModuleModels, getMe, putAiModuleModels } from "../api";
import { AppHeader, PageLoader } from "../ui";

/**
 * Pilih model AI per modul (global). Sumber model = provider aktif di /ai.
 * Nilai kosong = otomatis (rank-1 provider + failover).
 */
export function AiModels() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [providerName, setProviderName] = useState("");
  const [available, setAvailable] = useState<Array<{ name: string; rank: number }>>([]);
  const [modules, setModules] = useState<AiModuleModelRow[] | null>(null);
  const [dirty, setDirty] = useState<Partial<Record<AiModuleKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    void getMe().then(setMe);
  }, []);

  const canAi = !!me?.permissions?.includes("app:settings.manage");

  useEffect(() => {
    if (!canAi) return;
    void (async () => {
      try {
        const res = await getAiModuleModels();
        setProviderName(res.providerName);
        setAvailable(res.available);
        setModules(res.modules);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Gagal memuat pengaturan model.");
      }
    })();
  }, [canAi]);

  function valueOf(m: AiModuleModelRow): string {
    return dirty[m.key] !== undefined ? dirty[m.key]! : m.value;
  }

  async function simpan() {
    setErr("");
    setOk("");
    setBusy(true);
    try {
      await putAiModuleModels(dirty);
      const res = await getAiModuleModels();
      setProviderName(res.providerName);
      setAvailable(res.available);
      setModules(res.modules);
      setDirty({});
      setOk("Tersimpan.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setBusy(false);
    }
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

  if (!canAi) {
    return (
      <div className="app">
        <AppHeader me={me} />
        <main className="page page--narrow">
          <h1>Model per Modul</h1>
          <div className="card">
            <strong>Anda tidak punya akses menu ini.</strong>
            <p className="meta" style={{ marginTop: 6, marginBottom: 0 }}>
              Menu ini hanya untuk Admin Platform. Hubungi administrator sistem Anda.
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
        <h1>Model per Modul</h1>
        <p className="page__sub">
          Setiap modul AI bisa memakai model berbeda. Sumber model = provider aktif
          {providerName ? ` (${providerName})` : ""} di halaman{" "}
          <a href="/ai">AI Provider</a>. Pilih <strong>Otomatis</strong> untuk memakai
          rank-1 + failover.
        </p>

        {ok && (
          <p className="banner banner--ok" role="status">
            {ok}
          </p>
        )}
        {err && (
          <p className="banner banner--err" role="alert">
            {err}
          </p>
        )}

        {modules === null ? (
          <div className="card">
            <PageLoader />
          </div>
        ) : available.length === 0 ? (
          <div className="card">
            <strong>Belum ada model tersedia.</strong>
            <p className="meta" style={{ marginTop: 6, marginBottom: 0 }}>
              Aktifkan provider &amp; centang minimal satu model di{" "}
              <a href="/ai">AI Provider</a> terlebih dahulu.
            </p>
          </div>
        ) : (
          <section className="card">
            <strong className="card__title">Pilihan model</strong>
            <div className="stack" style={{ gap: "var(--space-s)" }}>
              {modules.map((m) => (
                <label className="field" key={m.key} style={{ maxWidth: 520 }}>
                  {m.label}
                  <select
                    className="select"
                    value={valueOf(m)}
                    disabled={busy}
                    onChange={(e) => setDirty((prev) => ({ ...prev, [m.key]: e.target.value }))}
                  >
                    <option value="">Otomatis (rank-1 + failover)</option>
                    {available.map((a) => (
                      <option key={a.name} value={a.name}>
                        {a.name}
                        {a.rank === 0 ? "  (utama)" : ""}
                      </option>
                    ))}
                  </select>
                  <span className="meta" style={{ fontWeight: 400 }}>
                    {m.hint}
                  </span>
                </label>
              ))}
            </div>

            <div className="btn-row" style={{ marginTop: "var(--space-s)" }}>
              <button className="btn" disabled={busy || Object.keys(dirty).length === 0} onClick={() => void simpan()}>
                {busy ? "Menyimpan…" : "Simpan"}
              </button>
              {Object.keys(dirty).length > 0 && (
                <button className="btn btn--ghost" disabled={busy} onClick={() => setDirty({})}>
                  Batalkan perubahan
                </button>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
