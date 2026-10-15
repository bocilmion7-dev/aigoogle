export interface DriveFile {
  id: string;
  name: string;
  parents: string;
  mimeType: string;
}
export interface DriveFolder {
  id: string;
  name: string;
  parents: string;
}
export interface PlanItem {
  action: string;
  fileId: string;
  fileName: string;
  fromParent: string;
  toParent: string;
  toName?: string;
  category: string;
}
export interface DriveStatus {
  connected: boolean;
  engine: "mock" | "google";
}

export async function driveStatus(): Promise<DriveStatus> {
  try {
    const r = await fetch("/api/drive/status", { signal: AbortSignal.timeout(15_000) });
    return r.ok ? await r.json() : { connected: false, engine: "google" };
  } catch {
    return { connected: false, engine: "google" };
  }
}

export async function driveList(folderId: string): Promise<{ folders: DriveFolder[]; files: DriveFile[] }> {
  const r = await fetch(`/api/drive/list?folderId=${encodeURIComponent(folderId)}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? "gagal");
  return r.json();
}

export type PlanEvent =
  | { type: "start"; total: number; folderName: string }
  | { type: "classify"; done: number; total: number; fileName: string; category: string }
  | { type: "done"; jobId: string; items: PlanItem[] };

export async function drivePlan(
  folderId: string,
  onEvent?: (e: PlanEvent) => void
): Promise<{ jobId: string; items: PlanItem[] }> {
  const r = await fetch(`/api/drive/plan${onEvent ? "?stream=1" : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId }),
  });
  if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? "gagal_membuat_rencana");
  if (!onEvent) return r.json();
  if (!r.body) throw new Error("gagal_membuat_rencana");
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let out: { jobId: string; items: PlanItem[] } | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const e = JSON.parse(line) as PlanEvent;
      if (e.type === "done") out = { jobId: e.jobId, items: e.items };
      onEvent(e);
    }
  }
  if (!out) throw new Error("gagal_membuat_rencana");
  return out;
}

export type RunEvent =
  | { type: "start"; total: number }
  | { type: "progress"; done: number; total: number; status: string; fileName: string }
  | { type: "done"; items: Array<Record<string, unknown>> }
  | { type: "cancelled"; items: Array<Record<string, unknown>> };

export async function driveRun(jobId: string, onEvent: (e: RunEvent) => void): Promise<void> {
  const r = await fetch(`/api/drive/jobs/${jobId}/run`, { method: "POST" });
  if (!r.body) throw new Error("gagal");
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as RunEvent);
    }
  }
}

export async function driveCancel(jobId: string): Promise<void> {
  await fetch(`/api/drive/jobs/${jobId}/cancel`, { method: "POST" });
}

export type UndoEvent =
  | { type: "start"; total: number }
  | { type: "progress"; done: number; total: number; status: string; fileName: string }
  | { type: "done"; jobId: string; status: string; items: Array<Record<string, unknown>> };

export async function driveUndo(
  jobId: string,
  fileIds: string[] | undefined,
  onEvent: (e: UndoEvent) => void
): Promise<void> {
  const r = await fetch(`/api/drive/jobs/${jobId}/undo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fileIds ? { fileIds } : {}),
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? "gagal");
  }
  if (!r.body) throw new Error("gagal");
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as UndoEvent);
    }
  }
}
