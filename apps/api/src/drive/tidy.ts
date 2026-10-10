import type { DriveClient, TidyPlanItem, TidyResultItem } from "./types.js";
import { categoryFolderName, type Category } from "./classify.js";

export type Classifier = (file: { id: string; name: string; mimeType: string }) => Promise<Category> | Category;

// Susun rencana: buat folder kategori (pakai ulang bila ada), lalu pindah + rename tiap PDF.
export async function buildPlan(client: DriveClient, folderId: string, classify: Classifier): Promise<TidyPlanItem[]> {
  const { folders, files } = await client.list(folderId);
  const pdfs = files.filter((f) => f.mimeType === "application/pdf");
  const folderByCat = new Map<string, string>();
  for (const f of folders) folderByCat.set(f.name, f.id);

  const plan: TidyPlanItem[] = [];
  const catFolder = new Map<Category, string>();
  for (const pdf of pdfs) {
    const cat = await classify(pdf);
    const label = categoryFolderName(cat);
    let parentId = folderByCat.get(label);
    if (!parentId) {
      if (!catFolder.has(cat)) {
        // Folder dibuat saat build agar kita punya id tujuan valid.
        const created = await client.createFolder(label, folderId);
        catFolder.set(cat, created.id);
        folderByCat.set(label, created.id);
        plan.push({
          action: "create_folder",
          fileId: created.id,
          fileName: label,
          fromParent: "",
          toParent: folderId,
          toName: label,
          category: cat,
        });
      }
      parentId = catFolder.get(cat)!;
    }
    plan.push({
      action: "move",
      fileId: pdf.id,
      fileName: pdf.name,
      fromParent: pdf.parents,
      toParent: parentId,
      toName: `${pdf.name.replace(/\.pdf$/i, "")} [${cat}].pdf`,
      category: cat,
    });
  }
  return plan;
}

export interface ExecuteOpts {
  isCancelled: () => boolean;
  onProgress?: (done: number, total: number, item: TidyResultItem) => void;
}

export async function executePlan(
  client: DriveClient,
  plan: TidyPlanItem[],
  opts: ExecuteOpts
): Promise<{ items: TidyResultItem[] }> {
  const items: TidyResultItem[] = [];
  const total = plan.filter((p) => p.action === "move").length;
  let done = 0;
  const createdFolderId = new Map<string, string>();

  for (const step of plan) {
    if (step.action === "create_folder") {
      try {
        const f = await client.createFolder(step.toName!, step.toParent);
        createdFolderId.set(step.toName!, f.id);
      } catch {
        /* create ulang / sudah ada diabaikan; id diambil dari move berikut */
      }
      continue;
    }
    if (opts.isCancelled()) {
      items.push({ fileId: step.fileId, fileName: step.fileName, action: "move", status: "skipped" });
      continue;
    }
    try {
      if (step.toName && step.toName !== step.fileName) await client.rename(step.fileId, step.toName);
      await client.move(step.fileId, step.toParent);
      const item: TidyResultItem = {
        fileId: step.fileId,
        fileName: step.fileName,
        action: "move",
        status: "ok",
        originalParent: step.fromParent,
        originalName: step.fileName,
      };
      items.push(item);
      done++;
      opts.onProgress?.(done, total, item);
    } catch (e) {
      const item: TidyResultItem = {
        fileId: step.fileId,
        fileName: step.fileName,
        action: "move",
        status: "failed",
        error: e instanceof Error ? e.message : "gagal",
        originalParent: step.fromParent,
      };
      items.push(item);
      done++;
      opts.onProgress?.(done, total, item);
    }
  }
  return { items };
}
