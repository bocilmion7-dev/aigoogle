import { describe, expect, it } from "vitest";
import { MockDriveClient } from "../src/drive/mock-client.js";
import { buildPlan, executePlan, executeUndo } from "../src/drive/tidy.js";
import type { Category } from "../src/drive/classify.js";
import type { UndoTarget } from "../src/drive/types.js";

function mock() {
  return new MockDriveClient({
    folders: [
      { id: "root", name: "Drive", parents: "" },
      { id: "kerja", name: "Scan", parents: "root" },
      { id: "lama", name: "Faktur", parents: "kerja" },
    ],
    files: [
      { id: "p1", name: "faktur-a.pdf", parents: "kerja", mimeType: "application/pdf", text: "Faktur A" },
      { id: "p2", name: "kuitansi-b.pdf", parents: "kerja", mimeType: "application/pdf", text: "Kuitansi B" },
      { id: "n1", name: "catatan.txt", parents: "kerja", mimeType: "text/plain", text: "bukan pdf" },
    ],
  });
}

describe("buildPlan", () => {
  it("hanya PDF di folder kerja; buat folder kategori; pindah + rename", async () => {
    const c = mock();
    const plan = await buildPlan(
      c,
      "kerja",
      async (f): Promise<Category> => ((await c.getText(f.id)).includes("Kuitansi") ? "Kuitansi" : "Faktur")
    );
    // folder "Faktur" sudah ada di seed → hanya "Kuitansi" yang dibuat
    const creates = plan.filter((p) => p.action === "create_folder").map((p) => p.toName);
    expect(creates).toEqual(["Kuitansi"]);
    const p1 = plan.find((p) => p.fileId === "p1")!;
    expect(p1.action).toBe("move");
    expect(p1.toParent).toBe("lama");
    expect(p1.fromParent).toBe("kerja");
    expect(plan.some((p) => p.fileId === "n1")).toBe(false);
  });
  it("folder kategori lama dipakai ulang (tanpa create ganda)", async () => {
    const c = mock();
    const plan = await buildPlan(c, "kerja", async (): Promise<Category> => "Faktur");
    expect(plan.filter((p) => p.action === "create_folder")).toHaveLength(0);
    expect(plan.find((p) => p.fileId === "p1")!.toParent).toBe("lama");
  });
});

describe("executePlan", () => {
  it("eksekusi penuh → status done + log asal", async () => {
    const c = mock();
    const plan = await buildPlan(c, "kerja", async (f): Promise<Category> => (f.id === "p2" ? "Kuitansi" : "Faktur"));
    const res = await executePlan(c, plan, { isCancelled: () => false });
    expect(res.items.every((i) => i.status === "ok")).toBe(true);
    expect(res.items.find((i) => i.fileId === "p1")!.originalParent).toBe("kerja");
  });
  it("cancel di tengah → sisanya skipped", async () => {
    const c = mock();
    const plan = await buildPlan(c, "kerja", async (): Promise<Category> => "Faktur");
    let n = 0;
    const res = await executePlan(c, plan, { isCancelled: () => n++ >= 1 });
    expect(res.items.some((i) => i.status === "skipped")).toBe(true);
  });
  it("file gagal move → status failed + error, lain tetap jalan", async () => {
    const c = mock();
    const broken: MockDriveClient = Object.create(c);
    broken.move = async () => {
      throw new Error("lock");
    };
    const plan = await buildPlan(c, "kerja", async (): Promise<Category> => "Faktur");
    const res = await executePlan(broken, plan, { isCancelled: () => false });
    expect(res.items.filter((i) => i.action === "move").every((i) => i.status === "failed")).toBe(true);
  });

  it("result menyimpan toParent & toName untuk undo", async () => {
    const c = mock();
    const plan = await buildPlan(c, "kerja", async (): Promise<Category> => "Faktur");
    const res = await executePlan(c, plan, { isCancelled: () => false });
    const p1 = res.items.find((i) => i.fileId === "p1")!;
    expect(p1.toParent).toBe("lama");
    expect(p1.toName).toContain("[Faktur]");
  });
});

describe("executeUndo", () => {
  function target(over: Partial<UndoTarget> = {}): UndoTarget {
    return {
      fileId: "p1",
      fileName: "faktur-a.pdf",
      originalParent: "kerja",
      originalName: "faktur-a.pdf",
      toParent: "lama",
      toName: "faktur-a [Faktur].pdf",
      ...over,
    };
  }

  it("balik rename + move ke folder asal", async () => {
    const c = mock();
    await c.rename("p1", "faktur-a [Faktur].pdf");
    await c.move("p1", "lama", "kerja");
    const res = await executeUndo(c, [target()]);
    expect(res.items[0].status).toBe("ok");
    const f = (await c.list("kerja")).files.find((x) => x.id === "p1")!;
    expect(f.name).toBe("faktur-a.pdf");
    expect(f.parents).toBe("kerja");
  });

  it("gagal di satu file → lanjut file lain", async () => {
    const c = mock();
    const broken: MockDriveClient = Object.create(c);
    broken.rename = async (id: string) => {
      if (id === "p1") throw new Error("lock");
    };
    const res = await executeUndo(broken, [
      target(),
      target({ fileId: "p2", fileName: "kuitansi-b.pdf", toName: "kuitansi-b [Kuitansi].pdf" }),
    ]);
    expect(res.items.find((i) => i.fileId === "p1")!.status).toBe("failed");
    expect(res.items.find((i) => i.fileId === "p2")!.status).toBe("ok");
  });

  it("subset fileIds hanya mengubah file terpilih", async () => {
    const c = mock();
    await c.rename("p1", "faktur-a [Faktur].pdf");
    await c.move("p1", "lama", "kerja");
    const res = await executeUndo(c, [target({ fileId: "p2", fileName: "lain.pdf", toName: "lain [Faktur].pdf" })]);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].fileId).toBe("p2");
  });
});
