import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeDriveTool, DRIVE_FIND } from "../src/ai/drive-tools.js";
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
    ],
  });
});

afterAll(() => {
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
    expect(text).toContain("| Nama File | Folder | Terakhir Diubah | Link |");
    expect(text).toContain("kuitansi-sewa.pdf");
    expect(text).toContain("Drive Saya");
  });

  it("tanpa hasil → kalimat 'tidak ada' (bukan tabel kosong)", async () => {
    const out = await executeDriveTool(TENANT, DRIVE_FIND, { keywords: "tidak-ada-file-ini" });
    expect(formatAggregationResult(DRIVE_FIND, out)).toMatch(/Tidak ada file/);
  });
});
