import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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
}

const rp = (n: number): string =>
  "Rp" + Math.round(n).toLocaleString("id-ID").replace(/\./g, ".");

const today = (): string => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

/** buat PDF nota/faktur sederhana (A4, satu halaman) → bytes siap diunggah */
export async function buildInvoicePdf(input: InvoiceDocInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.42, 0.42, 0.42);
  const line = rgb(0.85, 0.85, 0.85);

  const W = page.getWidth();
  const M = 48; // margin
  let y = page.getHeight() - M;

  const text = (s: string, x: number, yy: number, size = 10, f = font, color = ink) =>
    page.drawText(s, { x, y: yy, size, font: f, color });

  // header: perusahaan + judul dokumen
  text(input.companyName || "Perusahaan", M, y, 16, bold);
  const title =
    input.docType === "faktur"
      ? "FAKTUR"
      : input.docType === "nota"
        ? "NOTA"
        : input.docType === "faktur-pembelian"
          ? "FAKTUR PEMBELIAN"
          : "NOTA PEMBELIAN";
  const titleW = bold.widthOfTextAtSize(title, 20);
  text(title, W - M - titleW, y, 20, bold);
  y -= 18;
  text(`${title} ${input.no}`, M, y, 10, font, muted);
  y -= 28;

  // blok informasi
  const info: Array<[string, string]> = [
    [input.partyLabel ?? "Kepada", input.customerName || "-"],
    ["Tanggal", input.date || today()],
    ["Nomor", input.no],
  ];
  for (const [k, v] of info) {
    text(`${k}`, M, y, 9, font, muted);
    text(`: ${v}`, M + 64, y, 10, font);
    y -= 15;
  }
  y -= 8;

  // garis
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: line });
  y -= 16;

  // header tabel
  const colNo = M;
  const colName = M + 26;
  const colQty = W - M - 190;
  const colPrice = W - M - 120;
  const colSum = W - M;
  text("No", colNo, y, 9, bold);
  text("Barang / Jasa", colName, y, 9, bold);
  text("Qty", colQty, y, 9, bold);
  text("Harga", colPrice, y, 9, bold);
  const sumHeadW = bold.widthOfTextAtSize("Jumlah", 9);
  text("Jumlah", colSum - sumHeadW, y, 9, bold);
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: line });
  y -= 14;

  // baris item (maks 30 baris agar tetap 1 halaman)
  let total = 0;
  const items = input.items.slice(0, 30);
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const qty = Number(it.qty) || 0;
    const price = Number(it.price) || 0;
    const sum = qty * price;
    total += sum;
    const name = String(it.name).length > 42 ? `${String(it.name).slice(0, 41)}…` : String(it.name);
    text(String(i + 1), colNo, y, 9);
    text(name, colName, y, 9);
    text(String(qty), colQty, y, 9);
    text(rp(price), colPrice, y, 9);
    const sumStr = rp(sum);
    text(sumStr, colSum - font.widthOfTextAtSize(sumStr, 9), y, 9);
    y -= 14;
    if (y < M + 120) break;
  }

  y -= 4;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: line });
  y -= 18;

  // total
  const totalStr = rp(total);
  const totalLabelW = bold.widthOfTextAtSize("TOTAL", 11);
  text("TOTAL", colSum - 150, y, 11, bold);
  text(totalStr, colSum - bold.widthOfTextAtSize(totalStr, 11), y, 11, bold);
  void totalLabelW;

  // catatan + footer
  if (input.note) {
    y -= 26;
    text("Catatan:", M, y, 9, bold);
    y -= 13;
    text(String(input.note).slice(0, 160), M, y, 9, font, muted);
  }
  text(`Dibuat otomatis oleh AI Asisten · ${today()}`, M, M, 8, font, muted);

  return doc.save();
}
