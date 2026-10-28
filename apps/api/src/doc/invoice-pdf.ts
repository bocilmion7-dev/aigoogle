import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

export interface InvoiceItem {
  name: string;
  qty: number;
  price: number;
}

export type DocKind = "faktur" | "nota" | "faktur-pembelian" | "nota-pembelian";

export interface InvoiceDocInput {
  docType: DocKind;
  companyName: string;
  no: string;
  /** dd/mm/yyyy (atau kosong → hari ini) */
  date: string;
  customerName: string;
  /** label pihak lawan: "Kepada" (penjualan) / "Dari" (pembelian) */
  partyLabel?: string;
  items: InvoiceItem[];
  note?: string;
  /**
   * Opsional — teks status singkat (mis. "LUNAS", "MENUNGGU PEMBAYARAN").
   * Ditampilkan sebagai badge berwarna di kartu meta.
   */
  status?: string;
}

const TITLE: Record<DocKind, string> = {
  faktur: "FAKTUR",
  nota: "NOTA",
  "faktur-pembelian": "FAKTUR PEMBELIAN",
  "nota-pembelian": "NOTA PEMBELIAN",
};

const rp = (n: number): string => "Rp" + Math.round(n).toLocaleString("id-ID");

const today = (): string => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

/** Potong teks agar muat pada lebar maksimum (tambahkan elipsis). */
function ellipsize(font: PDFFont, size: number, text: string, maxW: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxW) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

/** Inisial 1–2 huruf pertama dari nama (untuk monogram kop). */
function initials(name: string): string {
  const parts = String(name || "A")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "A";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/** Pasangan warna badge berdasarkan teks status. */
function statusColors(status: string): { bg: ReturnType<typeof rgb>; fg: ReturnType<typeof rgb> } {
  const s = status.toLowerCase();
  if (/(lunas|settlement|capture|paid|aktif|success)/.test(s)) {
    return { bg: rgb(0.86, 0.95, 0.9), fg: rgb(0.08, 0.4, 0.22) }; // hijau lembut
  }
  if (/(batal|cancel|deny|expire|failure|gagal|berakhir)/.test(s)) {
    return { bg: rgb(0.99, 0.9, 0.89), fg: rgb(0.62, 0.15, 0.12) }; // merah lembut
  }
  return { bg: rgb(0.99, 0.95, 0.86), fg: rgb(0.55, 0.35, 0.05) }; // kuning lembut (pending)
}

/** buat PDF nota/faktur profesional (A4, satu halaman) → bytes siap diunggah */
export async function buildInvoicePdf(input: InvoiceDocInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.11, 0.1, 0.09);
  const muted = rgb(0.47, 0.45, 0.42);
  const faint = rgb(0.88, 0.87, 0.85);
  const accent = rgb(0.918, 0.345, 0.047); // #ea580c
  const card = rgb(0.973, 0.969, 0.961); // #f8f7f5
  const headBg = rgb(0.129, 0.129, 0.137); // #212123
  const zebra = rgb(0.969, 0.965, 0.957); // #f7f6f4
  const white = rgb(1, 1, 1);

  const W = page.getWidth();
  const H = page.getHeight();
  const M = 48;
  const CW = W - 2 * M;

  const text = (s: string, x: number, y: number, size = 10, f = font, color = ink) =>
    page.drawText(s, { x, y, size, font: f, color });
  const center = (s: string, xMid: number, y: number, size: number, f: PDFFont, color: ReturnType<typeof rgb>) =>
    page.drawText(s, { x: xMid - f.widthOfTextAtSize(s, size) / 2, y, size, font: f, color });
  const right = (s: string, xRight: number, y: number, size = 10, f = font, color = ink) =>
    page.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y, size, font: f, color });
  const hline = (y: number, thickness = 0.8, color = faint) =>
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness, color });

  // ── pita aksen atas ──
  page.drawRectangle({ x: 0, y: H - 7, width: W, height: 7, color: accent });

  const title = TITLE[input.docType];
  const companyName = input.companyName || "Perusahaan";
  let y = H - M - 4;

  // ── kop: monogram + perusahaan + judul dokumen ──
  const monoSize = 34;
  const monoCx = M + monoSize / 2;
  const monoCy = y + 5;
  page.drawCircle({ x: monoCx, y: monoCy, size: monoSize / 2, color: accent });
  center(initials(companyName), monoCx, monoCy - 5.5, 13, bold, white);

  const nameX = M + monoSize + 12;
  const nameMaxW = W - M - nameX - 190;
  text(ellipsize(bold, 16, companyName, nameMaxW), nameX, y, 16, bold, ink);
  y -= 14;
  text("Dokumen resmi elektronik", nameX, y, 8.5, font, muted);

  right(title, W - M, y + 14, 21, bold, accent);
  right(`No. ${input.no}`, W - M, y, 9, bold, muted);

  // ── blok informasi: pihak lawan (kiri) + kartu meta (kanan) ──
  y -= 32;
  const partyLabel = (input.partyLabel ?? "Kepada").toUpperCase();
  text(partyLabel, M, y, 8, bold, muted);
  text(ellipsize(bold, 13, input.customerName || "-", 230), M, y - 18, 13, bold, ink);

  const cardX = W - M - 190;
  const cardW = 190;
  const cardTop = y + 4;
  const hasBadge = !!input.status;
  const cardH = hasBadge ? 76 : 56;
  page.drawRectangle({ x: cardX, y: cardTop - cardH, width: cardW, height: cardH, color: card });
  page.drawRectangle({ x: cardX, y: cardTop - cardH, width: 3, height: cardH, color: accent });
  text("Nomor", cardX + 14, cardTop - 19, 8.5, font, muted);
  right(ellipsize(bold, 9.5, input.no, cardW - 90), cardX + cardW - 14, cardTop - 19, 9.5, bold, ink);
  text("Tanggal", cardX + 14, cardTop - 39, 8.5, font, muted);
  right(input.date || today(), cardX + cardW - 14, cardTop - 39, 9.5, bold, ink);
  if (hasBadge) {
    const label = String(input.status).toUpperCase().slice(0, 22);
    const labelW = bold.widthOfTextAtSize(label, 8) + 16;
    const bx = cardX + 14;
    const by = cardTop - 66;
    const { bg, fg } = statusColors(String(input.status));
    page.drawRectangle({ x: bx, y: by, width: labelW, height: 16, color: bg });
    text(label, bx + 8, by + 5, 8, bold, fg);
  }

  y = Math.min(y - 28, cardTop - cardH) - 18;
  hline(y);
  y -= 24;

  // ── tabel item ──
  const colNo = M + 10;
  const colName = M + 38;
  const nameMaxW2 = 200;
  const colQty = M + 300;
  const colPrice = M + 400;
  const colSum = W - M - 12;

  const headH = 22;
  page.drawRectangle({ x: M, y: y - headH, width: CW, height: headH, color: headBg });
  const hy = y - 15;
  text("No", colNo, hy, 8.5, bold, white);
  text("Barang / Jasa", colName, hy, 8.5, bold, white);
  right("Qty", colQty, hy, 8.5, bold, white);
  right("Harga Satuan", colPrice, hy, 8.5, bold, white);
  right("Jumlah", colSum, hy, 8.5, bold, white);
  y -= headH;

  let total = 0;
  const items = input.items.slice(0, 30);
  const rowH = 16;
  for (let i = 0; i < items.length; i++) {
    if (y - rowH < M + 130) break;
    const it = items[i]!;
    const qty = Number(it.qty) || 0;
    const price = Number(it.price) || 0;
    const sum = qty * price;
    total += sum;
    if (i % 2 === 1) {
      page.drawRectangle({ x: M, y: y - rowH, width: CW, height: rowH, color: zebra });
    }
    const ry = y - 11.5;
    text(String(i + 1), colNo, ry, 9, font, muted);
    text(ellipsize(font, 9, String(it.name), nameMaxW2), colName, ry, 9, font, ink);
    right(String(qty), colQty, ry, 9, font, ink);
    right(rp(price), colPrice, ry, 9, font, ink);
    right(rp(sum), colSum, ry, 9, bold, ink);
    y -= rowH;
  }
  hline(y, 0.8, faint);

  // ── panel total ──
  y -= 22;
  const totalW = 250;
  const totalX = W - M - totalW;
  const totalH = 38;
  page.drawRectangle({ x: totalX, y: y - totalH, width: totalW, height: totalH, color: headBg });
  page.drawRectangle({ x: totalX, y: y - totalH, width: 3, height: totalH, color: accent });
  text("TOTAL", totalX + 16, y - 24, 11, bold, white);
  right(rp(total), W - M - 16, y - 25, 13, bold, white);
  y -= totalH;

  // ── catatan ──
  if (input.note) {
    y -= 26;
    text("CATATAN", M, y, 8, bold, muted);
    y -= 14;
    text(ellipsize(font, 9, String(input.note), CW), M, y, 9, font, muted);
  }

  // ── footer ──
  hline(M + 16, 0.8, faint);
  text("Dokumen elektronik ini sah tanpa tanda tangan fisik.", M, M - 4, 8, font, muted);
  right(`Dibuat oleh AI Asisten · ${today()}`, W - M, M - 4, 8, font, muted);

  return doc.save();
}
