import type { ToolSpec } from "../providers/accounting/types.js";
import { driveClientFor } from "../drive/registry.js";

/** tool chat utk Google Drive — beda penyedia dari tool Accurate */
export const DRIVE_FIND = "drive.findInvoices";

export const DRIVE_TOOLS: ToolSpec[] = [
  {
    name: DRIVE_FIND,
    label: "Mencari file di Google Drive…",
    description:
      "Cari FILE/DOKUMEN (faktur, nota, kuitansi, PDF) di Google Drive pengguna berdasarkan kata kunci NAMA FILE. " +
      "Mengembalikan nama file, folder, tanggal terakhir diubah, dan link buka. " +
      "Pakai HANYA bila pengguna menyebut Google Drive / file / dokumen — BUKAN untuk faktur di Accurate " +
      "(faktur penjualan/pembelian Accurate pakai salesInvoice/purchaseInvoice).",
    requiredPermission: "app:drive.tidy",
    jsonSchema: {
      type: "object",
      properties: {
        keywords: {
          type: "string",
          description: "kata kunci nama file, mis. 'faktur', 'faktur 001', nama vendor/pelanggan",
        },
        limit: { type: "number", description: "jumlah maksimal hasil (default 25, maks 50)" },
      },
      required: ["keywords"],
    },
  },
];

export interface DriveFileRow {
  name: string;
  folder: string;
  modified: string;
  link: string;
}

/** eksekusi tool Drive — error dikembalikan sebagai data (bukan throw) agar user dapat pesan jelas */
export async function executeDriveTool(
  tenantId: string,
  tool: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (tool !== DRIVE_FIND) throw new Error(`tool drive tidak dikenal: ${tool}`);
  const keywords = String(args.keywords ?? "").trim();
  if (!keywords) {
    return { error: "kata kunci pencarian Drive kosong", hint: "Sebutkan kata kunci nama file, mis. \"faktur\"." };
  }
  const raw = Number(args.limit ?? 25);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 50) : 25;
  const client = await driveClientFor(tenantId);
  if (!client) {
    return {
      error: "Google Drive belum terhubung",
      hint: "Sambungkan Google di halaman Pengaturan (/settings) lalu coba lagi.",
    };
  }
  const hits = await client.search(keywords, limit);
  const files: DriveFileRow[] = hits.map((h) => ({
    name: h.name,
    folder: h.folderName,
    modified: h.modifiedTime ?? "",
    link: h.webViewLink ?? "",
  }));
  return { keywords, count: files.length, files };
}
