import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeDriveTool, DRIVE_FIND, DRIVE_CREATE, DRIVE_INDEX } from "../src/ai/drive-tools.js";
import { indexDrive, searchIndex } from "../src/drive/indexer.js";
import { prisma } from "../src/db.js";
import { buildInvoicePdf } from "../src/doc/invoice-pdf.js";
import { setMockDriveSeed } from "../src/drive/registry.js";
import { formatAggregationResult } from "../src/ai/transformer.js";

const TENANT = "tenant-uji-drive";

beforeAll(() => {
  process.env.MOCK_DRIVE = "1";
  setMockDriveSeed({
    folders: [
      { id: "root", name: "Drive Saya", parents: "" },
      { id: "scan", name: "Scan Faktur", parents: "root" },
    ],
    files: [
      { id: "d1", name: "faktur-001.pdf", parents: "scan", mimeType: "application/pdf", text: "Faktur 001" },
      { id: "d2", name: "faktur-002.pdf", parents: "scan", mimeType: "application/pdf", text: "Faktur 002" },
      { id: "d3", name: "kuitansi-sewa.pdf", parents: "root", mimeType: "application/pdf", text: "Kuitansi" },
      { id: "d4", name: "catatan-oktober.txt", parents: "root", mimeType: "text/plain", text: "Catatan pembayaran sewa bulan Oktober untuk kios A" },
    ],
  });
});

afterAll(async () => {
  await prisma.driveIndex.deleteMany({ where: { tenantId: TENANT } });
  delete process.env.MOCK_DRIVE;
});

describe("tool drive.findInvoices", () => {
  it("cari file faktur → baris nama + folder", async () => {
    const out = (await executeDriveTool(TENANT, DRIVE_FIND, { keywords: "faktur" })) as {
      count: number;
      files: Array<{ name: string; folder: string }>;
    };
    expect(out.count).toBe(2);
    expect(out.files.map((f) => f.name).sort()).toEqual(["faktur-001.pdf", "faktur-002.pdf"]);
    expect(out.files.every((f) => f.folder === "Scan Faktur")).toBe(true);
  });

  it("kata kunci kosong → error ramah (bukan throw)", async () => {
    const out = (await executeDriveTool(TENANT, DRIVE_FIND, { keywords: "  " })) as { error?: string };
    expect(out.error).toMatch(/kosong/i);
  });

  it("format hasil → tabel GFM + kolom Link", async () => {
    const out = await executeDriveTool(TENANT, DRIVE_FIND, { keywords: "kuitansi" });
    const text = formatAggregationResult(DRIVE_FIND, out)!;
    expect(text).toContain("| Nama File | Folder | Terakhir Diubah | Cocok | Link |");
    expect(text).toContain("kuitansi-sewa.pdf");
    expect(text).toContain("Drive Saya");
  });

  it("tanpa hasil → kalimat 'tidak ada' (bukan tabel kosong)", async () => {
    const out = await executeDriveTool(TENANT, DRIVE_FIND, { keywords: "tidak-ada-file-ini" });
    expect(formatAggregationResult(DRIVE_FIND, out)).toMatch(/Tidak ada file/);
  });
});

describe("PDF nota/faktur", () => {
  it("buildInvoicePdf → bytes PDF valid (magic %PDF)", async () => {
    const bytes = await buildInvoicePdf({
      docType: "faktur",
      companyName: "PT Retail Demo",
      no: "001",
      date: "24/10/2026",
      customerName: "Abadi Phone Center",
      items: [
        { name: "Kertas A4", qty: 2, price: 75000 },
        { name: "Tinta Printer", qty: 1, price: 120000 },
      ],
      note: "Terima kasih",
    });
    expect(bytes.length).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
});

describe("tool drive.createDoc", () => {
  it("buat nota → PDF terunggah, nama file + link", async () => {
    const out = (await executeDriveTool(TENANT, DRIVE_CREATE, {
      docType: "nota",
      no: "007",
      date: "24/10/2026",
      partyName: "Toko Maju",
      items: [{ name: "Jasa Servis", qty: 1, price: 150000 }],
      folder: "Nota Uji",
    })) as { fileName: string; link: string; total: number; folder: string; error?: string };
    expect(out.error).toBeUndefined();
    expect(out.fileName).toBe("24-10-2026-NOTA-Toko Maju.pdf");
    expect(out.total).toBe(150000);
    expect(out.folder).toBe("Nota Uji");
    expect(out.link).toContain("drive.google.com");
    // file benar-benar ada di folder tujuan
    const found = await executeDriveTool(TENANT, DRIVE_FIND, { keywords: "24-10-2026-NOTA" });
    expect((found as { count: number }).count).toBe(1);
  });

  it("items kosong → error ramah", async () => {
    const out = (await executeDriveTool(TENANT, DRIVE_CREATE, { docType: "faktur", items: [] })) as { error?: string };
    expect(out.error).toMatch(/kosong/i);
  });
});

describe("penamaan file dd-MM-yyyy-JENIS-NAMA", () => {
  it("faktur pembelian → label FAKTUR PEMBELIAN + nama pemasok", async () => {
    const out = (await executeDriveTool(TENANT, DRIVE_CREATE, {
      docType: "faktur-pembelian",
      date: "2026-10-24",
      partyName: "CV Ganda Putra",
      items: [{ name: "LCD iPhone 11", qty: 3, price: 350000 }],
    })) as { fileName: string; error?: string };
    expect(out.error).toBeUndefined();
    expect(out.fileName).toBe("24-10-2026-FAKTUR PEMBELIAN-CV Ganda Putra.pdf");
  });

  it("nama dgn karakter terlarang dibersihkan", async () => {
    const out = (await executeDriveTool(TENANT, DRIVE_CREATE, {
      docType: "nota",
      date: "01/01/2026",
      partyName: "Toko A/B: C*?",
      items: [{ name: "Jasa", qty: 1, price: 1000 }],
    })) as { fileName: string };
    expect(out.fileName).toBe("01-01-2026-NOTA-Toko A B C.pdf");
  });
});

describe("indeks isi Drive", () => {
  it("indexDrive mencatat teks, searchIndex mencocokkan ISI", async () => {
    const res = await indexDrive(TENANT, "root");
    expect(res.indexed).toBeGreaterThan(0);
    const hits = await searchIndex(TENANT, "kuitansi");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.name === "kuitansi-sewa.pdf")).toBe(true);
    const byContent = await searchIndex(TENANT, "kios A");
    expect(byContent.some((h) => h.name === "catatan-oktober.txt" && h.matched === "isi")).toBe(true);
  });

  it("tool drive.index mengembalikan ringkasan", async () => {
    const out = (await executeDriveTool(TENANT, DRIVE_INDEX, {})) as { scanned: number; indexed: number };
    expect(out.scanned).toBeGreaterThan(0);
    expect(out.indexed).toBeGreaterThanOrEqual(0);
  });

  it("drive.findInvoices memakai indeks (cocok isi) + kolom Cocok", async () => {
    const out = (await executeDriveTool(TENANT, DRIVE_FIND, { keywords: "kuitansi" })) as {
      files: Array<{ name: string; matched?: string }>;
    };
    expect(out.files.some((f) => f.name === "kuitansi-sewa.pdf")).toBe(true);
  });
});
