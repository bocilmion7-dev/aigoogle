import { describe, expect, it } from "vitest";
import { listFieldsFor } from "../src/providers/accounting/accurate.js";
import { ACCURATE_CATALOG } from "../src/providers/accounting/catalog.js";

/**
 * Latar belakang: Accurate MEMBUANG diam-diam nama kolom yang tidak dikenal (tanpa error).
 * Daftar lama meminta no/customerName/date/total/status/code/unit/sellingPrice — semua
 * tak dikenal → hasil tanpa nomor transaksi → model MENGARANG nomor (kasus: "INV-2050"
 * dari id 2050, nomor asli SI.2017.01.00010).
 */
describe("kolom default daftar (diverifikasi langsung ke API Accurate)", () => {
  it.each([
    ["salesInvoice.list", ["number", "transDate", "totalAmount", "customerNo", "customer", "approvalStatus"]],
    ["salesReceipt.list", ["number", "transDate", "customer", "customerNo"]],
    ["salesReturn.list", ["number", "transDate", "totalAmount"]],
    ["salesOrder.list", ["number", "transDate", "totalAmount", "status"]],
    ["purchaseInvoice.list", ["number", "transDate", "totalAmount", "vendor"]],
    ["customer.list", ["customerNo", "name", "email"]],
    ["vendor.list", ["vendorNo", "name"]],
    ["item.list", ["no", "name", "quantity"]],
    ["glaccount.list", ["no", "name", "balance", "accountType"]],
    ["currency.list", ["code", "name"]],
  ])("%s memuat kolom %j yang SAH", (tool, cols) => {
    const f = listFieldsFor(tool);
    for (const c of cols) expect(f.split(","), `${tool} → ${c}`).toContain(c);
  });

  it("tidak lagi meminta kolom yang tak dikenal Accurate", () => {
    const kasar = ["customerName", "vendorName", "sellingPrice"];
    expect(listFieldsFor("salesInvoice.list").split(",")).not.toContain("no");
    expect(listFieldsFor("salesInvoice.list").split(",")).not.toContain("date");
    expect(listFieldsFor("salesInvoice.list").split(",")).not.toContain("total");
    expect(listFieldsFor("salesInvoice.list").split(",")).not.toContain("status");
    expect(listFieldsFor("customer.list").split(",")).not.toContain("phone");
    expect(listFieldsFor("customer.list").split(",")).not.toContain("phone1");
    expect(listFieldsFor("item.list").split(",")).not.toContain("code");
    expect(listFieldsFor("item.list").split(",")).not.toContain("unit");
    expect(listFieldsFor("glaccount.list").split(",")).not.toContain("code");
    for (const t of ["salesInvoice.list", "salesReceipt.list", "purchaseInvoice.list"]) {
      for (const bad of kasar) expect(listFieldsFor(t).split(","), t).not.toContain(bad);
    }
  });

  it("semua tool .list aktif mendapat kolom default berisi id + minimal satu kolom pengenal", () => {
    const lists = ACCURATE_CATALOG.filter((t) => t.name.endsWith(".list") && !t.unavailable);
    expect(lists.length).toBeGreaterThan(50);
    for (const t of lists) {
      const fields = listFieldsFor(t.name).split(",");
      expect(fields.length, t.name).toBeGreaterThan(1);
      const pengenal = ["id", "number", "no", "code", "customerNo", "vendorNo", "name"];
      expect(pengenal.some((k) => fields.includes(k)), t.name).toBe(true);
    }
  });

  it("modul yang belum tercantum memakai fallback generik (mencakup nomor transaksi)", () => {
    const f = listFieldsFor("tax.list");
    expect(f).toContain("number");
    expect(f).toContain("no");
    expect(f).toContain("customerNo");
    // dua modul tak terdaftar → fallback identik
    expect(listFieldsFor("unit.list")).toBe(f);
    // modul yang terdaftar pakai daftar sendiri
    expect(listFieldsFor("salesInvoice.list")).not.toBe(f);
  });
});
