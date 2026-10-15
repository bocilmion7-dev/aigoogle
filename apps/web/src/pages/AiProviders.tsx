import { useCallback, useEffect, useState } from "react";
import type { AiProviderRow } from "@aigoogle/shared";
import {
  activateAiProvider,
  createAiProvider,
  deleteAiProvider,
  getAiProviders,
  getMe,
  previewAiModels,
  refreshAiModels,
  updateAiProvider,
} from "../api";
import { AppHeader, PageLoader } from "../ui";

interface Editing {
  id?: string;
  name: string;
  baseUrl: string;
  /** "" saat edit = biarkan API key lama (tidak dikirim saat simpan) */
  apiKey: string;
}

/** Kelola provider AI (OpenAI-compatible) dari DB — khusus Admin Platform. */
export function AiProviders() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [list, setList] = useState<AiProviderRow[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [availModels, setAvailModels] = useState<string[] | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    void getMe().then(setMe);
  }, []);

  const canAi = !!me?.permissions?.includes("app:settings.manage");

  const load = useCallback(async () => {
    try {
      setList(await getAiProviders());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal memuat daftar provider.");
    }
  }, []);

  useEffect(() => {
    if (!canAi) return;
    void load();
  }, [canAi, load]);

  function tutupForm() {
    setEditing(null);
    setAvailModels(null);
    setChecked([]);
  }

  function mulaiTambah() {
    setErr("");
    setOk("");
    setEditing({ name: "", baseUrl: "", apiKey: "" });
    setAvailModels(null);
    setChecked([]);
  }

  function mulaiEdit(p: AiProviderRow) {
    setErr("");
    setOk("");
    setEditing({ id: p.id, name: p.name, baseUrl: p.baseUrl, apiKey: "" });
    setAvailModels(p.models.map((m) => m.name));
    setChecked(p.models.map((m) => m.name));
  }

  /** Ambil daftar model dari upstream: preview (baru) atau refresh (edit). */
  async function muatModel() {
    if (!editing) return;
    setErr("");
    setOk("");
    setBusy(true);
    try {
      const res = editing.id
        ? await refreshAiModels(editing.id)
        : await previewAiModels(editing.baseUrl.trim(), editing.apiKey);
      const models = res.models;
      setAvailModels(models);
      setChecked((prev) => prev.filter((m) => models.includes(m)));
      if (!models.length) setErr("Provider tidak mengembalikan daftar model.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal memuat model.");
    } finally {
      setBusy(false);
    }
  }

  async function simpan() {
    if (!editing) return;
    const name = editing.name.trim();
    const baseUrl = editing.baseUrl.trim();
    if (!name) return setErr("Nama provider wajib diisi.");
    if (!baseUrl) return setErr("Base URL wajib diisi.");
    if (!editing.id && !editing.apiKey) return setErr("API key wajib diisi untuk provider baru.");
    setErr("");
    setOk("");
    setBusy(true);
    try {
      if (editing.id) {
        await updateAiProvider(editing.id, {
          name,
          baseUrl,
          ...(editing.apiKey ? { apiKey: editing.apiKey } : {}),
          models: checked,
        });
      } else {
        await createAiProvider({ name, baseUrl, apiKey: editing.apiKey, models: checked });
      }
      tutupForm();
      await load();
      setOk("Tersimpan.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan provider.");
    } finally {
      setBusy(false);
    }
  }

  async function aktifkan(id: string) {
    setErr("");
    setOk("");
    setBusy(true);
    try {
      await activateAiProvider(id);
      await load();
      setOk("Provider aktif diperbarui.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal mengaktifkan provider.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function hapus(p: AiProviderRow) {
    if (!window.confirm(`Hapus provider "${p.name}"? Model tersimpan ikut terhapus.`)) return;
    setErr("");
    setOk("");
    setBusy(true);
    try {
      await deleteAiProvider(p.id);
      if (editing?.id === p.id) tutupForm();
      await load();
      setOk("Provider dihapus.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menghapus provider.");
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
          <h1>Provider AI</h1>
          <div className="card">
            <strong>Anda tidak punya akses menu Provider AI.</strong>
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
        <h1>Provider AI</h1>
        <p className="page__sub">
          Kelola provider AI (OpenAI-compatible) — tepat satu provider aktif dipakai untuk chat, scan, klasifikasi,
          dan dokumen.
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

        <section className="card">
          <strong className="card__title">Daftar provider</strong>
          {list === null ? (
            <p className="meta" style={{ margin: 0 }}>
              Memuat…
            </p>
          ) : list.length === 0 ? (
            <p className="meta" style={{ margin: 0 }}>
              Belum ada provider — tambah provider pertama.
            </p>
          ) : (
            <div className="prov-list">
              {list.map((p) => (
                <div key={p.id} className={`prov${p.isActive ? " prov--active" : ""}`}>
                  <div className="prov__head">
                    <span className="prov__status">
                      <span className="prov__dot" aria-hidden="true" />
                      {p.isActive ? "Aktif" : "Nonaktif"}
                    </span>
                    <span className="prov__name">{p.name}</span>
                    <div className="prov__actions">
                      {!p.isActive && (
                        <button
                          className="btn btn--ghost btn--sm"
                          disabled={busy}
                          onClick={() => void aktifkan(p.id)}
                        >
                          Jadikan aktif
                        </button>
                      )}
                      <button className="btn btn--2 btn--sm" disabled={busy} onClick={() => mulaiEdit(p)}>
                        Edit
                      </button>
                      <button className="btn btn--danger btn--sm" disabled={busy} onClick={() => void hapus(p)}>
                        Hapus
                      </button>
                    </div>
                  </div>

                  <div className="prov__meta">
                    <span className="prov__meta-item">
                      <span className="prov__meta-label">URL</span>
                      <span className="prov__meta-value">{p.baseUrl}</span>
                    </span>
                    <span className="prov__meta-item">
                      <span className="prov__meta-label">Key</span>
                      <span className="prov__meta-value">{p.apiKeyMasked || "—"}</span>
                    </span>
                    <span className="prov__meta-item">
                      <span className="prov__meta-label">Model</span>
                      <span className="prov__meta-value">{p.models.length}</span>
                    </span>
                  </div>

                  {p.models.length > 0 ? (
                    <div className="prov__models">
                      {p.models.map((m) => (
                        <span key={m.name} className="prov__model" title={m.name}>
                          {m.name}
                          {m.rank === 0 ? " ★" : ""}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="prov__none">Belum ada model tercentang.</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="btn-row" style={{ marginTop: "var(--space-s)" }}>
            <button className="btn" disabled={busy} onClick={mulaiTambah}>
              Tambah provider
            </button>
          </div>
        </section>

        {editing && (
          <section className="card">
            <strong className="card__title">{editing.id ? "Edit provider" : "Tambah provider"}</strong>

            <label className="field" style={{ maxWidth: 420 }}>
              Nama
              <input
                className="input"
                type="text"
                value={editing.name}
                placeholder="mis. 9Router, NVIDIA NIM"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </label>
            <label className="field" style={{ maxWidth: 560 }}>
              Base URL
              <input
                className="input"
                type="url"
                value={editing.baseUrl}
                placeholder="https://example.com/v1"
                onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
              />
            </label>
            <label className="field" style={{ maxWidth: 560 }}>
              API Key{editing.id ? " (kosongkan untuk mempertahankan yang lama)" : ""}
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={editing.apiKey}
                placeholder={editing.id ? "••••••••" : "tempel API key provider"}
                onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
              />
            </label>

            <div className="btn-row" style={{ marginTop: "var(--space-xs)" }}>
              <button className="btn btn--2" disabled={busy} onClick={() => void muatModel()}>
                {busy ? "Memuat…" : "Muat model"}
              </button>
              <span className="meta" style={{ margin: 0 }}>
                {editing.id
                  ? "Ambil daftar model terbaru dari provider, centang model yang dipakai."
                  : "Ambil daftar model dari Base URL + API key, lalu centang model yang dipakai."}
              </span>
            </div>

            {availModels !== null && (
              <>
                <strong className="card__title" style={{ marginTop: "var(--space-s)" }}>
                  Model ({checked.length}/{availModels.length} terpilih)
                </strong>
                {availModels.length === 0 ? (
                  <p className="meta" style={{ margin: 0 }}>
                    Tidak ada model yang dikembalikan provider.
                  </p>
                ) : (
                  <div className="prov__models" style={{ marginTop: 0 }}>
                    {availModels.map((m) => {
                      const on = checked.includes(m);
                      return (
                        <button
                          key={m}
                          type="button"
                          className="prov__model"
                          style={{
                            cursor: "pointer",
                            ...(on
                              ? {
                                  background: "var(--accent-tint)",
                                  borderColor: "rgb(234 88 12 / 0.3)",
                                  color: "var(--accent-strong)",
                                }
                              : {}),
                          }}
                          onClick={() =>
                            setChecked((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))
                          }
                        >
                          {on ? "✓ " : ""}
                          {m}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            <div className="btn-row" style={{ marginTop: "var(--space-s)" }}>
              <button className="btn" disabled={busy} onClick={() => void simpan()}>
                Simpan
              </button>
              <button className="btn btn--ghost" disabled={busy} onClick={tutupForm}>
                Batal
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
