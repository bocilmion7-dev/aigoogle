import type { DriveClient } from "./types.js";

/**
 * Folder Drive per JENIS DOKUMEN — file arsip harus masuk folder yang sesuai
 * (Faktur, Nota, Kwitansi, Screenshot Pembayaran, dst). Dibuat otomatis bila belum ada.
 */
export const DOC_FOLDER: Record<string, string> = {
  faktur: "Faktur",
  nota: "Nota",
  kwitansi: "Kwitansi",
  "screenshot-pembayaran": "Screenshot Pembayaran",
  "faktur-pembelian": "Faktur Pembelian",
  "nota-pembelian": "Nota Pembelian",
  biaya: "Biaya",
  transfer: "Transfer",
  lainnya: "Lainnya",
};

/** nama folder utk jenis dokumen (jenis kustom → label apa adanya, dibersihkan) */
export function folderNameFor(docType: string, customLabel?: string): string {
  const key = String(docType ?? "").trim().toLowerCase();
  const fixed = DOC_FOLDER[key];
  if (fixed) return fixed;
  const label = String(customLabel ?? docType ?? "").trim();
  const clean = label.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return clean || DOC_FOLDER.lainnya!;
}

/** cari folder di root (case-insensitive) atau buat baru */
export async function ensureFolder(client: DriveClient, name: string): Promise<string> {
  const root = await client.list("root");
  const found = root.folders.find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  const created = await client.createFolder(name, "root");
  return created.id;
}
