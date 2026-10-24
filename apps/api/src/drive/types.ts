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
export interface ListResult {
  folders: DriveFolder[];
  files: DriveFile[];
}
/** hasil pencarian file lintas folder (chat: "cari faktur di Google Drive") */
export interface DriveSearchHit extends DriveFile {
  folderName: string;
  webViewLink?: string;
  modifiedTime?: string;
}
export interface UploadResult {
  id: string;
  name: string;
  webViewLink?: string;
}
export interface DriveClient {
  list(folderId: string): Promise<ListResult>;
  /** unggah file baru (bytes) ke folder tujuan */
  upload(name: string, mimeType: string, bytes: Uint8Array, parentId?: string): Promise<UploadResult>;
  /** cari file berdasarkan NAMA (lintas folder, bukan hanya 1 folder) */
  search(query: string, max?: number): Promise<DriveSearchHit[]>;
  getText(fileId: string): Promise<string>;
  getBytes?(fileId: string): Promise<Uint8Array>;
  createFolder(name: string, parents: string): Promise<DriveFolder>;
  rename(fileId: string, name: string): Promise<void>;
  move(fileId: string, newParents: string, oldParents?: string): Promise<void>;
  isDescendant(folderId: string, ancestorId: string): Promise<boolean>;
}

export type TidyAction = "create_folder" | "rename" | "move";
export interface TidyPlanItem {
  action: TidyAction;
  fileId: string;
  fileName: string;
  fromParent: string;
  toParent: string;
  toName?: string;
  category: string;
}
export interface TidyResultItem {
  fileId: string;
  fileName: string;
  action: TidyAction;
  status: "ok" | "failed" | "skipped";
  error?: string;
  originalParent?: string;
  originalName?: string;
  toParent?: string;
  toName?: string;
}

export interface UndoTarget {
  fileId: string;
  fileName: string;
  originalParent: string;
  originalName: string;
  toParent: string;
  toName: string;
}

export interface UndoResultItem {
  fileId: string;
  fileName: string;
  status: "ok" | "failed";
  error?: string;
}
