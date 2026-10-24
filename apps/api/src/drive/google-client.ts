import type { DriveClient, DriveFile, DriveFolder, DriveSearchHit, ListResult } from "./types.js";

const API = "https://www.googleapis.com/drive/v3";

/** Timeout per-request — endpoint Google bisa menggantung setelah koneksi half-open. */
const FETCH_TIMEOUT_MS = 30_000;

export class GoogleDriveClient implements DriveClient {
  constructor(private accessToken: string) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  /** fetch + AbortSignal.timeout — Google Drive API selalu dibatasi waktu. */
  private fetch(url: string, init?: RequestInit): Promise<Response> {
    return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  }

  async list(folderId: string): Promise<ListResult> {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const url = `${API}/files?q=${q}&fields=files(id,name,parents,mimeType)&pageSize=200`;
    const res = await this.fetch(url, { headers: this.headers() });
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

  /** cari file berdasarkan nama di SELURUH Drive (bukan per folder) */
  async search(query: string, max = 25): Promise<DriveSearchHit[]> {
    // escape kutip/titik-miring — query Drive memakai sintaks 'name contains "...'
    const q = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const dq = encodeURIComponent(`trashed=false and name contains '${q}'`);
    const url =
      `${API}/files?q=${dq}` +
      `&fields=${encodeURIComponent("files(id,name,parents,mimeType,webViewLink,modifiedTime)")}` +
      `&pageSize=${max}&orderBy=${encodeURIComponent("modifiedTime desc")}`;
    const res = await this.fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`drive search gagal (${res.status})`);
    const j = (await res.json()) as {
      files?: Array<DriveFile & { webViewLink?: string; modifiedTime?: string }>;
    };
    const files = j.files ?? [];
    const names = await this.folderNames(files.map((f) => f.parents?.[0]).filter((x): x is string => Boolean(x)));
    return files.map((f) => ({
      id: f.id,
      name: f.name,
      parents: f.parents?.[0] ?? "",
      mimeType: f.mimeType,
      webViewLink: f.webViewLink,
      modifiedTime: f.modifiedTime,
      folderName: names.get(f.parents?.[0] ?? "") ?? "",
    }));
  }

  /** nama folder induk utk ditampilkan di hasil pencarian (maks 10 unik, paralel) */
  private async folderNames(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>([["root", "Drive Saya"]]);
    const uniq = [...new Set(ids)].filter((id) => id && id !== "root").slice(0, 10);
    await Promise.all(
      uniq.map(async (id) => {
        try {
          const res = await this.fetch(`${API}/files/${id}?fields=name`, { headers: this.headers() });
          if (!res.ok) return;
          const j = (await res.json()) as { name?: string };
          if (j.name) out.set(id, j.name);
        } catch {
          // nama folder gagal diambil → tampil kosong, bukan menggagalkan pencarian
        }
      })
    );
    return out;
  }

  async getText(fileId: string): Promise<string> {    const meta = await this.fetch(`${API}/files/${fileId}?fields=mimeType`, { headers: this.headers() });
    if (!meta.ok) throw new Error(`drive meta gagal (${meta.status})`);
    const { mimeType } = (await meta.json()) as { mimeType: string };
    const url = mimeType.startsWith("application/vnd.google-apps.")
      ? `${API}/files/${fileId}/export?mimeType=text/plain`
      : `${API}/files/${fileId}?alt=media`;
    const res = await this.fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`drive download gagal (${res.status})`);
    return res.text();
  }

  async getBytes(fileId: string): Promise<Uint8Array> {
    const res = await this.fetch(`${API}/files/${fileId}?alt=media`, { headers: this.headers() });
    if (!res.ok) throw new Error(`drive download gagal (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async createFolder(name: string, parents: string): Promise<DriveFolder> {
    const res = await this.fetch(`${API}/files`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parents] }),
    });
    if (!res.ok) throw new Error(`create folder gagal (${res.status})`);
    const j = (await res.json()) as { id: string; name: string };
    return { id: j.id, name: j.name, parents };
  }

  async rename(fileId: string, name: string): Promise<void> {
    const res = await this.fetch(`${API}/files/${fileId}`, {
      method: "PATCH",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`rename gagal (${res.status})`);
  }

  async move(fileId: string, newParents: string, oldParents?: string): Promise<void> {
    const qs = new URLSearchParams({ addParents: newParents });
    if (oldParents) qs.set("removeParents", oldParents);
    const res = await this.fetch(`${API}/files/${fileId}?${qs}`, {
      method: "PATCH",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`move gagal (${res.status})`);
  }

  private rootIdCache: string | null = null;

  /** "root" hanya alias utk query (`'root' in parents`); field parents berisi ID asli My Drive root. */
  private async realRootId(): Promise<string> {
    if (this.rootIdCache) return this.rootIdCache;
    const res = await this.fetch(`${API}/files/root?fields=id`, { headers: this.headers() });
    if (!res.ok) return "root";
    const j = (await res.json()) as { id?: string };
    if (j.id) this.rootIdCache = j.id;
    return j.id ?? "root";
  }

  async isDescendant(folderId: string, ancestorId: string): Promise<boolean> {
    if (folderId === ancestorId) return true;
    const ancestor = ancestorId === "root" ? await this.realRootId() : ancestorId;
    if (folderId === ancestor) return true;
    let cur: string | undefined = folderId;
    let hops = 0;
    while (cur && hops++ < 50) {
      const res = await this.fetch(`${API}/files/${cur}?fields=parents`, { headers: this.headers() });
      if (!res.ok) return false;
      const j = (await res.json()) as { parents?: string[] };
      cur = j.parents?.[0];
      if (cur === ancestor) return true;
    }
    return false;
  }
}