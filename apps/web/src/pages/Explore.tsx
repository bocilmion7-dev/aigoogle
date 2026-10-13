import { useCallback, useEffect, useRef, useState } from "react";
import { getMe } from "../api";
import { AppHeader } from "../ui";
import {
  driveCancel,
  driveList,
  drivePlan,
  driveRun,
  driveStatus,
  driveUndo,
  type DriveFile,
  type DriveFolder,
  type DriveStatus,
  type PlanItem,
  type RunEvent,
  type UndoEvent,
} from "../drive-api";

interface Progress {
  done: number;
  total: number;
}

interface ResultItem {
  fileId: string;
  fileName: string;
  action: string;
  status: string;
  error?: string;
  originalParent?: string;
  undoStatus?: string;
  undoError?: string;
}

type Phase = "idle" | "planning" | "preview" | "running" | "done";

export function Explore() {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [canTidy, setCanTidy] = useState<boolean | null>(null);
  const [folderId, setFolderId] = useState("root");
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [trail, setTrail] = useState<Array<{ id: string; name: string }>>([{ id: "root", name: "Drive" }]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<ResultItem[] | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [undoSelected, setUndoSelected] = useState<Set<string>>(new Set());
  const [undoProgress, setUndoProgress] = useState<Progress | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const cancelRef = useRef(false);

  const errText = (code?: string) =>
    code === "belum_connect"
      ? "Belum terhubung ke Google Drive — hubungkan dulu di Pengaturan."
      : code === "tidak_punya_hak"
        ? "Anda tidak punya hak Rapikan Drive."
        : code === "di_luar_cakupan"
          ? "Folder di luar cakupan."
          : "Terjadi gangguan — coba lagi.";

  const load = useCallback(async (id: string) => {
    setError(null);
    try {
      const l = await driveList(id);
      setFolders(l.folders);
      setFiles(l.files);
    } catch (e) {
      setError(errText(e instanceof Error ? e.message : undefined));
      setFolders([]);
      setFiles([]);
    }
  }, []);

  useEffect(() => {
    void driveStatus().then(setStatus);
    void getMe()
      .then((me) => setCanTidy(!!me?.permissions?.includes("app:drive.tidy")))
      .catch(() => setCanTidy(false));
  }, []);

  useEffect(() => {
    if (status?.connected) void load(folderId);
  }, [status, folderId, load]);

  function enter(folder: DriveFolder) {
    setFolderId(folder.id);
    setTrail((t) => [...t, { id: folder.id, name: folder.name }]);
    setPhase("idle");
    setPlan(null);
    setResult(null);
  }

  function goto(i: number) {
    setFolderId(trail[i].id);
    setTrail(trail.slice(0, i + 1));
    setPhase("idle");
    setPlan(null);
    setResult(null);
  }

  async function makePlan() {
    setPhase("planning");
    setError(null);
    try {
      const p = await drivePlan(folderId);
      setJobId(p.jobId);
      setPlan(p.items);
      setPhase("preview");
    } catch (e) {
      setError(errText(e instanceof Error ? e.message : undefined));
      setPhase("idle");
    }
  }

  async function run() {
    if (!jobId) return;
    setPhase("running");
    setProgress(null);
    setResult(null);
    setCancelled(false);
    cancelRef.current = false;
    try {
      await driveRun(jobId, (e: RunEvent) => {
        if (e.type === "start") setProgress({ done: 0, total: e.total });
        if (e.type === "progress") setProgress({ done: e.done, total: e.total });
        if (e.type === "done") {
          const items = e.items as unknown as ResultItem[];
          setResult(items);
          setJobStatus("done");
          setUndoSelected(new Set(items.filter((i) => i.status === "ok").map((i) => i.fileId)));
          setUndoError(null);
          setUndoProgress(null);
          setPhase("done");
        }
        if (e.type === "cancelled") {
          setResult(e.items as unknown as ResultItem[]);
          setCancelled(true);
          setJobStatus("cancelled");
          setPhase("done");
        }
      });
    } catch {
      setError("Koneksi terputus — coba lagi.");
      setPhase("idle");
    } finally {
      void load(folderId);
    }
  }

  async function cancel() {
    if (!jobId) return;
    cancelRef.current = true;
    await driveCancel(jobId);
  }

  function toggleUndo(fileId: string) {
    setUndoSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }

  async function undo() {
    if (!jobId || !result) return;
    setUndoBusy(true);
    setUndoError(null);
    setUndoProgress(null);
    const ids = result.filter((r) => r.status === "ok" && undoSelected.has(r.fileId)).map((r) => r.fileId);
    try {
      await driveUndo(jobId, ids.length === result.filter((r) => r.status === "ok").length ? undefined : ids, (e: UndoEvent) => {
        if (e.type === "start") setUndoProgress({ done: 0, total: e.total });
        if (e.type === "progress") setUndoProgress({ done: e.done, total: e.total });
        if (e.type === "done") {
          const items = e.items as unknown as ResultItem[];
          const byId = new Map(items.map((i) => [i.fileId, i]));
          setResult(
            (result ?? []).map((r) => {
              const u = byId.get(r.fileId);
              if (!u) return r;
              return { ...r, undoStatus: u.status, undoError: u.error };
            })
          );
          setJobStatus(e.status);
        }
      });
      void load(folderId);
    } catch (err) {
      const code = err instanceof Error ? err.message : undefined;
      setUndoError(
        code === "already_undone"
          ? "Job ini sudah diurungkan."
          : code === "tidak_punya_hak"
            ? "Anda tidak punya hak Rapikan Drive."
            : code === "belum_connect"
              ? "Belum terhubung ke Google Drive."
              : "Gagal mengurungkan — coba lagi."
      );
    } finally {
      setUndoBusy(false);
    }
  }

  if (!status) {
    return (
      <div className="app">
        <AppHeader />
        <main className="page">
          <p className="meta">Memuat…</p>
        </main>
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div className="app">
        <AppHeader />
        <main className="page page--narrow">
          <h1>Explore Manager</h1>
          <div className="card">
            <strong className="card__title">Google Drive belum terhubung</strong>
            <p className="small muted" style={{ marginBottom: 8 }}>
              Hubungkan Google Drive untuk merapikan folder.
            </p>
            {status.engine === "google" && (
              <a className="btn" href="/api/oauth/google/start">
                Hubungkan Google Drive →
              </a>
            )}
          </div>
        </main>
      </div>
    );
  }

  const pdfCount = files.filter((f) => f.mimeType === "application/pdf").length;

  return (
    <div className="app">
      <AppHeader />
      <main className="page">
        <h1>Explore Manager</h1>
        <p className="page__sub">Telusuri Drive, rapikan PDF ke folder kategori — dengan pratinjau &amp; urungkan.</p>

        <div className="explore">
          <section>
            <nav aria-label="Breadcrumb" className="crumb">
              {trail.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && " / "}
                  <button onClick={() => goto(i)}>{t.name}</button>
                </span>
              ))}
            </nav>
            <div className="btn-row" style={{ marginBottom: "var(--space-xs)" }}>
              <button className="btn btn--2 btn--sm" onClick={() => void load(folderId)}>
                Refresh
              </button>
              {canTidy !== false && (
                <button
                  className="btn btn--sm"
                  onClick={() => void makePlan()}
                  disabled={phase === "planning" || phase === "running"}
                  aria-label="Rapikan folder ini"
                >
                  Rapikan Folder Ini
                </button>
              )}
              <span className="meta" style={{ marginLeft: "auto" }}>
                <span className="num">{pdfCount}</span> PDF
              </span>
            </div>
            {error && <p className="banner banner--err" role="alert">{error}</p>}
            <div className="panel">
              {folders.length === 0 && files.length === 0 && (
                <p className="empty" style={{ padding: "var(--space-m) 0" }}>
                  Tidak ada file untuk dirapikan.
                </p>
              )}
              <ul className="file-list">
                {folders.map((f) => (
                  <li key={f.id} className="file-row">
                    <button
                      className="btn btn--2 btn--sm"
                      style={{ flex: 1, justifyContent: "flex-start", textAlign: "left" }}
                      onClick={() => enter(f)}
                    >
                      <span aria-hidden="true">▸</span> {f.name}
                    </button>
                  </li>
                ))}
                {files.map((f) => (
                  <li key={f.id} className="file-row">
                    <span aria-hidden="true">{f.mimeType === "application/pdf" ? "PDF" : "file"}</span>
                    <span className="muted" style={{ flex: 1, minWidth: 0 }}>{f.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <aside className="stack">
            {phase === "planning" && (
              <div className="panel progress-line">Menganalisa isi PDF…</div>
            )}
            {phase === "preview" && plan && (
              <div className="panel">
                <strong className="card__title">Preview rencana</strong>
                <ul style={{ paddingLeft: 18, fontSize: "var(--step--1)", color: "var(--ink-2)", margin: 0 }}>
                  {plan
                    .filter((p) => p.action === "create_folder")
                    .map((p) => (
                      <li key={`c-${p.toName}`}>Buat folder “{p.toName}”</li>
                    ))}
                  {plan
                    .filter((p) => p.action === "move")
                    .map((p) => (
                      <li key={p.fileId}>
                        Pindah {p.fileName} → {p.category}
                      </li>
                    ))}
                </ul>
                {plan.filter((p) => p.action === "move").length === 0 && (
                  <p className="meta" style={{ marginBottom: 0 }}>
                    Tidak ada PDF untuk dirapikan.
                  </p>
                )}
                <div className="btn-row" style={{ marginTop: "var(--space-xs)" }}>
                  <button className="btn" onClick={() => void run()} disabled={plan.every((p) => p.action !== "move")}>
                    Jalankan
                  </button>
                  <button className="btn btn--2" onClick={() => setPhase("idle")}>
                    Batal
                  </button>
                </div>
              </div>
            )}
            {phase === "running" && (
              <div className="panel">
                <strong className="card__title" style={{ color: "var(--accent)" }}>
                  {progress ? `${progress.done}/${progress.total} dianalisa` : "Berjalan…"}
                </strong>
                <div className="btn-row">
                  <button className="btn btn--danger" onClick={() => void cancel()} disabled={cancelRef.current}>
                    Batalkan
                  </button>
                </div>
              </div>
            )}
            {phase === "done" && result && (
              <div className="panel">
                <strong className="card__title" style={{ color: cancelled ? "var(--danger)" : "var(--accent)" }}>
                  {jobStatus === "undone" ? "Sudah diurungkan" : cancelled ? "Dibatalkan" : "Selesai"}
                </strong>
                <ul className="file-list">
                  {result.map((r) => (
                    <li key={r.fileId} className="file-row">
                      {r.status === "ok" && jobStatus !== "undone" && (
                        <input
                          type="checkbox"
                          checked={undoSelected.has(r.fileId)}
                          onChange={() => toggleUndo(r.fileId)}
                          aria-label={`Pilih ${r.fileName} untuk diurungkan`}
                          disabled={undoBusy}
                        />
                      )}
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <strong>{r.fileName}</strong> —{" "}
                        {r.undoStatus === "ok"
                          ? "Dikembalikan"
                          : r.undoStatus === "failed"
                            ? `Undo gagal (${r.undoError})`
                            : r.status === "ok"
                              ? "OK"
                              : r.status === "failed"
                                ? `Gagal (${r.error})`
                                : "Dilewati"}
                      </span>
                    </li>
                  ))}
                </ul>
                {undoError && <p className="banner banner--err" role="alert">{undoError}</p>}
                {undoBusy && (
                  <p className="progress-line" aria-live="polite">
                    {undoProgress ? `${undoProgress.done}/${undoProgress.total} dikembalikan…` : "Mengembalikan…"}
                  </p>
                )}
                <div className="btn-row" style={{ marginTop: "var(--space-xs)" }}>
                  {jobStatus !== "undone" && !cancelled && result.some((r) => r.status === "ok") && (
                    <button
                      className="btn"
                      onClick={() => void undo()}
                      disabled={undoBusy || undoSelected.size === 0}
                      aria-label="Urungkan rapikan"
                    >
                      Urungkan
                    </button>
                  )}
                  {jobStatus === "undone" && (
                    <button className="btn" disabled aria-label="Urungkan rapikan">
                      Urungkan
                    </button>
                  )}
                  <button className="btn btn--2" onClick={() => setPhase("idle")}>
                    Tutup
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
