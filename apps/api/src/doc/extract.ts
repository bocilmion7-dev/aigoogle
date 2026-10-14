import JSZip from "jszip";
import { PDFParse } from "pdf-parse";

export type DocKind =
  | "image"
  | "pdf"
  | "docx"
  | "pptx"
  | "doc"
  | "ppt"
  | "markdown"
  | "text"
  | "unknown";

export const VISION_KINDS: ReadonlySet<DocKind> = new Set<DocKind>(["image", "pdf"]);

export function detectKind(fileName: string, mime: string): DocKind {
  const m = mime.split(";")[0].trim().toLowerCase();
  const n = fileName.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || n.endsWith(".docx"))
    return "docx";
  if (m === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || n.endsWith(".pptx"))
    return "pptx";
  if (m === "application/msword" || n.endsWith(".doc")) return "doc";
  if (m === "application/vnd.ms-powerpoint" || n.endsWith(".ppt")) return "ppt";
  if (m === "text/markdown" || n.endsWith(".md")) return "markdown";
  if (m.startsWith("text/") || /\.(txt|csv|log|tsv)$/.test(n)) return "text";
  return "unknown";
}

function xmlToText(xml: string): string {
  return xml
    .replace(/<(w|a):p(\s|>)/g, "\n")
    .replace(/<(w|a):tab[^/>]*\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function zipXmlText(buffer: Buffer, filter: (name: string) => boolean): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files)
    .filter((n) => !zip.files[n].dir && filter(n))
    .sort((a, b) => {
      const na = Number(a.match(/(\d+)/)?.[1] ?? 0);
      const nb = Number(b.match(/(\d+)/)?.[1] ?? 0);
      return na - nb;
    });
  const parts: string[] = [];
  for (const name of names) {
    const xml = await zip.files[name].async("string");
    const text = xmlToText(xml);
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

function legacyBinaryText(buffer: Buffer): string {
  const runs = buffer.toString("latin1").match(/[\x20-\x7E\u00A0-\u024F\u2010-\u203A]{8,}/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of runs) {
    const t = r.trim();
    if (t.length >= 8 && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.join("\n").slice(0, 20_000);
}

/** Ekstrak teks dari PDF berbasis teks (pdf.js). PDF hasil scan → "" (lanjut ke OCR gambar). */
async function pdfText(buffer: Buffer): Promise<string> {
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const r = await parser.getText();
      return (r.text ?? "").trim();
    } finally {
      await parser.destroy().catch(() => {});
    }
  } catch {
    return "";
  }
}

/**
 * Ekstrak gambar JPEG yang tertanam di PDF (PDF hasil scan menyimpan halaman
 * sebagai gambar DCTDecode) — tanpa dependensi ekstra: cari pasangan SOI/EOI.
 * Ambil maks 3 gambar terbesar (ukuran ≥ 8KB) untuk dikirim ke model vision.
 */
export function extractPdfImages(buffer: Buffer, max = 3): Buffer[] {
  const found: Buffer[] = [];
  let i = 0;
  while (i < buffer.length - 3 && found.length < 12) {
    if (buffer[i] === 0xff && buffer[i + 1] === 0xd8 && buffer[i + 2] === 0xff) {
      // cari EOI
      let end = -1;
      for (let j = i + 3; j < buffer.length - 1; j++) {
        if (buffer[j] === 0xff && buffer[j + 1] === 0xd9) {
          end = j + 2;
          break;
        }
      }
      if (end > i) {
        const img = buffer.subarray(i, end);
        if (img.length >= 8 * 1024) found.push(Buffer.from(img));
        i = end;
        continue;
      }
    }
    i++;
  }
  // ambil yang terbesar dulu lalu urutkan kembali sesuai posisi di dokumen
  return found
    .sort((a, b) => b.length - a.length)
    .slice(0, max)
    .sort((a, b) => buffer.indexOf(a) - buffer.indexOf(b));
}

/** PDF dianggap punya teks nyata bila cukup banyak karakter alfanumerik. */
function hasRealText(text: string): boolean {
  return (text.match(/[A-Za-z0-9]/g) ?? []).length >= 40;
}

/** Ekstrak teks lokal (tanpa AI). PDF berbasis teks → teksnya; PDF scan/gambar → "" (butuh vision). */
export async function extractText(buffer: Buffer, kind: DocKind): Promise<string> {
  switch (kind) {
    case "markdown":
    case "text":
      return buffer.toString("utf8");
    case "pdf":
      return hasRealText(await pdfText(buffer)) ? await pdfText(buffer) : "";
    case "docx":
      return zipXmlText(buffer, (n) => n === "word/document.xml");
    case "pptx":
      return zipXmlText(buffer, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    case "doc":
    case "ppt":
      return legacyBinaryText(buffer);
    case "image":
    case "unknown":
      return "";
  }
}
