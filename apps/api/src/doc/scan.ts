import { withModelFailover } from "../ai/model-pool.js";
import { GeminiHttpError } from "../ai/gemini-error.js";
import { RealNvidiaClient } from "../ai/nvidia.js";
import { env } from "../env.js";
import type { GeminiContent, GeminiPart } from "../ai/gemini-types.js";
import type { DocKind } from "./extract.js";
import { extractPdfImages, VISION_KINDS } from "./extract.js";

export type DocType = "faktur" | "nota" | "kwitansi" | "lainnya";
export type ScanTarget = "salesInvoice" | "salesReceipt";

export interface ScanItem {
  name: string;
  qty?: number;
  price?: number;
}
export interface ScanFields {
  docType: DocType;
  customerName: string;
  date: string;
  no: string;
  total: number | null;
  description: string;
  items: ScanItem[];
}
export interface ScanResult {
  rawText: string;
  fields: ScanFields;
  target: ScanTarget | null;
  /** true kalau ekstraksi AI (Gemini) berhasil; false = fallback manual */
  geminiOk: boolean;
}

const FIELD_PROMPT = `Kamu membaca dokumen akuntansi Indonesia. Ekstrak data berikut dan balas HANYA dengan JSON valid tanpa markdown:
{
  "text": "transkripsi isi dokumen (singkat, pertahankan angka & nomor)",
  "docType": "faktur" | "nota" | "kwitansi" | "lainnya",
  "customerName": "nama pelanggan/pembeli bila ada, kosongkan jika tidak",
  "date": "YYYY-MM-DD bila ada, kosongkan jika tidak",
  "no": "nomor dokumen bila ada, kosongkan jika tidak",
  "total": angka total tanpa titik/koma atau null,
  "description": "ringkasan satu kalimat",
  "items": [{"name": "...", "qty": 1, "price": 1000}]
}
Klasifikasi: faktur = invoice penjualan; nota = nota/tunai penjualan; kwitansi = bukti pembayaran/kwitansi/bukti transfer.`;

export function suggestedTarget(docType: DocType): ScanTarget | null {
  if (docType === "faktur") return "salesInvoice";
  if (docType === "nota" || docType === "kwitansi") return "salesReceipt";
  return null;
}

function emptyFields(): ScanFields {
  return { docType: "lainnya", customerName: "", date: "", no: "", total: null, description: "", items: [] };
}

function coerce(raw: Record<string, unknown>): { rawText: string; fields: ScanFields } {
  const docType: DocType = ["faktur", "nota", "kwitansi"].includes(String(raw.docType))
    ? (raw.docType as DocType)
    : "lainnya";
  const num = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v.replace(/[^\d.-]/g, ""));
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    return null;
  };
  const items = Array.isArray(raw.items)
    ? raw.items.slice(0, 50).map((i) => {
        const it = (i ?? {}) as Record<string, unknown>;
        return {
          name: String(it.name ?? "").slice(0, 200),
          qty: num(it.qty),
          price: num(it.price),
        } as ScanItem;
      })
    : [];
  return {
    rawText: String(raw.text ?? "").slice(0, 8000),
    fields: {
      docType,
      customerName: String(raw.customerName ?? "").slice(0, 200),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date ?? "")) ? String(raw.date) : "",
      no: String(raw.no ?? "").slice(0, 60),
      total: num(raw.total),
      description: String(raw.description ?? "").slice(0, 500),
      items: items.filter((i) => i.name),
    },
  };
}

function parseJsonLoose(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const v = JSON.parse(cleaned) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* coba ekstrak objek */
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const v = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* gagal */
    }
  }
  return null;
}

/**
 * Satu panggilan model dengan failover utk part multimodal (gambar/PDF/teks + prompt).
 * Urutan: 9Router/ocfree (mimo rank-0 mendukung vision) → NVIDIA → Gemini langsung.
 * Model non-vision yg membalas tanpa JSON dianggap gagal → rotasi ke kandidat berikutnya.
 */
async function generateText(parts: GeminiPart[], prompt: string, needJson: boolean): Promise<string> {
  const contents: GeminiContent[] = [{ role: "user", parts: [...parts, { text: prompt }] }];
  return await withModelFailover("generate", async (c) => {
    if (c.provider === "router" || c.provider === "nvidia") {
      const client =
        c.provider === "router"
          ? new RealNvidiaClient(env.ROUTER_API_KEY, env.ROUTER_BASE_URL)
          : new RealNvidiaClient(env.NVIDIA_API_KEY);
      const { parts: out } = await client.generate({ contents, model: c.model });
      const text = out.find((p) => p.text)?.text ?? "";
      if (needJson && !text.includes("{")) {
        // balasan "saya tidak bisa melihat gambar" dsb → coba model berikutnya
        throw new GeminiHttpError(502, "model tidak mengembalikan JSON (kemungkinan tanpa visi)");
      }
      return text;
    }
    // Gemini langsung (fallback terakhir)
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${c.model}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": process.env.GEMINI_API_KEY || "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ contents, generationConfig: { temperature: 0 } }),
      }
    );
    if (!res.ok) throw new GeminiHttpError(res.status, await res.text().catch(() => ""));
    const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  });
}

async function geminiFields(opts: {
  apiKey?: string;
  parts: GeminiPart[];
}): Promise<{ rawText: string; fields: ScanFields } | null> {
  let text = "";
  try {
    text = await generateText(opts.parts, FIELD_PROMPT, true);
  } catch {
    return null; // semua model gagal → fallback ekstraksi lokal
  }
  const raw = parseJsonLoose(text);
  return raw ? coerce(raw) : null;
}

/** Baca dokumen (gambar/PDF via vision; dokumen teks via ekstraksi lokal) + ekstrak field akuntansi. */
export async function scanDocument(opts: {
  buffer: Buffer;
  kind: DocKind;
  mime: string;
  fileName: string;
  apiKey?: string;
  localText: string;
}): Promise<ScanResult> {
  const { buffer, kind, mime, fileName, localText } = opts;
  const parts: GeminiPart[] = [];
  let useLocalText = false;
  if (kind === "pdf") {
    if (localText.trim()) {
      // PDF berbasis teks → cukup kirim teksnya (tanpa vision)
      parts.push({ text: `Dokumen: ${fileName}\n\nIsi:\n${localText.slice(0, 12_000)}` });
      useLocalText = true;
    } else {
      // PDF hasil scan → kirim halaman sebagai gambar JPEG tertanam
      const images = extractPdfImages(buffer);
      if (!images.length) return { rawText: localText, fields: emptyFields(), target: null, geminiOk: false };
      for (const img of images) {
        parts.push({ inlineData: { mimeType: "image/jpeg", data: img.toString("base64") } });
      }
      parts.push({ text: `Dokumen: ${fileName}` });
    }
  } else if (VISION_KINDS.has(kind)) {
    parts.push({ inlineData: { mimeType: mime, data: buffer.toString("base64") } });
    parts.push({ text: `Dokumen: ${fileName}` });
  } else {
    parts.push({ text: `Dokumen: ${fileName}\n\nIsi:\n${localText.slice(0, 12_000)}` });
    useLocalText = true;
  }
  const out = await geminiFields({ parts });
  if (out) {
    if (useLocalText && localText.trim()) out.rawText = localText;
    return { ...out, target: suggestedTarget(out.fields.docType), geminiOk: true };
  }
  return { rawText: localText, fields: emptyFields(), target: null, geminiOk: false };
}
