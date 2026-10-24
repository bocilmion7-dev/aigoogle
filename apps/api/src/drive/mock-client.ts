import type { DriveClient, DriveFile, DriveFolder, DriveSearchHit, ListResult } from "./types.js";

export interface MockSeed {
  folders: DriveFolder[];
  files: (DriveFile & { text: string })[];
}

export class MockDriveClient implements DriveClient {
  private folders: DriveFolder[];
  private files: (DriveFile & { text: string })[];
  constructor(seed: MockSeed) {
    this.folders = [...seed.folders];
    this.files = seed.files.map((f) => ({ ...f }));
  }
  private hasFolder(id: string) {
    return this.folders.some((f) => f.id === id) || id === "root";
  }
  async list(folderId: string): Promise<ListResult> {
    if (!this.hasFolder(folderId)) throw new Error("folder tidak ditemukan");
    return {
      folders: this.folders.filter((f) => f.parents === folderId),
      files: this.files.filter((f) => f.parents === folderId),
    };
  }
  async search(query: string, max = 25): Promise<DriveSearchHit[]> {
    const q = query.trim().toLowerCase();
    return this.files
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .slice(0, max)
      .map((f) => ({
        id: f.id,
        name: f.name,
        parents: f.parents,
        mimeType: f.mimeType,
        folderName: this.folders.find((d) => d.id === f.parents)?.name ?? "",
      }));
  }
  async getText(fileId: string): Promise<string> {
    return this.files.find((f) => f.id === fileId)?.text ?? "";
  }
  async createFolder(name: string, parents: string): Promise<DriveFolder> {
    if (!this.hasFolder(parents)) throw new Error("parents di luar scope");
    const existing = this.folders.find((f) => f.parents === parents && f.name === name);
    if (existing) return existing;
    const f: DriveFolder = { id: `dir-${this.folders.length + 1}`, name, parents };
    this.folders.push(f);
    return f;
  }
  async rename(fileId: string, name: string): Promise<void> {
    const f = this.files.find((x) => x.id === fileId);
    if (!f) throw new Error("file tidak ditemukan");
    f.name = name;
  }
  async move(fileId: string, newParents: string, _oldParents?: string): Promise<void> {
    if (!this.hasFolder(newParents)) throw new Error("tujuan di luar scope");
    const f = this.files.find((x) => x.id === fileId);
    if (!f) throw new Error("file tidak ditemukan");
    f.parents = newParents;
  }
  async isDescendant(folderId: string, ancestorId: string): Promise<boolean> {
    if (folderId === ancestorId) return true;
    let cur = this.folders.find((f) => f.id === folderId)?.parents;
    let hops = 0;
    while (cur && hops++ < 50) {
      if (cur === ancestorId) return true;
      cur = this.folders.find((f) => f.id === cur)?.parents;
    }
    return false;
  }
}
