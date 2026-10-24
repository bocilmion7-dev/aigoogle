import { prisma } from "../db.js";
import { detectKind, extractText } from "../doc/extract.js";
import { driveClientFor } from "./registry.js";

/**
 * Indeks isi Google Drive (nama + teks PDF) ke DB agar pencarian bisa
 * mencocokkan NAMA maupun ISI dokumen — bukan hanya nama file.
 * Ekstraksi teks lokal (pdf-parse), tanpa biaya AI.
 */
const MAX_FILES = 200;
const MAX_DEPTH = 4;
const MAX_TEXT = 20_000;

export interface IndexResult {
  scanned: number;
  indexed: number;
  skipped: number;
  failed: number;
  truncated: boolean;
}

export interface IndexedHit {
  id: string;
  name: string;
  folder: string;
  modified: string;
  link: string;
  /** "nama" = cocok di nama file, "isi" = cocok di isi dokumen */
  matched: "nama" | "isi";
}

export async function indexDrive(
  tenantId: string,
  folderId = "root",
  opts?: { maxFiles?: number }
): Promise<IndexResult> {
  const client = await driveClientFor(tenantId);
  if (!client) throw new Error("belum_connect");
  const maxFiles = Math.min(Math.max(1, opts?.maxFiles ?? MAX_FILES), 500);
  const out: IndexResult = { scanned: 0, indexed: 0, skipped: 0, failed: 0, truncated: false };
  const queue: Array<{ id: string; depth: number; folder: string }> = [{ id: folderId, depth: 0, folder: "" }];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    let listing;
    try {
      listing = await client.list(cur.id);
    } catch {
      out.failed += 1;
      continue;
    }
    for (const f of listing.folders) {
      if (cur.depth + 1 <= MAX_DEPTH) queue.push({ id: f.id, depth: cur.depth + 1, folder: f.name });
    }
    for (const f of listing.files) {
      if (out.scanned >= maxFiles) {
        out.truncated = true;
        break;
      }
      out.scanned += 1;
      const kind = detectKind(f.name, f.mimeType);
      if (kind === "unknown" || kind === "image") {
        out.skipped += 1;
        continue;
      }
      try {
        let text = "";
        if (kind === "text") {
          text = await client.getText(f.id);
        } else if (client.getBytes) {
          const bytes = await client.getBytes(f.id);
          text = await extractText(Buffer.from(bytes), kind);
        }
        const payload = {
          tenantId,
          fileId: f.id,
          name: f.name,
          folder: cur.folder,
          mimeType: f.mimeType,
          text: text.slice(0, MAX_TEXT),
          modifiedTime: "",
        };
        await prisma.driveIndex.upsert({
          where: { tenantId_fileId: { tenantId, fileId: f.id } },
          create: payload,
          update: { name: payload.name, folder: payload.folder, mimeType: payload.mimeType, text: payload.text },
        });
        out.indexed += 1;
      } catch {
        out.failed += 1;
      }
    }
    if (out.truncated) break;
  }
  return out;
}

/** cari di indeks: nama ATAU isi dokumen */
export async function searchIndex(tenantId: string, query: string, limit = 25): Promise<IndexedHit[]> {
  const q = query.trim();
  if (!q) return [];
  const rows = await prisma.driveIndex.findMany({
    where: {
      tenantId,
      OR: [{ name: { contains: q, mode: "insensitive" } }, { text: { contains: q, mode: "insensitive" } }],
    },
    take: limit,
    orderBy: { name: "asc" },
  });
  const lower = q.toLowerCase();
  return rows.map((r) => ({
    id: r.fileId,
    name: r.name,
    folder: r.folder,
    modified: r.modifiedTime,
    link: `https://drive.google.com/file/d/${r.fileId}/view`,
    matched: r.name.toLowerCase().includes(lower) ? "nama" : "isi",
  }));
}

export async function indexStats(tenantId: string): Promise<{ files: number; withText: number }> {
  const [files, withText] = await Promise.all([
    prisma.driveIndex.count({ where: { tenantId } }),
    prisma.driveIndex.count({ where: { tenantId, NOT: { text: "" } } }),
  ]);
  return { files, withText };
}
