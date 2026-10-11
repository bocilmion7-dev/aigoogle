import type { DriveClient, DriveFile, DriveFolder, ListResult } from "./types.js";

const API = "https://www.googleapis.com/drive/v3";

export class GoogleDriveClient implements DriveClient {
  constructor(private accessToken: string) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  async list(folderId: string): Promise<ListResult> {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const url = `${API}/files?q=${q}&fields=files(id,name,parents,mimeType)&pageSize=200`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`drive list gagal (${res.status})`);
    const j = (await res.json()) as { files: DriveFile[] };
    const files: DriveFile[] = [];
    const folders: DriveFolder[] = [];
    for (const f of j.files ?? []) {
      const row = { id: f.id, name: f.name, parents: f.parents?.[0] ?? folderId, mimeType: f.mimeType };
      if (f.mimeType === "application/vnd.google-apps.folder") folders.push(row);
      else files.push(row);
    }
    return { folders, files };
  }

  async getText(fileId: string): Promise<string> {
    const meta = await fetch(`${API}/files/${fileId}?fields=mimeType`, { headers: this.headers() });
    if (!meta.ok) throw new Error(`drive meta gagal (${meta.status})`);
    const { mimeType } = (await meta.json()) as { mimeType: string };
    const url = mimeType.startsWith("application/vnd.google-apps.")
      ? `${API}/files/${fileId}/export?mimeType=text/plain`
      : `${API}/files/${fileId}?alt=media`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`drive download gagal (${res.status})`);
    return res.text();
  }

  async createFolder(name: string, parents: string): Promise<DriveFolder> {
    const res = await fetch(`${API}/files`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parents] }),
    });
    if (!res.ok) throw new Error(`create folder gagal (${res.status})`);
    const j = (await res.json()) as { id: string; name: string };
    return { id: j.id, name: j.name, parents };
  }

  async rename(fileId: string, name: string): Promise<void> {
    const res = await fetch(`${API}/files/${fileId}`, {
      method: "PATCH",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`rename gagal (${res.status})`);
  }

  async move(fileId: string, newParents: string, oldParents?: string): Promise<void> {
    const qs = new URLSearchParams({ addParents: newParents });
    if (oldParents) qs.set("removeParents", oldParents);
    const res = await fetch(`${API}/files/${fileId}?${qs}`, {
      method: "PATCH",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`move gagal (${res.status})`);
  }

  async isDescendant(folderId: string, ancestorId: string): Promise<boolean> {
    if (folderId === ancestorId) return true;
    let cur: string | undefined = folderId;
    let hops = 0;
    while (cur && hops++ < 50) {
      const res = await fetch(`${API}/files/${cur}?fields=parents`, { headers: this.headers() });
      if (!res.ok) return false;
      const j = (await res.json()) as { parents?: string[] };
      cur = j.parents?.[0];
      if (cur === ancestorId) return true;
    }
    return false;
  }
}
