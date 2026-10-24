import type { ToolSpec } from "../providers/accounting/types.js";
import { driveClientFor } from "../drive/registry.js";
import { buildInvoicePdf, type DocKind, type InvoiceItem } from "../doc/invoice-pdf.js";
import { prisma } from "../db.js";

/** tool chat utk Google Drive — beda penyedia dari tool Accurate */
export const DRIVE_FIND = "drive.findInvoices";
export const DRIVE_CREATE = "drive.createDoc";

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
  if (tool === DRIVE_CREATE) return createDoc(tenantId, args);
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

/** buat PDF nota/faktur → unggah ke Drive (folder opsional, auto-dibuat) */
const DOC_KINDS: DocKind[] = ["faktur", "nota", "faktur-pembelian", "nota-pembelian"];
const DOC_LABEL: Record<DocKind, string> = {
  faktur: "FAKTUR",
  nota: "NOTA",
  "faktur-pembelian": "FAKTUR PEMBELIAN",
  "nota-pembelian": "NOTA PEMBELIAN",
};

/** dd/mm/yyyy (atau ISO) → { d, m, y }; kosong → hari ini */
function splitDate(raw: string): { d: string; m: string; y: string } {
  const s = raw.trim();
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/) ?? null;
  if (m) return { d: m[3]!, m: m[2]!, y: m[1]! };
  const m2 = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m2) return { d: m2[1]!.padStart(2, "0"), m: m2[2]!.padStart(2, "0"), y: m2[3]! };
  const now = new Date();
  return {
    d: String(now.getDate()).padStart(2, "0"),
    m: String(now.getMonth() + 1).padStart(2, "0"),
    y: String(now.getFullYear()),
  };
}

/** nama file: dd-MM-yyyy-JENIS-NAMA PELANGGAN/PEMASOK.pdf */
function docFileName(kind: DocKind, date: string, party: string): string {
  const { d, m, y } = splitDate(date);
  const clean = party
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  const who = clean || "Umum";
  return `${d}-${m}-${y}-${DOC_LABEL[kind]}-${who}.pdf`;
}

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

  // folder tujuan: pakai yang ada (nama sama) atau buat baru
  let parentId = "root";
  const folderName = String(args.folder ?? "").trim();
  if (folderName) {
    const root = await client.list("root");
    const existing = root.folders.find((f) => f.name.toLowerCase() === folderName.toLowerCase());
    parentId = existing ? existing.id : (await client.createFolder(folderName, "root")).id;
  }

  const fileName = docFileName(docType, date, customerName);
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
