import type { ToolSpec } from "../providers/accounting/types.js";
import { driveClientFor } from "../drive/registry.js";
import { indexDrive, searchIndex } from "../drive/indexer.js";
import { ensureFolder, folderNameFor } from "../drive/folders.js";
import { DOC_LABEL, docFileName } from "../doc/naming.js";
import { buildInvoicePdf, type DocKind, type InvoiceItem } from "../doc/invoice-pdf.js";
import { prisma } from "../db.js";

/** tool chat utk Google Drive — beda penyedia dari tool Accurate */
export const DRIVE_FIND = "drive.findInvoices";
export const DRIVE_CREATE = "drive.createDoc";
export const DRIVE_INDEX = "drive.index";

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
  {
    name: DRIVE_CREATE,
    label: "Membuat nota/faktur & mengunggah ke Drive…",
    description:
      "BUAT file PDF nota/faktur (penjualan atau pembelian) dari data yang diberikan, lalu UNGGAH ke Google Drive dan kembalikan link-nya. " +
      "Nama file otomatis: dd-MM-yyyy-JENIS-NAMA PELANGGAN/PEMASOK.pdf. " +
      "Pakai bila pengguna minta dibuatkan/dicetak nota atau faktur (PDF) dan disimpan ke Google Drive. " +
      "Isi items = daftar barang/jasa (nama, qty, harga satuan). Bila datanya berasal dari faktur Accurate, " +
      "ambil dulu lewat salesInvoice.detail lalu kirim item-nya ke tool ini.",
    requiredPermission: "app:drive.tidy",
    jsonSchema: {
      type: "object",
      properties: {
        docType: {
          type: "string",
          enum: ["faktur", "nota", "faktur-pembelian", "nota-pembelian"],
          description: "jenis dokumen (pembelian = untuk pemasok/vendor)",
        },
        no: { type: "string", description: "nomor dokumen, mis. '001' atau 'SI.2026.10.00001'" },
        date: { type: "string", description: "tanggal dd/mm/yyyy (kosong = hari ini)" },
        partyName: { type: "string", description: "nama pelanggan/pembeli (penjualan) atau pemasok/vendor (pembelian)" },
        customerName: { type: "string", description: "alias lama partyName" },
        items: {
          type: "array",
          description: "daftar barang/jasa",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              qty: { type: "number" },
              price: { type: "number", description: "harga satuan (angka, tanpa Rp)" },
            },
            required: ["name"],
          },
        },
        note: { type: "string", description: "catatan tambahan (opsional)" },
        folder: { type: "string", description: "nama folder tujuan di Drive (opsional, dibuat bila belum ada)" },
      },
      required: ["docType", "items"],
    },
  },
  {
    name: DRIVE_INDEX,
    label: "Mengindeks isi Google Drive…",
    description:
      "Indeks ulang isi folder Google Drive (teks PDF disimpan ke database) agar pencarian berikutnya " +
      "bisa mencocokkan ISI dokumen, bukan hanya nama file. Pakai bila pengguna minta 'indeks/scan drive', " +
      "atau setelah banyak file baru masuk dan pencarian isi tidak menemukan apa pun.",
    requiredPermission: "app:drive.tidy",
    jsonSchema: {
      type: "object",
      properties: {
        folderId: { type: "string", description: "ID folder awal (default root)" },
        maxFiles: { type: "number", description: "batas jumlah file diproses (default 200, maks 500)" },
      },
    },
  },
];

export interface DriveFileRow {
  name: string;
  folder: string;
  modified: string;
  link: string;
  /** "nama" = cocok di nama file, "isi" = cocok di isi dokumen (dari indeks) */
  matched?: "nama" | "isi";
}

/** eksekusi tool Drive — error dikembalikan sebagai data (bukan throw) agar user dapat pesan jelas */
export async function executeDriveTool(
  tenantId: string,
  tool: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (tool === DRIVE_CREATE) return createDoc(tenantId, args);
  if (tool === DRIVE_INDEX) {
    try {
      const res = await indexDrive(tenantId, String(args.folderId ?? "root"), {
        maxFiles: Number(args.maxFiles) || undefined,
      });
      return res;
    } catch (e) {
      if (e instanceof Error && e.message === "belum_connect") {
        return { error: "Google Drive belum terhubung", hint: "Sambungkan Google di halaman Pengaturan (/settings)." };
      }
      throw e;
    }
  }
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
  const [hits, indexed] = await Promise.all([
    client.search(keywords, limit).catch(() => []),
    searchIndex(tenantId, keywords, limit).catch(() => []),
  ]);
  const merged = new Map<string, DriveFileRow>();
  for (const i of indexed) {
    merged.set(i.id, { name: i.name, folder: i.folder || "Drive Saya", modified: i.modified, link: i.link, matched: i.matched });
  }
  for (const h of hits) {
    if (!merged.has(h.id)) {
      merged.set(h.id, {
        name: h.name,
        folder: h.folderName || "Drive Saya",
        modified: h.modifiedTime ?? "",
        link: h.webViewLink ?? "",
        matched: "nama",
      });
    }
  }
  const files = [...merged.values()].slice(0, limit);
  return { keywords, count: files.length, files };
}

/** buat PDF nota/faktur → unggah ke Drive (folder opsional, auto-dibuat) */
const DOC_KINDS: DocKind[] = ["faktur", "nota", "faktur-pembelian", "nota-pembelian"];

async function createDoc(tenantId: string, args: Record<string, unknown>): Promise<unknown> {
  const kindRaw = String(args.docType ?? "");
  const docType = (DOC_KINDS as string[]).includes(kindRaw) ? (kindRaw as DocKind) : null;
  if (!docType) return { error: "docType harus salah satu: " + DOC_KINDS.join(", ") };
  const rawItems = Array.isArray(args.items) ? (args.items as Array<Record<string, unknown>>) : [];
  const items: InvoiceItem[] = rawItems
    .map((it) => ({
      name: String(it.name ?? "").trim(),
      qty: Number(it.qty ?? 1),
      price: Number(it.price ?? 0),
    }))
    .filter((it) => it.name && Number.isFinite(it.qty) && Number.isFinite(it.price));
  if (items.length === 0) return { error: "daftar items kosong", hint: "Sebutkan minimal satu barang/jasa beserta qty & harga." };

  const client = await driveClientFor(tenantId);
  if (!client) {
    return {
      error: "Google Drive belum terhubung",
      hint: "Sambungkan Google di halaman Pengaturan (/settings) lalu coba lagi.",
    };
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  const no = String(args.no ?? "").trim() || `${Date.now().toString().slice(-6)}`;
  const customerName = String(args.partyName ?? args.customerName ?? args.vendorName ?? "").trim();
  const isPurchase = docType.endsWith("-pembelian");
  const note = String(args.note ?? "").trim() || undefined;
  const date = String(args.date ?? "").trim();

  const bytes = await buildInvoicePdf({
    docType,
    companyName: tenant?.name ?? "Perusahaan",
    no,
    date,
    customerName,
    partyLabel: isPurchase ? "Dari" : "Kepada",
    items,
    note,
  });

  // folder tujuan: SELALU folder sesuai jenis dokumen (atau nama folder eksplisit)
  const folderName = String(args.folder ?? "").trim() || folderNameFor(docType);
  const parentId = await ensureFolder(client, folderName);

  const fileName = docFileName(docType, date, customerName, "pdf", DOC_LABEL[docType]);
  const up = await client.upload(fileName, "application/pdf", bytes, parentId);
  const total = items.reduce((a, it) => a + it.qty * it.price, 0);
  return {
    docType,
    no,
    fileName: up.name,
    folder: folderName || "Drive Saya",
    total,
    count: items.length,
    link: up.webViewLink ?? "",
  };
}
