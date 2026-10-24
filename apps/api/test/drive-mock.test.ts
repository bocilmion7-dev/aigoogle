import { describe, expect, it } from "vitest";
import { MockDriveClient } from "../src/drive/mock-client.js";

function mock() {
  return new MockDriveClient({
    folders: [
      { id: "root", name: "Drive Saya", parents: "" },
      { id: "f-kerja", name: "Scan Oktober", parents: "root" },
      { id: "f-lama", name: "Faktur", parents: "f-kerja" },
    ],
    files: [
      { id: "pdf1", name: "faktur-001.pdf", parents: "f-kerja", mimeType: "application/pdf", text: "Faktur penjualan No 001 Budi" },
      { id: "pdf2", name: "kuitansi-sewa.pdf", parents: "f-kerja", mimeType: "application/pdf", text: "Kuitansi pembayaran sewa" },
      { id: "img1", name: "logo.png", parents: "f-kerja", mimeType: "image/png", text: "" },
    ],
  });
}

describe("MockDriveClient", () => {
  it("list folder & file dalam folder kerja", async () => {
    const c = mock();
    const kids = await c.list("f-kerja");
    expect(kids.folders.map((f) => f.name)).toEqual(["Faktur"]);
    expect(kids.files.map((f) => f.name).sort()).toEqual(["faktur-001.pdf", "kuitansi-sewa.pdf", "logo.png"]);
  });

  it("search: cari nama file lintas folder (case-insensitive)", async () => {
    const c = mock();
    const hits = await c.search("FAKTUR");
    expect(hits.map((h) => h.name)).toEqual(["faktur-001.pdf"]);
    expect(hits[0]!.folderName).toBe("Scan Oktober");
    // tanpa kata kunci → semua file (dibatasi max)
    expect((await c.search("", 2)).length).toBe(2);
  });

  it("get file text by id", async () => {
    const c = mock();
    expect(await c.getText("pdf1")).toContain("Faktur penjualan");
  });

  it("createFolder di bawah folder kerja", async () => {
    const c = mock();
    const f = await c.createFolder("Faktur", "f-kerja");
    expect(f.parents).toBe("f-kerja");
    const kids = await c.list("f-kerja");
    expect(kids.folders.map((x) => x.name)).toContain("Faktur");
  });

  it("createFolder tidak boleh di luar scope (parents di luar tree) → throw", async () => {
    const c = mock();
    await expect(c.createFolder("X", "di-luar")).rejects.toThrow();
  });

  it("rename file", async () => {
    const c = mock();
    await c.rename("pdf1", "faktur-001-OK.pdf");
    const kids = await c.list("f-kerja");
    expect(kids.files.find((f) => f.id === "pdf1")!.name).toBe("faktur-001-OK.pdf");
  });

  it("move file antar folder", async () => {
    const c = mock();
    await c.move("pdf1", "f-lama");
    expect((await c.list("f-lama")).files.map((f) => f.id)).toContain("pdf1");
    expect((await c.list("f-kerja")).files.map((f) => f.id)).not.toContain("pdf1");
  });

  it("isDescendant: folder turunan valid", async () => {
    const c = mock();
    expect(await c.isDescendant("f-lama", "f-kerja")).toBe(true);
    expect(await c.isDescendant("f-kerja", "f-lama")).toBe(false);
  });
});
