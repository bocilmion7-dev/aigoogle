import { useCallback, useEffect, useRef, useState } from "react";
import {
  driveCancel,
  driveList,
  drivePlan,
  driveRun,
  driveStatus,
  type DriveFile,
  type DriveFolder,
  type DriveStatus,
  type PlanItem,
  type RunEvent,
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
}

type Phase = "idle" | "planning" | "preview" | "running" | "done";

export function Explore() {
  const [status, setStatus] = useState<DriveStatus | null>(null);
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
          setResult(e.items as unknown as ResultItem[]);
          setPhase("done");
        }
        if (e.type === "cancelled") {
          setResult(e.items as unknown as ResultItem[]);
          setCancelled(true);
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

  if (!status) return <p style={{ padding: 24 }}>Memuat…</p>;

  if (!status.connected) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 560 }}>
        <h2 style={{ fontSize: 18, color: "#3d6b54" }}>Explore Manager</h2>
        <p style={{ color: "#555" }}>
          Hubungkan Google Drive untuk merapikan folder. Status engine:{" "}
          <strong>{status.engine === "mock" ? "mock" : "Google Drive"}</strong>.
        </p>
        {status.engine === "google" && (
          <a href="/api/oauth/google/start" style={{ color: "#3d6b54" }}>
            Hubungkan Google Drive →
          </a>
        )}
      </div>
    );
  }

  const pdfCount = files.filter((f) => f.mimeType === "application/pdf").length;

  return (
    <div style={{ display: "flex", gap: 16, maxWidth: 960, margin: "0 auto", padding: 16, fontFamily: "system-ui" }}>
      <section style={{ flex: 1 }}>
        <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
          {trail.map((t, i) => (
            <span key={t.id}>
              {i > 0 && " / "}
              <button
                style={{ border: "none", background: "none", color: "#3d6b54", cursor: "pointer", padding: 0, fontSize: 13 }}
                onClick={() => goto(i)}
              >
                {t.name}
              </button>
            </span>
          ))}
        </nav>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button style={btn} onClick={() => void load(folderId)}>
            Refresh
          </button>
          <button style={btn} onClick={() => void makePlan()} disabled={phase === "planning" || phase === "running"} aria-label="Rapikan folder ini">
            Rapikan Folder Ini
          </button>
          <span style={{ fontSize: 13, color: "#666", alignSelf: "center" }}>{pdfCount} PDF</span>
        </div>
        {error && <p style={{ color: "#a33", fontSize: 13 }}>{error}</p>}
        <div style={{ background: "#faf8f5", border: "1px solid #e3ddd4", borderRadius: 6, padding: 12 }}>
          {folders.length === 0 && files.length === 0 && (
            <p style={{ color: "#555" }}>Tidak ada file untuk dirapikan.</p>
          )}
          {folders.map((f) => (
            <div key={f.id} style={{ padding: "6px 0" }}>
              <button style={{ ...btn, background: "#eeeae3", color: "#333", width: "100%", textAlign: "left" }} onClick={() => enter(f)}>
                📁 {f.name}
              </button>
            </div>
          ))}
          {files.map((f) => (
            <div key={f.id} style={{ padding: "6px 0", color: "#333", fontSize: 14 }}>
              {f.mimeType === "application/pdf" ? "📄" : "📎"} {f.name}
            </div>
          ))}
        </div>
      </section>

      <aside style={{ width: 280, flexShrink: 0 }}>
        {phase === "planning" && <p style={{ color: "#555" }}>Menganalisa isi PDF…</p>}
        {phase === "preview" && plan && (
          <div style={{ background: "#faf8f5", border: "1px solid #e3ddd4", borderRadius: 6, padding: 12 }}>
            <strong style={{ color: "#3d6b54" }}>Preview rencana</strong>
            <ul style={{ paddingLeft: 16, fontSize: 13, color: "#333" }}>
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
              <p style={{ fontSize: 13, color: "#555" }}>Tidak ada PDF untuk dirapikan.</p>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button style={btn} onClick={() => void run()} disabled={plan.every((p) => p.action !== "move")}>
                Jalankan
              </button>
              <button style={{ ...btn, background: "#eeeae3", color: "#333" }} onClick={() => setPhase("idle")}>
                Batal
              </button>
            </div>
          </div>
        )}
        {phase === "running" && (
          <div style={{ background: "#faf8f5", border: "1px solid #e3ddd4", borderRadius: 6, padding: 12 }}>
            <strong style={{ color: "#3d6b54" }}>
              {progress ? `${progress.done}/${progress.total} dianalisa` : "Berjalan…"}
            </strong>
            <div style={{ marginTop: 8 }}>
              <button style={{ ...btn, background: "#a33" }} onClick={() => void cancel()} disabled={cancelRef.current}>
                Batalkan
              </button>
            </div>
          </div>
        )}
        {phase === "done" && result && (
          <div style={{ background: "#faf8f5", border: "1px solid #e3ddd4", borderRadius: 6, padding: 12 }}>
            <strong style={{ color: cancelled ? "#a33" : "#3d6b54" }}>
              {cancelled ? "Dibatalkan" : "Selesai"}
            </strong>
            <ul style={{ paddingLeft: 16, fontSize: 13, color: "#333" }}>
              {result.map((r) => (
                <li key={r.fileId}>
                  {r.fileName} — {r.status === "ok" ? "OK" : r.status === "failed" ? `Gagal (${r.error})` : "Dilewati"}
                </li>
              ))}
            </ul>
            <p style={{ fontSize: 12, color: "#666" }}>
              Posisi asal tiap file tersimpan di log — fitur Urungkan menyusul.
            </p>
            <button style={btn} onClick={() => setPhase("idle")}>
              Tutup
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

const btn: React.CSSProperties = {
  border: "none",
  borderRadius: 4,
  padding: "8px 12px",
  cursor: "pointer",
  background: "#3d6b54",
  color: "white",
  fontSize: 14,
};
