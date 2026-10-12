import JSZip from "jszip";

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

/** Ekstrak teks lokal (tanpa AI) untuk dokumen berbasis teks. Gambar/PDF → "" (butuh vision). */
export async function extractText(buffer: Buffer, kind: DocKind): Promise<string> {
  switch (kind) {
    case "markdown":
    case "text":
      return buffer.toString("utf8");
    case "docx":
      return zipXmlText(buffer, (n) => n === "word/document.xml");
    case "pptx":
      return zipXmlText(buffer, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    case "doc":
    case "ppt":
      return legacyBinaryText(buffer);
    case "image":
    case "pdf":
    case "unknown":
      return "";
  }
}
