import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { detectKind, extractText } from "../src/doc/extract.js";
import { suggestedTarget } from "../src/doc/scan.js";

async function docxBuffer(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", `<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

async function pptxBuffers(slides: string[]): Promise<Buffer> {
  const zip = new JSZip();
  slides.forEach((s, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, `<a:sld><a:t>${s}</a:t></a:sld>`));
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

describe("detectKind", () => {
  it("deteksi dari mime & ekstensi", () => {
    expect(detectKind("nota.jpg", "image/jpeg")).toBe("image");
    expect(detectKind("laporan.pdf", "application/octet-stream")).toBe("pdf");
    expect(detectKind("dok.docx", "application/octet-stream")).toBe("docx");
    expect(detectKind("deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe("pptx");
    expect(detectKind("lama.doc", "application/msword")).toBe("doc");
    expect(detectKind("readme.md", "text/plain")).toBe("markdown");
    expect(detectKind("catatan.txt", "text/plain")).toBe("text");
    expect(detectKind("gambar", "image/webp; charset=binary")).toBe("image");
    expect(detectKind("acara.zip", "application/zip")).toBe("unknown");
  });
});

describe("extractText", () => {
  it("markdown & text langsung", async () => {
    expect(await extractText(Buffer.from("# Judul\nIsi dokumen"), "markdown")).toContain("Judul");
    expect(await extractText(Buffer.from("teks biasa"), "text")).toContain("teks biasa");
  });

  it("docx → teks dari word/document.xml", async () => {
    const out = await extractText(await docxBuffer("Faktur penjualan 123"), "docx");
    expect(out).toContain("Faktur penjualan 123");
  });

  it("pptx → gabungan semua slide berurutan", async () => {
    const out = await extractText(await pptxBuffers(["Slide satu", "Slide dua"]), "pptx");
    expect(out.indexOf("Slide satu")).toBeLessThan(out.indexOf("Slide dua"));
  });

  it("doc/ppt legacy → heuristik string panjang", async () => {
    const buf = Buffer.from("AAAA\x00\x01Kwitansi pembayaran vendor utama\x00BBBB\x00\x00lallbackup singkat\x00CCCC", "latin1");
    const out = await extractText(buf, "doc");
    expect(out).toContain("Kwitansi pembayaran vendor utama");
  });

  it("image/pdf → kosong (butuh vision)", async () => {
    expect(await extractText(Buffer.from("x"), "image")).toBe("");
    expect(await extractText(Buffer.from("x"), "pdf")).toBe("");
  });
});

describe("suggestedTarget", () => {
  it("faktur → faktur penjualan; nota/kwitansi → penerimaan kas", () => {
    expect(suggestedTarget("faktur")).toBe("salesInvoice");
    expect(suggestedTarget("nota")).toBe("salesReceipt");
    expect(suggestedTarget("kwitansi")).toBe("salesReceipt");
    expect(suggestedTarget("lainnya")).toBeNull();
  });
});
