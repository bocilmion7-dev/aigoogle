import { withModelFailover } from "../ai/model-pool.js";
import { getModuleModel } from "../ai/module-model.js";
import { LlmHttpError } from "../ai/llm-error.js";
import type { LLMContent, LLMPart } from "../ai/llm-types.js";
import type { DocKind } from "./extract.js";
import { extractPdfImages, VISION_KINDS } from "./extract.js";
import { ocrUsable } from "./ocr.js";

export type DocType = "faktur" | "nota" | "kwitansi" | "lainnya";
export type ScanTarget =
  | "salesInvoice"
  | "salesReceipt"
  | "purchaseInvoice"
  | "expense"
  | "bankTransfer";

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
  /** saran mentah AI (bisa modul yang belum didukung atau "none") */
  aiModule?: string | null;
  /** alasan AI memilih target + tingkat yakin (bila ada) */
  targetReason?: string;
  confidence?: number;
  /** true kalau ekstraksi AI berhasil; false = fallback manual */
  aiOk: boolean;
}

/** Modul saran dari AI → target penyimpanan yang didukung endpoint entries. */
const KNOWN_TARGETS = new Set([
  "salesInvoice",
  "salesReceipt",
  "purchaseInvoice",
  "expense",
  "bankTransfer",
]);
/** Modul yang dikenali AI tapi belum didukung penyimpanan → ditampilkan sbg info. */
export const UNSUPPORTED_TARGETS = new Set([
  "salesOrder",
  "salesReturn",
  "purchasePayment",
  "receiveItem",
  "purchaseReturn",
  "otherDeposit",
  "otherPayment",
  "itemAdjustment",
]);

const FIELD_PROMPT = `Kamu membaca dokumen akuntansi yang DITERIMA karyawan perusahaan (bisa dari pelanggan, pemasok, bank, atau internal).
Klasifikasikan dokumen dan tentukan modul Accurate Online yang tepat untuk mencatatnya.

Balas HANYA JSON valid tanpa markdown:
{
  "text": "transkripsi isi dokumen (singkat, pertahankan angka & nomor)",
  "docType": "faktur" | "nota" | "kwitansi" | "lainnya",
  "customerName": "nama pelanggan ATAU pemasok/pembeli yang tertera, kosongkan jika tidak",
  "date": "YYYY-MM-DD bila ada, kosongkan jika tidak",
  "no": "nomor dokumen bila ada, kosongkan jika tidak",
  "total": angka total tanpa titik/koma atau null,
  "description": "ringkasan satu kalimat",
  "items": [{"name": "...", "qty": 1, "price": 1000}],
  "suggestedModule": "modul dari daftar di bawah",
  "confidence": 0.0 s.d. 1.0,
  "targetReason": "satu kalimat alasan pemilihan modul"
}

DAFTAR MODUL (pilih satu, atau "none" bila dokumen tidak perlu dicatat):
- "salesInvoice"    — penjualan KITA ke pelanggan yang ada rincian barangnya (faktur penjualan, nota jual beritem, tunai maupun tempo)
- "salesReceipt"    — uang MASUK dari pelanggan: kwitansi pelunasan, bukti transfer dari pelanggan, DP/uang muka, nota tanpa rincian barang
- "salesOrder"      — PO/pesanan tertulis dari pelanggan (belum jadi penjualan)
- "salesReturn"     — surat retur/pengembalian barang dari pelanggan
- "purchaseInvoice" — faktur/nota BELI dari pemasok yang ada rincian barangnya (kita pembeli)
- "purchasePayment" — bukti transfer/kwitansi KITA bayar ke pemasok
- "expense"         — struk/kwitansi biaya operasional: bensin, ATK, listrik, taxi, makan, klaim karyawan
- "otherDeposit"    — uang masuk bukan dari penjualan (setoran modal, bunga, refund)
- "bankTransfer"    — mutasi antar rekening MILIK SENDIRI (nama pengirim & penerima sama-sama perusahaan)
- "itemAdjustment"  — berita acara barang rusak/hilang/salah hitung
- "none"            — dokumen hanya arsip (kwitansi dari pemasok utk pembayaran yg sudah tercatat, salinan dokumen sendiri, surat jalan tanpa transaksi)

ATURAN PENENTU:
1. Posisi perusahaan menentukan arah: yang MENERBITKAN faktur berarti LAWAN transaksi. Faktur diterbitkan pemasok → purchaseInvoice; diterbitkan atas nama kita → salesInvoice.
2. Dokumen berisi BARANG → masuk modul invoice (bukan penerimaan kas) agar stok tercatat.
3. Dokumen hanya UANG (kwitansi/transfer) → modul receipt/payment/deposit/transfer sesuai arah & pihak.
4. Transfer antar rekening sendiri → bankTransfer. Transfer dari pihak lain → sesuai konteks (pelanggan=salesReceipt, pemasok=purchasePayment).
5. Ragu antara 2 modul → pilih yang paling mungkin, turunkan confidence (mis. 0.4-0.5), jelaskan di targetReason.
6. Dokumen jelas hanya arsip → "none".`;

export function suggestedTarget(docType: DocType): ScanTarget | null {
  if (docType === "faktur") return "salesInvoice";
  if (docType === "nota" || docType === "kwitansi") return "salesReceipt";
  return null;
}

function emptyFields(): ScanFields {
  return { docType: "lainnya", customerName: "", date: "", no: "", total: null, description: "", items: [] };
}

function coerce(raw: Record<string, unknown>): {
  rawText: string;
  fields: ScanFields;
  /** modul yang dikenali (didukung maupun belum); null kalau tak dikenal */
  suggestedModule: string | null;
  confidence?: number;
  targetReason?: string;
} {
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
    suggestedModule: KNOWN_TARGETS.has(String(raw.suggestedModule)) || UNSUPPORTED_TARGETS.has(String(raw.suggestedModule))
      ? String(raw.suggestedModule)
      : null,
    confidence: typeof raw.confidence === "number" && raw.confidence >= 0 && raw.confidence <= 1 ? raw.confidence : undefined,
    targetReason: String(raw.targetReason ?? "").slice(0, 300) || undefined,
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
 * preferredModel = model hasil setting modul (uploadImage / uploadDocument).
 * Model non-vision yg membalas tanpa JSON dianggap gagal → rotasi ke kandidat berikutnya.
 */
async function generateText(
  parts: LLMPart[],
  prompt: string,
  needJson: boolean,
  preferredModel?: string
): Promise<string> {
  const contents: LLMContent[] = [{ role: "user", parts: [...parts, { text: prompt }] }];
  return await withModelFailover(
    "generate",
    async (c) => {
      const { parts: out } = await c.client.generate({ contents, model: c.model });
      const text = out.find((p) => p.text)?.text ?? "";
      if (needJson && !text.includes("{")) {
        // balasan "saya tidak bisa melihat gambar" dsb → coba model berikutnya
        throw new LlmHttpError(502, "model tidak mengembalikan JSON (kemungkinan tanpa visi)");
      }
      return text;
    },
    preferredModel || undefined
  );
}

export interface ScanHint {
  /** jenis yang dipilih pengguna (faktur/nota/kwitansi/screenshot-pembayaran/jenis kustom) */
  docType?: string;
  /** arah dana utk screenshot pembayaran: masuk|keluar|antar */
  direction?: string;
  /** label jenis kustom */
  label?: string;
}

async function aiFields(opts: {
  parts: LLMPart[];
  /** modul penentu model: gambar → vision, dokumen → teks/vision sesuai jenis */
  module: "uploadImage" | "uploadDocument";
  hint?: ScanHint;
}): Promise<Awaited<ReturnType<typeof coerce>> | null> {
  let text = "";
  const hintLine = opts.hint
    ? `\n\nPETUNJUK PENGGUNA (konteks kuat, tetap verifikasi dari isi dokumen): jenis dokumen = "${
        opts.hint.label || opts.hint.docType || "tidak disebut"
      }"${opts.hint.direction ? `, arah dana = "${opts.hint.direction}"` : ""}.`
    : "";
  try {
    const preferred = await getModuleModel(opts.module);
    text = await generateText(opts.parts, FIELD_PROMPT + hintLine, true, preferred);
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
  localText: string;
  /** teks hasil OCR lokal (gambar) — dipakai lebih dulu, gagal → vision */
  ocrText?: string;
  hint?: ScanHint;
}): Promise<ScanResult> {
  const { buffer, kind, mime, fileName, localText, ocrText = "" } = opts;
  const parts: LLMPart[] = [];
  let useLocalText = false;
  if (kind === "pdf") {
    if (localText.trim()) {
      // PDF berbasis teks → cukup kirim teksnya (tanpa vision)
      parts.push({ text: `Dokumen: ${fileName}\n\nIsi:\n${localText.slice(0, 12_000)}` });
      useLocalText = true;
    } else {
      // PDF hasil scan → kirim halaman sebagai gambar JPEG tertanam
      const images = extractPdfImages(buffer);
      if (!images.length) return { rawText: localText, fields: emptyFields(), target: null, aiOk: false };
      for (const img of images) {
        parts.push({ inlineData: { mimeType: "image/jpeg", data: img.toString("base64") } });
      }
      parts.push({ text: `Dokumen: ${fileName}` });
    }
  } else if (kind === "image") {
    // OCR lokal dulu (murah & cepat); gagal/tak berarti → vision
    if (ocrUsable(ocrText)) {
      parts.push({ text: `Dokumen: ${fileName}\n\nHasil OCR:\n${ocrText.slice(0, 12_000)}` });
      useLocalText = true;
    } else {
      parts.push({ inlineData: { mimeType: mime, data: buffer.toString("base64") } });
      parts.push({ text: `Dokumen: ${fileName}` });
    }
  } else if (VISION_KINDS.has(kind)) {
    parts.push({ inlineData: { mimeType: mime, data: buffer.toString("base64") } });
    parts.push({ text: `Dokumen: ${fileName}` });
  } else {
    parts.push({ text: `Dokumen: ${fileName}\n\nIsi:\n${localText.slice(0, 12_000)}` });
    useLocalText = true;
  }
  const out = await aiFields({
    parts,
    module: kind === "image" ? "uploadImage" : "uploadDocument",
    hint: opts.hint,
  });
  if (out) {
    if (useLocalText) {
      const src = kind === "image" ? ocrText : localText;
      if (src.trim()) out.rawText = src;
    }
    const modul = out.suggestedModule;
    const target: ScanTarget | null =
      modul && KNOWN_TARGETS.has(modul)
        ? (modul as ScanTarget)
        : modul
          ? null // "none" / modul belum didukung → jangan pilih target lain diam-diam
          : suggestedTarget(out.fields.docType);
    return {
      rawText: out.rawText,
      fields: out.fields,
      target,
      aiModule: modul,
      targetReason: out.targetReason,
      confidence: out.confidence,
      aiOk: true,
    };
  }
  return { rawText: localText, fields: emptyFields(), target: null, aiOk: false };
}
