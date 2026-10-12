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
export interface DriveClient {
  list(folderId: string): Promise<ListResult>;
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
