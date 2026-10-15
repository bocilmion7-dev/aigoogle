import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getMe } from "../api";
import { AppHeader, PageLoader } from "../ui";
import { IconChevron, IconFolder, fileIconFor } from "../icons";
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

interface TreeNode {
  folders: DriveFolder[];
  files: DriveFile[];
  loaded: boolean;
  loading: boolean;
  expanded: boolean;
}

type Phase = "idle" | "planning" | "preview" | "running" | "done";

const emptyNode = (expanded = false): TreeNode => ({
  folders: [],
  files: [],
  loaded: false,
  loading: false,
  expanded,
});

export function Explore() {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [canTidy, setCanTidy] = useState<boolean | null>(null);
  const [nodes, setNodes] = useState<Record<string, TreeNode>>({ root: emptyNode(true) });
  const [selected, setSelected] = useState("root");
  const [names, setNames] = useState<Record<string, string>>({ root: "Drive" });
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
  const [modalLog, setModalLog] = useState<string[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const cancelRef = useRef(false);

  const errText = (code?: string) =>
    code === "belum_connect"
      ? "Belum terhubung ke Google Drive — hubungkan dulu di Pengaturan."
      : code === "tidak_punya_hak"
        ? "Anda tidak punya hak Rapikan Drive."
        : code === "di_luar_cakupan"
          ? "Folder di luar cakupan."
          : "Terjadi gangguan — coba lagi.";

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const load = useCallback(async (id: string, force = false) => {
    const cur = nodesRef.current[id];
    if (!force && (cur?.loaded || cur?.loading)) return;
    setNodes((prev) => ({ ...prev, [id]: { ...(prev[id] ?? emptyNode()), loading: true } }));
    try {
      const l = await driveList(id);
      setNodes((prev) => ({
        ...prev,
        [id]: { folders: l.folders, files: l.files, loaded: true, loading: false, expanded: true },
      }));
      setNames((prev) => {
        const next = { ...prev };
        for (const f of l.folders) next[f.id] = f.name;
        return next;
      });
    } catch (e) {
      setError(errText(e instanceof Error ? e.message : undefined));
      setNodes((prev) => ({ ...prev, [id]: { ...(prev[id] ?? emptyNode()), loading: false } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void driveStatus().then(setStatus);
    void getMe()
      .then((me) => setCanTidy(!!me?.permissions?.includes("app:drive.tidy")))
      .catch(() => setCanTidy(false));
  }, []);

  useEffect(() => {
    if (status?.connected) void load("root");
  }, [status, load]);

  function toggle(id: string) {
    setNodes((prev) => {
      const n = prev[id] ?? emptyNode();
      return { ...prev, [id]: { ...n, expanded: !n.expanded } };
    });
    void load(id);
  }

  function select(id: string) {
    setSelected(id);
    setError(null);
    setPhase("idle");
    setPlan(null);
    setResult(null);
    void load(id);
  }

  const selectedNode = nodes[selected];
  const pdfCount = selectedNode?.files.filter((f) => f.mimeType === "application/pdf").length ?? 0;

  async function makePlan() {
    setPhase("planning");
    setError(null);
    setProgress(null);
    setModalLog([]);
    try {
      const p = await drivePlan(selected, (e) => {
        if (e.type === "start") setProgress({ done: 0, total: e.total });
        if (e.type === "classify") {
          setProgress({ done: e.done, total: e.total });
          setModalLog((l) => [...l, `${e.done}/${e.total} · ${e.fileName} → ${e.category}`]);
        }
      });
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
    setCancelling(false);
    setModalLog([]);
    cancelRef.current = false;
    try {
      await driveRun(jobId, (e: RunEvent) => {
        if (e.type === "start") setProgress({ done: 0, total: e.total });
        if (e.type === "progress") {
          setProgress({ done: e.done, total: e.total });
          const mark = e.status === "ok" ? "OK" : e.status === "failed" ? "Gagal" : "Dilewati";
          setModalLog((l) => [...l, `${e.done}/${e.total} · ${e.fileName} — ${mark}`]);
        }
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
      void load(selected, true);
    }
  }

  async function cancel() {
    if (!jobId) return;
    cancelRef.current = true;
    setCancelling(true);
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
      void load(selected, true);
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

  function renderTree(id: string, depth: number): ReactNode {
    const node = nodes[id] ?? emptyNode();
    const name = names[id] ?? id;
    const isOpen = node.expanded;
    const isSelected = selected === id;
    return (
      <li key={id} role="treeitem" aria-expanded={isOpen} aria-selected={isSelected}>
        <div className="tree__row-wrap" style={{ paddingLeft: depth * 16 }}>
          <button
            type="button"
            className={`tree__row${isSelected ? " is-selected" : ""}`}
            onClick={() => {
              select(id);
              toggle(id);
            }}
            aria-label={name}
          >
            <span
              className={`tree__chev${isOpen && (node.folders.length > 0 || !node.loaded || node.files.length > 0) ? " is-open" : ""}`}
              aria-hidden="true"
            >
              <IconChevron size={14} />
            </span>
            <span className="tree__icon" aria-hidden="true">
              <IconFolder size={16} />
            </span>
            <span className="tree__name">{name}</span>
            {node.loaded && node.files.length > 0 && <span className="tree__count">{node.files.length}</span>}
          </button>
        </div>
        {isOpen && (
          <ul role="group">
            {node.loading && (
              <li className="tree__hint tree__hint--loading" style={{ paddingLeft: (depth + 1) * 16 + 40 }}>
                <span className="tree__spin" aria-hidden="true" />
                Memuat…
              </li>
            )}
            {node.loaded && node.folders.length === 0 && node.files.length === 0 && (
              <li className="tree__hint" style={{ paddingLeft: (depth + 1) * 16 + 40 }}>
                Kosong
              </li>
            )}
            {node.folders.map((f) => renderTree(f.id, depth + 1))}
            {node.files.map((f) => {
              const FileIcon = fileIconFor(f.mimeType);
              return (
                <li key={f.id} role="treeitem" aria-selected={false} style={{ paddingLeft: (depth + 1) * 16 + 20 }}>
                  <span className="tree__row tree__row--file">
                    <span className="tree__icon tree__icon--file" aria-hidden="true">
                      <FileIcon size={15} />
                    </span>
                    <span className="tree__name">{f.name}</span>
                    {f.mimeType === "application/pdf" && <span className="tree__badge">PDF</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  }

  if (!status) {
    return (
      <div className="app">
        <AppHeader />
        <main className="page">
          <PageLoader />
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

  return (
    <div className="app">
      <AppHeader />
      <main className="page">
        <h1>Explore Manager</h1>
        <p className="page__sub">Telusuri Drive, rapikan PDF ke folder kategori — dengan pratinjau &amp; urungkan.</p>

        <div className="explore">
          <section>
            <div className="btn-row" style={{ marginBottom: "var(--space-xs)" }}>
              <button className="btn btn--2 btn--sm" onClick={() => void load(selected, true)}>
                Refresh
              </button>
              {canTidy !== false && (
                <button
                  className="btn btn--sm"
                  onClick={() => void makePlan()}
                  disabled={phase === "planning" || phase === "running"}
                  aria-label="Rapikan folder terpilih"
                >
                  Rapikan “{names[selected] ?? selected}”
                </button>
              )}
              <span className="meta" style={{ marginLeft: "auto" }}>
                <span className="num">{pdfCount}</span> PDF
              </span>
            </div>
            {error && <p className="banner banner--err" role="alert">{error}</p>}
            <div className="panel">
              <ul className="tree" role="tree" aria-label="Struktur Google Drive">
                {renderTree("root", 0)}
              </ul>
            </div>
          </section>

          <aside className="stack">
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
      {(phase === "planning" || phase === "running") && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={phase === "planning" ? "Menganalisa isi PDF" : "Menjalankan rapikan"}>
          <div className="modal">
            <div className="modal__head">
              <span className="modal__spin" aria-hidden="true" />
              <strong className="card__title" style={{ marginBottom: 0 }}>
                {phase === "planning" ? "Menganalisa isi PDF…" : "Menjalankan rapikan…"}
              </strong>
            </div>
            <p className="meta modal__counter" aria-live="polite">
              {progress ? `${progress.done}/${progress.total} ${phase === "planning" ? "dianalisa" : "diproses"}` : "Menyiapkan…"}
            </p>
            <div className="modal__bar" aria-hidden="true">
              <span
                className={progress && progress.total > 0 ? undefined : "is-indeterminate"}
                style={progress && progress.total > 0 ? { width: `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%` } : undefined}
              />
            </div>
            <ul className="modal__log" aria-live="polite">
              {modalLog.length === 0 ? (
                <li className="modal__log-empty">Menunggu berkas pertama…</li>
              ) : (
                modalLog.map((line, i) => <li key={i}>{line}</li>)
              )}
            </ul>
            {phase === "running" && (
              <div className="btn-row" style={{ marginTop: 0 }}>
                <button className="btn btn--danger" onClick={() => void cancel()} disabled={cancelling}>
                  Batalkan
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
