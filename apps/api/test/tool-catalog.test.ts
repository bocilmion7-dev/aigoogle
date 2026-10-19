import { describe, expect, it } from "vitest";
import { ACCURATE_CATALOG } from "../src/providers/accounting/catalog.js";
import { AGGREGATION_TOOLS } from "../src/providers/accounting/aggregation.js";
import { selectTools } from "../src/ai/tool-selector.js";

const find = (n: string) => ACCURATE_CATALOG.find((t) => t.name === n);

describe("katalog tool — skema param aksi read", () => {
  it("katalog tetap cakupan penuh 366 aksi", () => {
    expect(ACCURATE_CATALOG).toHaveLength(366);
  });

  it.each([
    ["glaccount.get-pl-account-amount", ["fromDate", "toDate"]],
    ["glaccount.get-bs-account-amount", ["asOfDate"]],
    ["glaccount.get-balance", ["no"]],
    ["salesInvoice.detail-invoice", ["customerNo"]],
    ["item.get-stock", ["no"]],
    ["item.get-selling-price", ["no"]],
    ["item.get-nearest-cost", ["itemNo"]],
    ["currency.exchange-rate", ["code"]],
  ])("%s punya required %j sesuai OpenAPI", (name, required) => {
    const t = find(name);
    expect(t, `${name} tidak ada di katalog`).toBeDefined();
    expect(t!.jsonSchema.required).toEqual(required);
    for (const r of required) {
      expect(Object.keys(t!.jsonSchema.properties as object)).toContain(r);
    }
  });

  it("item.list-stock punya filter stok, bukan skema daftar murni", () => {
    const props = find("item.list-stock")!.jsonSchema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("asOfDate");
    expect(props).toHaveProperty("warehouseName");
    // tetap mendukung paginasi lewat nama yang dimengerti buildQuery
    expect(props).toHaveProperty("pageSize");
  });

  it("aksi .list biasa tetap memakai skema daftar (fields/keywords/filter)", () => {
    const t = find("customer.list")!;
    const props = t.jsonSchema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("keywords");
    expect(props).toHaveProperty("filter");
    expect(t.jsonSchema).not.toHaveProperty("required");
  });

  it("aksi .detail punya kunci alternatif (id ATAU kode) — OpenAPI menyebutnya 'alternatif dari id'", () => {
    const t = find("customer.detail")!;
    const props = t.jsonSchema.properties as Record<string, { type?: string }>;
    expect(t.jsonSchema.required).toBeUndefined();
    expect(t.oneOfRequired).toEqual(["id", "customerNo"]);
    expect(props.customerNo).toBeDefined();
    expect(props.customerNo!.type).toBe("string");
    // id bertipe INTEGER — dulu string, model kirim "USD" lalu provider menolak
    expect(props.id!.type).toBe("number");
  });

  it("semua tool .detail memakai id numerik, bukan string", () => {
    const details = ACCURATE_CATALOG.filter((t) => /\bdetail\b/.test(t.name) && !t.unavailable);
    expect(details.length).toBeGreaterThan(40);
    for (const t of details) {
      const props = (t.jsonSchema.properties ?? {}) as Record<string, { type?: string }>;
      if (!props.id) continue; // sales-checkin/detail.do memang tak punya param id
      expect(props.id.type, t.name).toBe("number");
    }
  });

  it("tool .detail tanpa kunci alternatif tetap mewajibkan id", () => {
    const t = find("currency.detail")!;
    expect(t.jsonSchema.required).toEqual(["id"]);
    expect(t.oneOfRequired).toBeUndefined();
  });

  it("deskripsi tool read non-list/detail menjelaskan argumen wajibnya", () => {
    expect(find("glaccount.get-pl-account-amount")!.description).toMatch(/fromDate/);
    expect(find("salesInvoice.detail-invoice")!.description).toMatch(/customerNo/);
  });
});

describe("tool docsOnly (path tak ada di API Accurate asli)", () => {
  it("ditandai unavailable di katalog", () => {
    const unavailable = ACCURATE_CATALOG.filter((t) => t.unavailable);
    expect(unavailable.length).toBeGreaterThan(0);
    expect(find("report.list")!.unavailable).toBe(true);
    expect(find("report.detail")!.unavailable).toBe(true);
  });

  it("selectTools tidak pernah mengembalikan tool unavailable", () => {
    const queries = [
      "tampilkan laporan laba rugi saya",
      "ringkasan penjualan bulan ini",
      "cek stok barang",
      "daftar pelanggan saya",
      "halo",
    ];
    for (const q of queries) {
      const names = selectTools(q).map((t) => t.name);
      expect(names, q).not.toContain("report.list");
      expect(names, q).not.toContain("report.detail");
      expect(names.some((n) => find(n)?.unavailable), q).toBe(false);
    }
  });

  it("kueri laba rugi tetap menyertakan tool pelaporan yang berfungsi", () => {
    const names = selectTools("tampilkan laporan laba rugi saya").map((t) => t.name);
    expect(names).toContain("glaccount.get-pl-account-amount");
    expect(names).toContain("glaccount.get-bs-account-amount");
  });

  it("tool agregasi selalu ikut — termasuk saat fallback tanpa keyword modul ('halo')", () => {
    // panggil seperti rute chat (capabilityCatalog = catalog + agregasi)
    const catalog = [...ACCURATE_CATALOG, ...AGGREGATION_TOOLS];
    const names = selectTools("halo", catalog).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "customer.lastOrderByName",
        "salesInvoice.summary",
        "purchaseInvoice.summary",
        "vendor.lastPurchaseByName",
        "vendor.unpaidByName",
        "vendor.summaryByName",
        "customer.salesByName",
        "vendor.purchasesByName",
        "salesInvoice.perCustomer",
        "purchaseInvoice.perVendor",
        "item.topSelling",
        "item.byName",
        "finance.overview",
        "cashflow.summary",
        "receivables.summary",
        "payables.summary",
        "gl.plSummary",
        "gl.bsSummary",
      ])
    );
  });
});
