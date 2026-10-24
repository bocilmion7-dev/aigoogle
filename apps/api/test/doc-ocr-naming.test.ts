import { describe, expect, it } from "vitest";
import { ocrImage, ocrUsable } from "../src/doc/ocr.js";
import { docFileName, cleanParty } from "../src/doc/naming.js";
import { folderNameFor, ensureFolder } from "../src/drive/folders.js";
import { MockDriveClient } from "../src/drive/mock-client.js";

describe("OCR lokal", () => {
  it("gambar rusak → teks kosong (fallback vision)", async () => {
    const text = await ocrImage(Buffer.from("ini bukan gambar"), "jpg");
    expect(text).toBe("");
  });

  it("ocrUsable menolak noise, menerima teks nyata", () => {
    expect(ocrUsable("  .. ,, -- ")).toBe(false);
    expect(ocrUsable("Faktur No 001 Toko Maju Total Rp1.500.000")).toBe(true);
  });
});

describe("penamaan & folder per jenis dokumen", () => {
  it("docFileName: dd-MM-yyyy-JENIS-NAMA.ext", () => {
    expect(docFileName("faktur", "24/10/2026", "Abadi Phone Center", "jpg")).toBe(
      "24-10-2026-FAKTUR-Abadi Phone Center.jpg"
    );
    expect(docFileName("screenshot-pembayaran", "2026-10-24", "Budi", "png")).toBe(
      "24-10-2026-SCREENSHOT PEMBAYARAN-Budi.png"
    );
    // jenis kustom → label apa adanya
    expect(docFileName("surat-jalan", "01/01/2026", "Toko A", "jpg", "Surat Jalan")).toBe(
      "01-01-2026-SURAT JALAN-Toko A.jpg"
    );
  });

  it("cleanParty membersihkan karakter terlarang", () => {
    expect(cleanParty("Toko A/B: C*?")).toBe("Toko A B C");
  });

  it("folderNameFor: jenis dikenal → folder baku, kustom → label", () => {
    expect(folderNameFor("faktur")).toBe("Faktur");
    expect(folderNameFor("nota")).toBe("Nota");
    expect(folderNameFor("kwitansi")).toBe("Kwitansi");
    expect(folderNameFor("screenshot-pembayaran")).toBe("Screenshot Pembayaran");
    expect(folderNameFor("faktur-pembelian")).toBe("Faktur Pembelian");
    expect(folderNameFor("surat-jalan", "Surat Jalan")).toBe("Surat Jalan");
  });

  it("ensureFolder memakai folder yang ada atau membuat baru", async () => {
    const client = new MockDriveClient({
      folders: [{ id: "root", name: "Drive Saya", parents: "" }],
      files: [],
    });
    const a = await ensureFolder(client, "Faktur");
    const b = await ensureFolder(client, "Faktur");
    expect(b).toBe(a);
    const root = await client.list("root");
    expect(root.folders.filter((f) => f.name === "Faktur")).toHaveLength(1);
  });
});
