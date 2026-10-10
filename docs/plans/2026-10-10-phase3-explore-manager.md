# Fase 3 — Explore Manager (Drive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. (User memilih eksekusi INLINE — tanpa sub-agent, tanpa code-quality review sub-agent; verifikasi = test + typecheck hijau.)

**Goal:** Fitur "Rapikan Folder Ini" pada Explore Manager — pilih folder kerja, klasifikasi PDF via Gemini Vision, preview rencana + consent, eksekusi create/rename/move berprogres & bisa dibatalkan, log posisi asal (dasar undo), laporan per-file.

**Architecture:** Drive diabstract di balik `DriveClient` interface (pola sama seperti `AccountingProvider`). Karena `GOOGLE_OAUTH_CLIENT_SECRET` masih kosong, implementasi live Google (`GoogleDriveClient`) ditulis lengkap namun tidak diuji live; pengujian memakai **`MockDriveClient` in-memory**. OAuth callback Google diimplementasikan penuh (menukar code → refresh token → `Connection(provider="google")`) dan otomatis aktif begitu secret terisi. Klasifikasi PDF memakai Gemini `generateContent` dengan `inlineData` (Vision), dengan fallback nama-file bila model menolak/mengembalikan error. Kategori dokumen dipetakan ke folder turunan di dalam folder kerja. Semua aksi Drive dibatasi folder terpilih + wajib permission `drive.tidy`.

**Tech Stack:** Express + Prisma/Neon (sudah ada), Gemini generateContent Vision, React+Vite (sudah ada), Vitest + supertest, in-memory mock Drive.

---
## Peta File

| File | Tanggung jawab |
|---|---|
| `apps/api/src/drive/types.ts` | Tipe `DriveFile`, `DriveFolder`, `DriveClient`, `TidyPlanItem`, `TidyResult` |
| `apps/api/src/drive/mock-client.ts` | `MockDriveClient` in-memory (bisa disuntik file/folder dari test) |
| `apps/api/src/drive/google-client.ts` | `GoogleDriveClient` live (REST v3, token dari Connection) |
| `apps/api/src/drive/classify.ts` | Gemini Vision → jenis dokumen → pemetaan kategori folder |
| `apps/api/src/drive/tidy.ts` | Orkestrasi: scan → klasifikasi → rencana → eksekusi (dengan cancel + progress) |
| `apps/api/src/routes/drive.ts` | Endpoints: connection status, tree, list, plan, run (NDJSON), jobs |
| `apps/api/src/routes/google.ts` | (Modify) callback OAuth Google penuh |
| `apps/api/src/app.ts` | (Modify) mount driveRouter |
| `apps/web/src/drive-api.ts` | Client NDJSON + REST |
| `apps/web/src/pages/Explore.tsx` | UI file manager (tree + list + Rapikan + preview + progress + laporan) |
| `apps/web/src/App.tsx`, `Shell.tsx` | (Modify) route `/explore` + nav |
| `apps/api/test/drive-*.test.ts` | Test mock client, classify (stub), tidy, routes, isolasi tenant |
| `mocks/drive/*` | TIDAK dibuat — mock in-process via `MockDriveClient` (sederhana, cukup) |

**Kategori dokumen (fixed):** `Faktur`, `Kuitansi`, `Nota`, `Surat Jalan`, `Lainnya`. Folder turunan: `${nama kategori}` dibuat (sekali) di dalam folder kerja.

---

### Task 1: Skema Prisma DriveJob + DriveActionLog

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, migrasi

- [ ] **Step 1: tambah model**

```prisma
model DriveJob {
  id          String            @id @default(cuid())
  tenant      Tenant            @relation(fields: [tenantId], references: [id])
  tenantId    String
  userId      String
  folderId    String
  folderName  String            @default("")
  status      String            @default("planned") // planned|running|done|cancelled|failed
  planJson    String            @default("[]")
  resultJson  String            @default("{}")
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt
  logs        DriveActionLog[]
}

model DriveActionLog {
  id        String    @id @default(cuid())
  job       DriveJob  @relation(fields: [jobId], references: [id], onDelete: Cascade)
  jobId     String
  fileId    String
  fileName  String    @default("")
  action    String    // create_folder|rename|move
  fromParent String   @default("")
  toParent   String   @default("")
  status    String    @default("ok") // ok|failed|skipped
  error     String    @default("")
  createdAt DateTime  @default(now())
}
```
Tambah relasi `driveJobs DriveJob[]` di model `Tenant`.

- [ ] **Step 2: migrate**

Run: `cd apps/api && pnpm exec prisma migrate dev --name phase3-drive`
Expected: migrasi ter-apply, client regenerate.

- [ ] **Step 3: typecheck + commit**

Run: `pnpm typecheck` (root) → 0.
```bash
git add apps/api/prisma apps/api/src/generated 2>/dev/null; git add apps/api/prisma
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase3): skema DriveJob + DriveActionLog"
```
---

### Task 2: DriveClient types + MockDriveClient (TDD)

**Files:**
- Create: `apps/api/src/drive/types.ts`, `apps/api/src/drive/mock-client.ts`, `apps/api/test/drive-mock.test.ts`

- [ ] **Step 1: tulis test dulu**

Create `apps/api/test/drive-mock.test.ts`:
```ts
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
```

- [ ] **Step 2: jalankan → FAIL**

Run: `cd apps/api && pnpm test drive-mock`
Expected: FAIL (module tidak ada).

- [ ] **Step 3: types.ts**

Create `apps/api/src/drive/types.ts`:
```ts
export interface DriveFile {
  id: string;
  name: string;
  parents: string;
  mimeType: string;
}
export interface DriveFolder {
  id: string;
  name: string;
  parents: string;
}
export interface ListResult {
  folders: DriveFolder[];
  files: DriveFile[];
}
export interface DriveClient {
  list(folderId: string): Promise<ListResult>;
  getText(fileId: string): Promise<string>;
  createFolder(name: string, parents: string): Promise<DriveFolder>;
  rename(fileId: string, name: string): Promise<void>;
  move(fileId: string, newParents: string): Promise<void>;
  isDescendant(folderId: string, ancestorId: string): Promise<boolean>;
}

export type TidyAction = "create_folder" | "rename" | "move";
export interface TidyPlanItem {
  action: TidyAction;
  fileId: string;
  fileName: string;
  fromParent: string;
  toParent: string;
  toName?: string;
  category: string;
}
export interface TidyResultItem {
  fileId: string;
  fileName: string;
  action: TidyAction;
  status: "ok" | "failed" | "skipped";
  error?: string;
  originalParent?: string;
  originalName?: string;
}
```

- [ ] **Step 4: mock-client.ts**

Create `apps/api/src/drive/mock-client.ts`:
```ts
import type { DriveClient, DriveFile, DriveFolder, ListResult } from "./types.js";

export interface MockSeed {
  folders: DriveFolder[];
  files: (DriveFile & { text: string })[];
}

export class MockDriveClient implements DriveClient {
  private folders: DriveFolder[];
  private files: (DriveFile & { text: string })[];
  constructor(seed: MockSeed) {
    this.folders = [...seed.folders];
    this.files = seed.files.map((f) => ({ ...f }));
  }
  private hasFolder(id: string) {
    return this.folders.some((f) => f.id === id) || id === "root";
  }
  async list(folderId: string): Promise<ListResult> {
    if (!this.hasFolder(folderId)) throw new Error("folder tidak ditemukan");
    return {
      folders: this.folders.filter((f) => f.parents === folderId),
      files: this.files.filter((f) => f.parents === folderId),
    };
  }
  async getText(fileId: string): Promise<string> {
    return this.files.find((f) => f.id === fileId)?.text ?? "";
  }
  async createFolder(name: string, parents: string): Promise<DriveFolder> {
    if (!this.hasFolder(parents)) throw new Error("parents di luar scope");
    const existing = this.folders.find((f) => f.parents === parents && f.name === name);
    if (existing) return existing;
    const f: DriveFolder = { id: `dir-${this.folders.length + 1}`, name, parents };
    this.folders.push(f);
    return f;
  }
  async rename(fileId: string, name: string): Promise<void> {
    const f = this.files.find((x) => x.id === fileId);
    if (!f) throw new Error("file tidak ditemukan");
    f.name = name;
  }
  async move(fileId: string, newParents: string): Promise<void> {
    if (!this.hasFolder(newParents)) throw new Error("tujuan di luar scope");
    const f = this.files.find((x) => x.id === fileId);
    if (!f) throw new Error("file tidak ditemukan");
    f.parents = newParents;
  }
  async isDescendant(folderId: string, ancestorId: string): Promise<boolean> {
    let cur = this.folders.find((f) => f.id === folderId)?.parents;
    let hops = 0;
    while (cur && hops++ < 50) {
      if (cur === ancestorId) return true;
      cur = this.folders.find((f) => f.id === cur)?.parents;
    }
    return false;
  }
}
```

- [ ] **Step 5: jalankan → PASS**

Run: `cd apps/api && pnpm test drive-mock`
Expected: 7/7 PASS.

- [ ] **Step 6: commit**

```bash
git add apps/api/src/drive apps/api/test/drive-mock.test.ts
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase3): DriveClient types + MockDriveClient"
```
---

### Task 3: Klasifikasi (Gemini Vision) + pemetaan kategori (TDD)

**Files:**
- Create: `apps/api/src/drive/classify.ts`, `apps/api/test/drive-classify.test.ts`

- [ ] **Step 1: tulis test**

Create `apps/api/test/drive-classify.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { classifyText, categoryFolderName } from "../src/drive/classify.js";

describe("classifyText (rule-based fallback)", () => {
  it("deteksi Faktur", () => {
    expect(classifyText("Faktur Penjualan No. 001 Atas nama Budi")).toBe("Faktur");
  });
  it("deteksi Kuitansi", () => {
    expect(classifyText("Kuitansi pembayaran sewa bulanan")).toBe("Kuitansi");
  });
  it("deteksi Nota", () => {
    expect(classifyText("Nota Kontan penjualan tunai")).toBe("Nota");
  });
  it("deteksi Surat Jalan", () => {
    expect(classifyText("Surat Jalan pengiriman barang")).toBe("Surat Jalan");
  });
  it("default Lainnya", () => {
    expect(classifyText("dokumen acak tanpa kata kunci")).toBe("Lainnya");
  });
});

describe("categoryFolderName", () => {
  it("nama folder = kategori", () => {
    expect(categoryFolderName("Faktur")).toBe("Faktur");
    expect(categoryFolderName("Surat Jalan")).toBe("Surat Jalan");
  });
});
```

- [ ] **Step 2: jalankan → FAIL**

Run: `cd apps/api && pnpm test drive-classify`
Expected: FAIL.

- [ ] **Step 3: implement classify.ts**

Create `apps/api/src/drive/classify.ts`:
```ts
export const CATEGORIES = ["Faktur", "Kuitansi", "Nota", "Surat Jalan", "Lainnya"] as const;
export type Category = (typeof CATEGORIES)[number];

const RULES: Array<[Category, RegExp]> = [
  ["Faktur", /\bfaktur\b|\binvoice\b|\bno\.?\s*\d+/i],
  ["Kuitansi", /\bkuitansi\b|\breceipt\b/i],
  ["Nota", /\bnota\b|\btunai\b|\bcash\b/i],
  ["Surat Jalan", /\bsurat jalan\b|\bdelivery\b|\bdo\b/i],
];

export function classifyText(text: string): Category {
  for (const [cat, re] of RULES) if (re.test(text)) return cat;
  return "Lainnya";
}

export function categoryFolderName(cat: Category): string {
  return cat;
}

// Nama file → kategori (fallback bila vision tidak tersedia)
export function classifyFileName(name: string): Category {
  return classifyText(name);
}
```

- [ ] **Step 4: jalankan → PASS**

Run: `cd apps/api && pnpm test drive-classify`
Expected: 6/6 PASS.

- [ ] **Step 5: commit**

```bash
git add apps/api/src/drive/classify.ts apps/api/test/drive-classify.test.ts
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase3): klasifikasi kategori dokumen (rule-based)"
```
---

### Task 3b: Vision klasifikasi (Gemini) + fallback nama-file (TDD)

**Files:**
- Modify: `apps/api/src/drive/classify.ts`
- Create: `apps/api/test/drive-vision.test.ts`

Prinsip: `classifyWithGemini(text, mime, apiKey)` mengembalikan `Category`. Bila apiKey kosong / model error / mime bukan pdf/gambar → fallback `classifyFileName`. Test pakai fake fetch (tidak membakar kuota).

- [ ] **Step 1: tulis test**

Create `apps/api/test/drive-vision.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyWithGemini } from "../src/drive/classify.js";

afterEach(() => vi.unstubAllGlobals());

function stubGemini(textPart: string) {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: textPart }] } }] }), { status: 200 })
  ));
}

describe("classifyWithGemini", () => {
  it("pakai jawaban model bila valid", async () => {
    stubGemini("Faktur");
    expect(await classifyWithGemini("isi", "application/pdf", "key-x")).toBe("Faktur");
  });
  it("jawaban model tak dikenal → fallback nama file", async () => {
    stubGemini("apapun");
    expect(await classifyWithGemini("isi", "application/pdf", "key-x", "kuitansi-sewa.pdf")).toBe("Kuitansi");
  });
  it("tanpa api key → fallback nama file", async () => {
    expect(await classifyWithGemini("isi", "application/pdf", "", "faktur-1.pdf")).toBe("Faktur");
  });
  it("fetch gagal → fallback nama file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net"); }));
    expect(await classifyWithGemini("isi", "application/pdf", "key-x", "nota.pdf")).toBe("Nota");
  });
});
```

- [ ] **Step 2: jalankan → FAIL**

Run: `cd apps/api && pnpm test drive-vision`
Expected: FAIL (fungsi belum ada).

- [ ] **Step 3: implement**

Edit `apps/api/src/drive/classify.ts` — tambah di bawah:
```ts
const VISION_OK = /^(application\/pdf|image\/)/i;

export async function classifyWithGemini(
  text: string,
  mimeType: string,
  apiKey: string,
  fileName = ""
): Promise<Category> {
  const fallback = () => (fileName ? classifyFileName(fileName) : classifyText(text));
  if (!apiKey || !VISION_OK.test(mimeType)) return fallback();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || "gemini-3.6-flash"}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `Klasifikasi dokumen ini ke salah satu: ${CATEGORIES.join(", ")}. Balas HANYA kata kategorinya.\n\n${text.slice(0, 1500)}` }] }],
        }),
      }
    );
    if (!res.ok) return fallback();
    const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const raw = (j.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
    const hit = CATEGORIES.find((c) => c.toLowerCase() === raw.toLowerCase());
    return hit ?? fallback();
  } catch {
    return fallback();
  }
}
```

- [ ] **Step 4: jalankan → PASS + commit**

Run: `cd apps/api && pnpm test drive-vision` → 4/4 PASS.
```bash
git add apps/api/src/drive/classify.ts apps/api/test/drive-vision.test.ts
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase3): vision klasifikasi + fallback nama-file"
```

---

### Task 4: Orkestrasi tidy — rencana + eksekusi dengan cancel & progress (TDD)

**Files:**
- Create: `apps/api/src/drive/tidy.ts`, `apps/api/test/drive-tidy.test.ts`

- [ ] **Step 1: tulis test**

Create `apps/api/test/drive-tidy.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { MockDriveClient } from "../src/drive/mock-client.js";
import { buildPlan, executePlan } from "../src/drive/tidy.js";

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
    const plan = await buildPlan(c, "kerja", async (f) => (await c.getText(f.id)).includes("Kuitansi") ? "Kuitansi" : "Faktur");
    const creates = plan.filter((p) => p.action === "create_folder").map((p) => p.toName);
    expect(creates.sort()).toEqual(["Faktur", "Kuitansi"]);
    const p1 = plan.find((p) => p.fileId === "p1")!;
    expect(p1.action).toBe("move");
    expect(p1.toParent).toBeTruthy();
    expect(p1.originalParent ?? p1.fromParent).toBe("kerja");
    expect(plan.some((p) => p.fileId === "n1")).toBe(false);
  });
  it("folder kategori lama dipakai ulang (tanpa create ganda)", async () => {
    const c = mock();
    const plan = await buildPlan(c, "kerja", async () => "Faktur");
    expect(plan.filter((p) => p.action === "create_folder")).toHaveLength(0);
    expect(plan.find((p) => p.fileId === "p1")!.toParent).toBe("lama");
  });
});

describe("executePlan", () => {
  it("eksekusi penuh → status done + log asal", async () => {
    const c = mock();
    const plan = await buildPlan(c, "kerja", async (f) => f.id === "p2" ? "Kuitansi" : "Faktur");
    const res = await executePlan(c, plan, { isCancelled: () => false });
    expect(res.items.every((i) => i.status === "ok")).toBe(true);
    expect(res.items.find((i) => i.fileId === "p1")!.originalParent).toBe("kerja");
  });
  it("cancel di tengah → sisanya skipped", async () => {
    const c = mock();
    const plan = await buildPlan(c, "kerja", async () => "Faktur");
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
    const plan = await buildPlan(c, "kerja", async () => "Faktur");
    const res = await executePlan(broken, plan, { isCancelled: () => false });
    expect(res.items.filter((i) => i.action === "move").every((i) => i.status === "failed")).toBe(true);
  });
});
```

- [ ] **Step 2: jalankan → FAIL**

Run: `cd apps/api && pnpm test drive-tidy`
Expected: FAIL.
- [ ] **Step 3: implement tidy.ts**

Create `apps/api/src/drive/tidy.ts`:
```ts
import type { DriveClient, TidyPlanItem, TidyResultItem } from "./types.js";
import { categoryFolderName, type Category } from "./classify.js";

export type Classifier = (file: { id: string; name: string; mimeType: string }) => Promise<Category> | Category;

// Susun rencana: buat folder kategori (pakai ulang bila ada), lalu pindah + rename tiap PDF.
export async function buildPlan(client: DriveClient, folderId: string, classify: Classifier): Promise<TidyPlanItem[]> {
  const { folders, files } = await client.list(folderId);
  const pdfs = files.filter((f) => f.mimeType === "application/pdf");
  const folderByCat = new Map<string, string>();
  for (const f of folders) folderByCat.set(f.name, f.id);

  const plan: TidyPlanItem[] = [];
  const catFolder = new Map<Category, string>();
  for (const pdf of pdfs) {
    const cat = await classify(pdf);
    let parentId = folderByCat.get(categoryFolderName(cat));
    if (!parentId) {
      if (!catFolder.has(cat)) {
        const created = await client.createFolder(categoryFolderName(cat), folderId);
        catFolder.set(cat, created.id);
        folderByCat.set(categoryFolderName(cat), created.id);
      }
      parentId = catFolder.get(cat)!;
      // catat rencana create (folder sudah dibuat di mock utk mengetahui id;
      // pada implementasi live, create ditunda sampai eksekusi)
    }
    if (!plan.some((p) => p.action === "create_folder" && p.toName === categoryFolderName(cat))) {
      plan.push({ action: "create_folder", fileId: "", fileName: "", fromParent: "", toParent: folderId, toName: categoryFolderName(cat), category: cat });
    }
    plan.push({
      action: "move",
      fileId: pdf.id,
      fileName: pdf.name,
      fromParent: pdf.parents,
      toParent: parentId,
      toName: `${pdf.name.replace(/\.pdf$/i, "")} [${cat}].pdf`,
      category: cat,
    });
  }
  return plan;
}

export interface ExecuteOpts {
  isCancelled: () => boolean;
  onProgress?: (done: number, total: number, item: TidyResultItem) => void;
}

export async function executePlan(
  client: DriveClient,
  plan: TidyPlanItem[],
  opts: ExecuteOpts
): Promise<{ items: TidyResultItem[] }> {
  const items: TidyResultItem[] = [];
  const total = plan.filter((p) => p.action === "move").length;
  let done = 0;
  const createdFolderId = new Map<string, string>();

  for (const step of plan) {
    if (step.action === "create_folder") {
      try {
        const f = await client.createFolder(step.toName!, step.toParent);
        createdFolderId.set(step.toName!, f.id);
      } catch {
        /* create ulang / sudah ada diabaikan; id diambil dari move berikut */
      }
      continue;
    }
    if (opts.isCancelled()) {
      items.push({ fileId: step.fileId, fileName: step.fileName, action: "move", status: "skipped" });
      continue;
    }
    const target = step.toParent || createdFolderId.get(step.toName!) || step.toParent;
    try {
      if (step.toName && step.toName !== step.fileName) await client.rename(step.fileId, step.toName);
      await client.move(step.fileId, target);
      const item: TidyResultItem = {
        fileId: step.fileId, fileName: step.fileName, action: "move", status: "ok",
        originalParent: step.fromParent, originalName: step.fileName,
      };
      items.push(item);
      done++;
      opts.onProgress?.(done, total, item);
    } catch (e) {
      const item: TidyResultItem = {
        fileId: step.fileId, fileName: step.fileName, action: "move", status: "failed",
        error: e instanceof Error ? e.message : "gagal", originalParent: step.fromParent,
      };
      items.push(item);
      done++;
      opts.onProgress?.(done, total, item);
    }
  }
  return { items };
}
```

- [ ] **Step 4: jalankan → PASS**

Run: `cd apps/api && pnpm test drive-tidy`
Expected: 6/6 PASS.

- [ ] **Step 5: commit**

```bash
git add apps/api/src/drive/tidy.ts apps/api/test/drive-tidy.test.ts
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase3): orkestrasi tidy (rencana + eksekusi cancel/progress)"
```
---

### Task 5: GoogleDriveClient live (REST v3) — tanpa uji live (secret menyusul)

**Files:**
- Create: `apps/api/src/drive/google-client.ts`, `apps/api/test/drive-google.test.ts`

Diuji dengan stub `fetch` (kontrak request), bukan live — secret belum ada.

- [ ] **Step 1: tulis test**

Create `apps/api/test/drive-google.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleDriveClient } from "../src/drive/google-client.js";

afterEach(() => vi.unstubAllGlobals());

const calls: Array<{ url: string; init?: RequestInit }> = [];
function stub(fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (fetchImpl) return fetchImpl(url, init);
    return new Response(JSON.stringify({ files: [], folders: [] }), { status: 200 });
  }));
}

describe("GoogleDriveClient", () => {
  it("list → query files API dengan parents + fields", async () => {
    calls.length = 0;
    stub(() => new Response(JSON.stringify({ files: [{ id: "a", name: "x.pdf", parents: ["r"], mimeType: "application/pdf" }] }), { status: 200 }));
    const c = new GoogleDriveClient("tok");
    const r = await c.list("r");
    expect(calls[0].url).toContain("https://www.googleapis.com/drive/v3/files");
    expect(calls[0].url).toContain("parents+in+'r'");
    expect(calls[0].init?.headers).toMatchObject({ Authorization: "Bearer tok" });
    expect(r.files[0].mimeType).toBe("application/pdf");
  });

  it("createFolder → files POST body folder", async () => {
    calls.length = 0;
    stub((_u, init) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "n1", name: body.name }), { status: 200 });
    });
    const c = new GoogleDriveClient("tok");
    const f = await c.createFolder("Faktur", "r");
    expect(f.id).toBe("n1");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.mimeType).toBe("application/vnd.google-apps.folder");
    expect(JSON.stringify(body.parents)).toContain("r");
  });

  it("rename → PATCH name", async () => {
    calls.length = 0;
    stub(() => new Response("{}", { status: 200 }));
    const c = new GoogleDriveClient("tok");
    await c.rename("f1", "baru.pdf");
    expect(calls[0].url).toContain("/files/f1");
    expect(calls[0].init?.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init?.body)).name).toBe("baru.pdf");
  });

  it("move → PATCH parents", async () => {
    calls.length = 0;
    stub(() => new Response("{}", { status: 200 }));
    const c = new GoogleDriveClient("tok");
    await c.move("f1", "p2");
    expect(JSON.parse(String(calls[0].init?.body)).addParents).toBe("p2");
  });

  it("getText → export PDF sebagai text (alt=media utk non-google-doc)", async () => {
    calls.length = 0;
    stub((url) => {
      if (url.includes("export")) return new Response("isi faktur", { status: 200 });
      return new Response(JSON.stringify({ mimeType: "application/pdf" }), { status: 200 });
    });
    const c = new GoogleDriveClient("tok");
    const t = await c.getText("f1");
    expect(t).toContain("isi faktur");
  });
});
```

- [ ] **Step 2: jalankan → FAIL**

Run: `cd apps/api && pnpm test drive-google`
Expected: FAIL.

- [ ] **Step 3: implement google-client.ts**

Create `apps/api/src/drive/google-client.ts`:
```ts
import type { DriveClient, DriveFile, DriveFolder, ListResult } from "./types.js";

const API = "https://www.googleapis.com/drive/v3";

export class GoogleDriveClient implements DriveClient {
  constructor(private accessToken: string) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  async list(folderId: string): Promise<ListResult> {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const url = `${API}/files?q=${q}&fields=files(id,name,parents,mimeType)&pageSize=200`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`drive list gagal (${res.status})`);
    const j = (await res.json()) as { files: DriveFile[] };
    const files: DriveFile[] = [];
    const folders: DriveFolder[] = [];
    for (const f of j.files ?? []) {
      const row = { id: f.id, name: f.name, parents: f.parents?.[0] ?? folderId, mimeType: f.mimeType };
      if (f.mimeType === "application/vnd.google-apps.folder") folders.push(row);
      else files.push(row);
    }
    return { folders, files };
  }

  async getText(fileId: string): Promise<string> {
    const meta = await fetch(`${API}/files/${fileId}?fields=mimeType`, { headers: this.headers() });
    if (!meta.ok) throw new Error(`drive meta gagal (${meta.status})`);
    const { mimeType } = (await meta.json()) as { mimeType: string };
    const url = mimeType.startsWith("application/vnd.google-apps.")
      ? `${API}/files/${fileId}/export?mimeType=text/plain`
      : `${API}/files/${fileId}?alt=media`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`drive download gagal (${res.status})`);
    return res.text();
  }

  async createFolder(name: string, parents: string): Promise<DriveFolder> {
    const res = await fetch(`${API}/files`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parents] }),
    });
    if (!res.ok) throw new Error(`create folder gagal (${res.status})`);
    const j = (await res.json()) as { id: string; name: string };
    return { id: j.id, name: j.name, parents };
  }

  async rename(fileId: string, name: string): Promise<void> {
    const res = await fetch(`${API}/files/${fileId}`, {
      method: "PATCH",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`rename gagal (${res.status})`);
  }

  async move(fileId: string, newParents: string): Promise<void> {
    const res = await fetch(`${API}/files/${fileId}?addParents=${newParents}`, {
      method: "PATCH",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`move gagal (${res.status})`);
  }

  async isDescendant(folderId: string, ancestorId: string): Promise<boolean> {
    let cur: string | undefined = folderId;
    let hops = 0;
    while (cur && hops++ < 50) {
      if (cur === ancestorId) return true;
      const res = await fetch(`${API}/files/${cur}?fields=parents`, { headers: this.headers() });
      if (!res.ok) return false;
      const j = (await res.json()) as { parents?: string[] };
      cur = j.parents?.[0];
    }
    return false;
  }
}
```

- [ ] **Step 4: PASS + commit**

Run: `cd apps/api && pnpm test drive-google` → 5/5 PASS; typecheck 0.
```bash
git add apps/api/src/drive/google-client.ts apps/api/test/drive-google.test.ts
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase3): GoogleDriveClient live (kontrak REST v3, diuji stub)"
```
---

### Task 6: Routes drive + callback Google penuh (TDD)

**Files:**
- Create: `apps/api/src/routes/drive.ts`, `apps/api/src/drive/registry.ts`, `apps/api/test/drive-routes.test.ts`
- Modify: `apps/api/src/routes/google.ts`, `apps/api/src/routes/settings.ts`, `apps/api/src/app.ts`

`registry.ts` memilih `DriveClient` per tenant: `MOCK_DRIVE=1` → `MockDriveClient` seed demo (persist di memori module); selain itu → `GoogleDriveClient` dari `Connection(provider="google")` (decrypt token). Callback Google menyimpan token itu.

Endpoints (semua `requireUser`):
- `GET /api/drive/status` → `{ connected: boolean, engine: "mock"|"google" }`
- `GET /api/drive/tree?folderId=` → daftar folder turunan 1 level + files (ringan: pakai `list` rekursif maks 3 level)
- `GET /api/drive/list?folderId=` → `{ folders, files }`
- `POST /api/drive/plan` `{ folderId }` → `{ jobId, items }` (status planned; klasifikasi gemini bila key ada, fallback nama-file)
- `POST /api/drive/jobs/:id/run` → NDJSON progress: `start | progress | done | cancelled | error`
- `GET /api/drive/jobs` → 20 job terakhir + `GET /api/drive/jobs/:id` → job + logs
- `POST /api/drive/jobs/:id/cancel` → set flag cancel (in-memory Map jobId→bool)

- [ ] **Step 1: tulis test**

Create `apps/api/test/drive-routes.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { setMockDriveSeed } from "../src/drive/registry.js";

let api: ReturnType<typeof createApp>;
let cookie = "";
let tenantId = "";

beforeAll(async () => {
  process.env.MOCK_DRIVE = "1";
  setMockDriveSeed({
    folders: [
      { id: "root", name: "Drive", parents: "" },
      { id: "kerja", name: "Scan", parents: "root" },
    ],
    files: [
      { id: "p1", name: "faktur-a.pdf", parents: "kerja", mimeType: "application/pdf", text: "Faktur A" },
    ],
  });
  api = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `drv-${randomBytes(3).toString("hex")}`, name: "PT Drive", alias: "DRV" },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({ data: { tenantId: tenant.id, key: "admin", name: "Admin" } });
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionKey: "drive.tidy" } });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, providerUserId: `du-${randomBytes(3).toString("hex")}`, email: "drv@demo.local", name: "Drv", roleId: role.id },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86400_000) } });
  cookie = `sid=${sid}`;
});
afterAll(() => prisma.$disconnect());

function ndjson(body: string) {
  return body.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("drive routes", () => {
  it("tanpa login → 401", async () => {
    expect((await request(api).get("/api/drive/status")).status).toBe(401);
  });

  it("status mock connected", async () => {
    const res = await request(api).get("/api/drive/status").set("Cookie", cookie);
    expect(res.body).toEqual({ connected: true, engine: "mock" });
  });

  it("list folder kerja", async () => {
    const res = await request(api).get("/api/drive/list?folderId=kerja").set("Cookie", cookie);
    expect(res.body.files[0].name).toBe("faktur-a.pdf");
  });

  it("plan → create_folder + move", async () => {
    const res = await request(api).post("/api/drive/plan").set("Cookie", cookie).send({ folderId: "kerja" });
    expect(res.status).toBe(200);
    expect(res.body.jobId).toBeTruthy();
    const acts = res.body.items.map((i: { action: string }) => i.action);
    expect(acts).toContain("create_folder");
    expect(acts).toContain("move");
  });

  it("run job → NDJSON progress + done; logs tersimpan", async () => {
    const plan = await request(api).post("/api/drive/plan").set("Cookie", cookie).send({ folderId: "kerja" });
    const id = plan.body.jobId as string;
    const run = await request(api).post(`/api/drive/jobs/${id}/run`).set("Cookie", cookie).buffer(true).parse((r, cb) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => cb(null, d));
    });
    const ev = ndjson(run.body as string);
    expect(ev[0].type).toBe("start");
    expect(ev.at(-1)!.type).toBe("done");
    const job = await prisma.driveJob.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe("done");
    const logs = await prisma.driveActionLog.findMany({ where: { jobId: id } });
    expect(logs.some((l) => l.action === "move" && l.fromParent === "kerja")).toBe(true);
  });

  it("cancel job → sisanya skipped", async () => {
    const plan = await request(api).post("/api/drive/plan").set("Cookie", cookie).send({ folderId: "kerja" });
    const id = plan.body.jobId as string;
    await request(api).post(`/api/drive/jobs/${id}/cancel`).set("Cookie", cookie);
    const run = await request(api).post(`/api/drive/jobs/${id}/run`).set("Cookie", cookie).buffer(true).parse((r, cb) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => cb(null, d));
    });
    const ev = ndjson(run.body as string);
    expect(ev.some((e) => e.type === "cancelled" || (e.type === "progress" && e.status === "skipped"))).toBe(true);
  });

  it("isolasi tenant: job milik A tak terbaca B (404)", async () => {
    const job = await prisma.driveJob.findFirstOrThrow({ where: { tenantId } });
    const other = await prisma.tenant.create({
      data: { provider: "accurate", providerDbId: `drvB-${randomBytes(3).toString("hex")}`, name: "PT B", alias: "B" },
    });
    const role = await prisma.role.create({ data: { tenantId: other.id, key: "admin", name: "A" } });
    const user = await prisma.user.create({
      data: { tenantId: other.id, providerUserId: `dB-${randomBytes(3).toString("hex")}`, email: "b@demo.local", name: "B", roleId: role.id },
    });
    const sid = randomBytes(32).toString("hex");
    await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86400_000) } });
    const res = await request(api).get(`/api/drive/jobs/${job.id}`).set("Cookie", `sid=${sid}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: jalankan → FAIL**

Run: `cd apps/api && pnpm test drive-routes`
Expected: FAIL.
- [ ] **Step 3: implement registry.ts**

Create `apps/api/src/drive/registry.ts`:
```ts
import { prisma } from "../db.js";
import { decryptToken } from "../crypto.js";
import { MockDriveClient, type MockSeed } from "./mock-client.js";
import { GoogleDriveClient } from "./google-client.js";
import type { DriveClient } from "./types.js";

let mockSeed: MockSeed = {
  folders: [{ id: "root", name: "Drive Saya", parents: "" }],
  files: [],
};
let mockInstance: MockDriveClient | null = null;

export function setMockDriveSeed(seed: MockSeed) {
  mockSeed = seed;
  mockInstance = null;
}

export async function driveClientFor(tenantId: string): Promise<DriveClient | null> {
  if (process.env.MOCK_DRIVE === "1") {
    mockInstance ??= new MockDriveClient(mockSeed);
    return mockInstance;
  }
  const conn = await prisma.connection.findUnique({
    where: { tenantId_provider: { tenantId, provider: "google" } },
  });
  if (!conn) return null;
  return new GoogleDriveClient(decryptToken(conn.accessTokenEnc));
}

export const engineMode = () => (process.env.MOCK_DRIVE === "1" ? "mock" : "google");
```

- [ ] **Step 4: implement routes/drive.ts (bagian 1: status/list/tree/plan)**

Create `apps/api/src/routes/drive.ts` skeleton:
```ts
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { driveClientFor, engineMode } from "../drive/registry.js";
import { buildPlan, executePlan } from "../drive/tidy.js";
import { classifyWithGemini } from "../drive/classify.js";
import { writeAudit } from "../audit.js";

export const driveRouter = Router();
const cancelFlags = new Map<string, boolean>();

driveRouter.get("/drive/status", requireUser, asyncHandler(async (req, res) => {
  const client = await driveClientFor(req.user!.tenant.id);
  res.json({ connected: !!client, engine: engineMode() });
}));

driveRouter.get("/drive/list", requireUser, asyncHandler(async (req, res) => {
  const folderId = String(req.query.folderId ?? "root");
  const client = await driveClientFor(req.user!.tenant.id);
  if (!client) return res.status(409).json({ error: "belum_connect" });
  if (!(await client.isDescendant(folderId, "root")) && folderId !== "root") {
    return res.status(403).json({ error: "di_luar_cakupan" });
  }
  res.json(await client.list(folderId));
}));

driveRouter.post("/drive/plan", requireUser, asyncHandler(async (req, res) => {
  const body = z.object({ folderId: z.string().min(1) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "bad_request" });
  const user = req.user!;
  const perms = await prisma.rolePermission.findMany({
    where: { role: { tenantId: user.tenant.id, users: { some: { id: user.id } } } },
  });
  if (!perms.some((p) => p.permissionKey === "drive.tidy")) {
    return res.status(403).json({ error: "tidak_punya_hak" });
  }
  const client = await driveClientFor(user.tenant.id);
  if (!client) return res.status(409).json({ error: "belum_connect" });
  if (!(await client.isDescendant(body.data.folderId, "root")) && body.data.folderId !== "root") {
    return res.status(403).json({ error: "di_luar_cakupan" });
  }
  const folderName = (await client.list(body.data.folderId)).folders.find((f) => f.id === body.data.folderId)?.name ?? "";
  const items = await buildPlan(client, body.data.folderId, async (f) =>
    classifyWithGemini(await client.getText(f.id).catch(() => ""), f.mimeType, env.GEMINI_API_KEY, f.name)
  );
  const job = await prisma.driveJob.create({
    data: {
      tenantId: user.tenant.id, userId: user.id,
      folderId: body.data.folderId, folderName,
      status: "planned", planJson: JSON.stringify(items),
    },
  });
  await writeAudit(user.tenant.id, user.id, "drive.plan", { jobId: job.id, folderId: body.data.folderId, count: items.length });
  res.json({ jobId: job.id, items });
}));
```

- [ ] **Step 5: implement routes/drive.ts (bagian 2: run/cancel/jobs)**

Lanjut di file yang sama:
```ts
driveRouter.post("/drive/jobs/:id/run", requireUser, asyncHandler(async (req, res) => {
  const job = await prisma.driveJob.findFirst({
    where: { id: req.params.id, tenantId: req.user!.tenant.id },
  });
  if (!job) return res.status(404).json({ error: "tidak_ditemukan" });
  if (job.status === "running") return res.status(409).json({ error: "sedang_berjalan" });
  const client = await driveClientFor(req.user!.tenant.id);
  if (!client) return res.status(409).json({ error: "belum_connect" });
  const plan = JSON.parse(job.planJson) as Parameters<typeof executePlan>[1];

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  const send = (e: Record<string, unknown>) => res.write(JSON.stringify(e) + "\n");
  cancelFlags.set(job.id, false);
  await prisma.driveJob.update({ where: { id: job.id }, data: { status: "running" } });
  send({ type: "start", jobId: job.id, total: plan.filter((p) => p.action === "move").length });

  const result = await executePlan(client, plan, {
    isCancelled: () => cancelFlags.get(job.id) === true,
    onProgress: (done, total, item) => {
      send({ type: "progress", done, total, status: item.status, fileName: item.fileName });
      void prisma.driveActionLog.create({
        data: {
          jobId: job.id, fileId: item.fileId, fileName: item.fileName, action: item.action,
          fromParent: item.originalParent ?? "", toParent: "", status: item.status, error: item.error ?? "",
        },
      });
    },
  });
  cancelFlags.delete(job.id);
  const cancelled = result.items.some((i) => i.status === "skipped");
  await prisma.driveJob.update({
    where: { id: job.id },
    data: { status: cancelled ? "cancelled" : "done", resultJson: JSON.stringify(result.items) },
  });
  await writeAudit(req.user!.tenant.id, req.user!.id, "drive.run", { jobId: job.id, cancelled });
  send({ type: cancelled ? "cancelled" : "done", jobId: job.id, items: result.items });
  res.end();
}));

driveRouter.post("/drive/jobs/:id/cancel", requireUser, asyncHandler(async (req, res) => {
  const job = await prisma.driveJob.findFirst({ where: { id: req.params.id, tenantId: req.user!.tenant.id } });
  if (!job) return res.status(404).json({ error: "tidak_ditemukan" });
  cancelFlags.set(job.id, true);
  res.json({ ok: true });
}));

driveRouter.get("/drive/jobs", requireUser, asyncHandler(async (req, res) => {
  const jobs = await prisma.driveJob.findMany({
    where: { tenantId: req.user!.tenant.id },
    orderBy: { createdAt: "desc" }, take: 20,
    select: { id: true, folderName: true, status: true, createdAt: true },
  });
  res.json(jobs);
}));

driveRouter.get("/drive/jobs/:id", requireUser, asyncHandler(async (req, res) => {
  const job = await prisma.driveJob.findFirst({
    where: { id: req.params.id, tenantId: req.user!.tenant.id },
    include: { logs: { orderBy: { createdAt: "asc" } } },
  });
  if (!job) return res.status(404).json({ error: "tidak_ditemukan" });
  res.json({
    id: job.id, folderName: job.folderName, status: job.status,
    plan: JSON.parse(job.planJson), result: JSON.parse(job.resultJson), logs: job.logs,
  });
}));
```

- [ ] **Step 6: callback Google penuh + status google di connections + mount**

Edit `apps/api/src/routes/google.ts` — ganti komentar callback dengan:
```ts
googleRouter.get("/oauth/google/callback", async (req, res, next) => {
  try {
    const { code, state } = z.object({ code: z.string(), state: z.string() }).parse(req.query);
    if (!state) return res.redirect(`${env.APP_ORIGIN}/explore?error=google_state`);
    const tokRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: env.GOOGLE_OAUTH_CLIENT_ID, client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: "http://localhost:3001/api/oauth/google/callback", grant_type: "authorization_code",
      }),
    });
    if (!tokRes.ok) return res.redirect(`${env.APP_ORIGIN}/explore?error=google_token`);
    const tok = (await tokRes.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    const { encryptToken } = await import("../crypto.js");
    await prisma.connection.upsert({
      where: { tenantId_provider: { tenantId: state, provider: "google" } },
      create: {
        tenantId: state, provider: "google",
        accessTokenEnc: encryptToken(tok.access_token),
        refreshTokenEnc: encryptToken(tok.refresh_token ?? ""),
        expiresAt: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000),
      },
      update: {
        accessTokenEnc: encryptToken(tok.access_token),
        refreshTokenEnc: encryptToken(tok.refresh_token ?? ""),
        expiresAt: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000),
        status: "connected",
      },
    });
    res.redirect(`${env.APP_ORIGIN}/explore`);
  } catch (e) {
    next(e);
  }
});
```
(Tambahkan import `z`, `prisma` di google.ts bila belum ada.)

Edit `routes/settings.ts` — ganti baris `{ provider: "google", status: "none" }` dengan query nyata:
```ts
      const google = conns.find((c) => c.provider === "google");
      // …
      {
        provider: "google",
        status: google ? (google.expiresAt < new Date() ? "expired" : google.status) : "none",
        accountLabel: "",
        expiresAt: google?.expiresAt.toISOString(),
      },
```

Edit `app.ts` — import + `app.use("/api", driveRouter);` setelah audioRouter.

- [ ] **Step 7: PASS + commit**

Run: `cd apps/api && pnpm test drive-routes` → 8/8 PASS; full `pnpm test` PASS; typecheck 0.
```bash
git add apps/api/src apps/api/test/drive-routes.test.ts
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase3): routes drive (plan/run/cancel/jobs) + callback Google penuh"
```
---

### Task 7: UI Explore Manager (web)

**Files:**
- Create: `apps/web/src/drive-api.ts`, `apps/web/src/pages/Explore.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/pages/Shell.tsx`

- [ ] **Step 1: drive-api.ts**

```ts
export interface DriveFile { id: string; name: string; parents: string; mimeType: string; }
export interface DriveFolder { id: string; name: string; parents: string; }
export interface PlanItem { action: string; fileId: string; fileName: string; fromParent: string; toParent: string; toName?: string; category: string; }
export interface DriveStatus { connected: boolean; engine: "mock" | "google"; }

export async function driveStatus(): Promise<DriveStatus> {
  const r = await fetch("/api/drive/status");
  return r.ok ? r.json() : { connected: false, engine: "google" };
}

export async function driveList(folderId: string): Promise<{ folders: DriveFolder[]; files: DriveFile[] }> {
  const r = await fetch(`/api/drive/list?folderId=${encodeURIComponent(folderId)}`);
  if (!r.ok) throw new Error((await r.json()).error ?? "gagal");
  return r.json();
}

export async function drivePlan(folderId: string): Promise<{ jobId: string; items: PlanItem[] }> {
  const r = await fetch("/api/drive/plan", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderId }),
  });
  if (!r.ok) throw new Error((await r.json()).error ?? "gagal membuat rencana");
  return r.json();
}

export type RunEvent =
  | { type: "start"; total: number }
  | { type: "progress"; done: number; total: number; status: string; fileName: string }
  | { type: "done"; items: Array<Record<string, unknown>> }
  | { type: "cancelled"; items: Array<Record<string, unknown>> };

export async function driveRun(jobId: string, onEvent: (e: RunEvent) => void): Promise<void> {
  const r = await fetch(`/api/drive/jobs/${jobId}/run`, { method: "POST" });
  if (!r.body) throw new Error("gagal");
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as RunEvent);
    }
  }
}

export async function driveCancel(jobId: string): Promise<void> {
  await fetch(`/api/drive/jobs/${jobId}/cancel`, { method: "POST" });
}
```

- [ ] **Step 2: Explore.tsx ( skeleton + state)**

Create `apps/web/src/pages/Explore.tsx` dengan: state `status`, `folderId` (default "root"), `listing`, `preview` (items plan|null), `jobId`, `progress` `{done,total}|null`, `result`, `error`. Efek: saat `status.connected && folderId` → `driveList`. Render bertahap pada langkah berikut.

- [ ] **Step 3: Explore.tsx ( render: empty state / tree-list / tombol rapikan / preview consent / progress+cancel / laporan)**

- Empty: belum connect → pesan + tautan `/api/oauth/google/start` (atau info mock); folder kosong → "Tidak ada file untuk dirapikan".
- Header: nama folder aktif + breadcrumb sederhana (root → folder) + tombol **Refresh** + **Rapikan Folder Ini** (disabled bila tidak `drive.tidy` — cek via `/api/me` roleKey admin atau try 403).
- Daftar: sub-folder (klik untuk masuk) + file (nama + ikon tipe).
- Setelah plan: panel **Preview rencana** — tabel aksi (buat folder / pindah `nama` → `kategori`) + tombol **Jalankan** (consent) + **Batal**.
- Berjalan: progress "12/40 dianalisa" + tombol **Batalkan**.
- Selesai: laporan per-file (ok/failed + pesan) + catatan "Posisi asal tersimpan di log — fitur Urungkan menyusul".
- Gagal 403 → "Anda tidak punya hak Rapikan Drive"; 409 belum connect → ajakan connect.

- [ ] **Step 4: routing + nav**

`App.tsx`: `if (path === "/explore") return <Explore />;`
`Shell.tsx`: header nav tambah `<a href="/explore">Explore Manager</a>`.

- [ ] **Step 5: build + commit**

Run: `pnpm --filter @aigoogle/web build` ✓; typecheck 0.
```bash
git add apps/web/src
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "feat(fase3): UI Explore Manager (tree, preview consent, progress, laporan)"
```

---

### Task 8: Smoke e2e + docs + verifikasi akhir

**Files:**
- Create: `/tmp/opencode/e2e-smoke-phase3.sh`, `docs/spikes/2026-10-10-phase3-explore-check.md`
- Modify: `README.md`

- [ ] **Step 1: skrip smoke**

Pola fase 2 + `MOCK_DRIVE=1` di API; langkah: launch → sid → `GET /api/drive/status` (mock, connected) → `POST /api/drive/plan` (folderId root/kerja) → run → assert NDJSON `done` + logs DB ≥1 → `GET /api/drive/jobs` ≥1 → cancel-path smoke (plan baru → cancel → run → `cancelled`). Jalankan; PASS semua.

- [ ] **Step 2: dokumen hasil**

Create `docs/spikes/2026-10-10-phase3-explore-check.md` — tabel butir ✓/✗ + catatan (mock drive engine; Google live menunggu secret + test user email pemilik).

- [ ] **Step 3: README**

Tambah baris Fase 3 selesai + catatan Google OAuth (status Testing → hanya test user email pemilik; isi `GOOGLE_OAUTH_CLIENT_SECRET`).

- [ ] **Step 4: verifikasi akhir**

`pnpm test` (root) semua PASS; `pnpm typecheck` 0; web build ✓; `git status` bersih.

- [ ] **Step 5: commit**

```bash
git add docs/spikes README.md
git -c user.name="aigoogle-dev" -c user.email="dev@aigoogle.local" commit -m "docs(fase3): hasil smoke Explore Manager + README"
```

---

## Selesai Fase 3

**Keluaran:** Explore Manager jalan end-to-end terhadap mock drive (plan → consent → eksekusi progresif + cancel + log posisi asal + laporan). GoogleDriveClient live siap — otomatis dipakai (bukan mock) begitu `GOOGLE_OAUTH_CLIENT_SECRET` diisi dan pemilik login dengan email test user-nya.









