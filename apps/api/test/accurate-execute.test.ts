import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp as createMockApp } from "@mock/accurate";
import { AccurateAdapter } from "../src/providers/accounting/accurate.js";
import type { ProviderCtx } from "../src/providers/accounting/types.js";

let server: Server;
let base: string;
let adapter: AccurateAdapter;
let adminCtx: ProviderCtx;
let staffCtx: ProviderCtx;

async function loginCtx(user: string, dbId: string): Promise<ProviderCtx> {
  const url = new URL(adapter.authorizeUrl({ redirectUri: "http://x/cb", state: "s" }));
  url.searchParams.set("user", user);
  const res = await fetch(url, { redirect: "manual" });
  const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
  const tok = await adapter.exchangeCode(code, "http://x/cb");
  const open = await adapter.openDb(tok.accessToken, dbId);
  return { tenantId: `t-${user}`, host: open.host, session: open.session, accessToken: tok.accessToken };
}

beforeAll(async () => {
  server = createMockApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  adapter = new AccurateAdapter({ clientId: "c", clientSecret: "s", apiBase: base });
  adminCtx = await loginCtx("admin", "1001");
  staffCtx = await loginCtx("staff", "1001");
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

describe("AccurateAdapter execute/refresh/privilege", () => {
  it("customer.list admin → data mock PT Maju Jaya", async () => {
    const r = await adapter.execute("customer.list", {}, adminCtx);
    const d = (r as { items: Array<{ name: string }> }).items;
    expect(d.map((c) => c.name)).toContain("Budi Santoso");
  });

  it("salesInvoice.list admin → ada transaksi total", async () => {
    const r = await adapter.execute("salesInvoice.list", {}, adminCtx);
    const d = (r as { items: Array<{ totalAmount: number }> }).items;
    expect(d.length).toBeGreaterThan(0);
    expect(typeof d[0].totalAmount).toBe("number");
  });

  it("staff tanpa hak customer → execute throw (provider gagal)", async () => {
    await expect(adapter.execute("customer.list", {}, staffCtx)).rejects.toThrow();
  });

  it("refreshToken → token baru berbeda", async () => {
    const url = new URL(adapter.authorizeUrl({ redirectUri: "http://x/cb", state: "s" }));
    url.searchParams.set("user", "admin");
    const res = await fetch(url, { redirect: "manual" });
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
    const tok = await adapter.exchangeCode(code, "http://x/cb");
    const refreshed = await adapter.refreshToken(tok.refreshToken);
    expect(refreshed.accessToken).not.toBe(tok.accessToken);
    expect(refreshed.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("privilegeCatalog → kelompok Administrator + Staff Penjualan; admin melihat modul view", async () => {
    const groups = await adapter.privilegeCatalog(adminCtx);
    const admin = groups.find((g) => g.id === "priv-admin")!;
    expect(admin.allowViewModules).toEqual(expect.arrayContaining(["customer", "sales-invoice"]));
  });

  it("capabilityCatalog → 366 tool cakupan penuh + 13 tool agregasi, teranotasi permission", () => {
    const cat = adapter.capabilityCatalog();
    expect(cat).toHaveLength(379);
    expect(cat.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "customer.detail", "customer.list", "glaccount.list", "item.list",
        "purchaseInvoice.detail", "salesInvoice.detail", "salesInvoice.list",
        "salesOrder.list", "salesReceipt.list", "vendor.list",
      ])
    );
    expect(cat.every((t) => t.requiredPermission.startsWith("accurate:"))).toBe(true);
  });

  it("salesInvoice.list dengan fields+keywords → row terfilter", async () => {
    const d = (
      (await adapter.execute("salesInvoice.list", { fields: "number,totalAmount", keywords: "SI.2026.10.00001" }, adminCtx)) as {
        items: Array<Record<string, unknown>>;
      }
    ).items;
    expect(d[0]).toEqual({ number: "SI.2026.10.00001", totalAmount: 2500000 });
  });

  it("item.list & glAccount.list admin → ada data", async () => {
    const items = ((await adapter.execute("item.list", {}, adminCtx)) as { items: Array<{ name: string }> }).items;
    expect(items.map((i) => i.name)).toContain("Kertas A4");
    const accounts = ((await adapter.execute("glaccount.list", {}, adminCtx)) as { items: Array<{ no: string }> }).items;
    expect(accounts.map((a) => a.no)).toContain("1000");
  });

  it("customer.detail id C-001 → Budi Santoso; id salah → throw", async () => {
    const d = (await adapter.execute("customer.detail", { id: "C-001" }, adminCtx)) as Array<{ name: string }>;
    expect(d[0].name).toBe("Budi Santoso");
    await expect(adapter.execute("customer.detail", { id: "XXX" }, adminCtx)).rejects.toThrow();
  });

  describe("tool agregasi server-side", () => {
    it("customer.lastOrderByName → pesanan terakhir pelanggan tanpa tahu ID", async () => {
      const r = (await adapter.execute("customer.lastOrderByName", { name: "Budi" }, adminCtx)) as {
        customer: { customerNo: string; name: string };
        lastOrder: { number: string } | null;
      };
      expect(r.customer.name).toBe("Budi Santoso");
      expect(r.lastOrder?.number).toBe("SI.2026.10.00001");
    });

    it("customer.unpaidByName → total piutang belum dibayar", async () => {
      const r = (await adapter.execute("customer.unpaidByName", { name: "Budi" }, adminCtx)) as {
        customer: { customerNo: string };
        totalUnpaid: number;
        countUnpaid: number;
      };
      expect(r.customer.customerNo).toBe("CSBY-0001");
      expect(r.totalUnpaid).toBe(2500000);
      expect(r.countUnpaid).toBe(1);
    });

    it("customer.summaryByName → ringkasan pelanggan", async () => {
      const r = (await adapter.execute("customer.summaryByName", { name: "Budi" }, adminCtx)) as {
        customer: { name: string };
        summary: { invoiceCount: number; totalSales: number };
      };
      expect(r.customer.name).toBe("Budi Santoso");
      expect(r.summary.invoiceCount).toBe(1);
      expect(r.summary.totalSales).toBe(2500000);
    });

    it("salesInvoice.summary → ringkasan penjualan periode", async () => {
      const r = (await adapter.execute("salesInvoice.summary", { fromDate: "01/10/2026", toDate: "31/10/2026" }, adminCtx)) as {
        summary: { invoiceCount: number; totalSales: number };
      };
      expect(r.summary.invoiceCount).toBe(1);
      expect(r.summary.totalSales).toBe(2500000);
    });

    it("purchaseInvoice.summary → ringkasan pembelian periode (filter BETWEEN di mock)", async () => {
      const r = (await adapter.execute("purchaseInvoice.summary", { fromDate: "01/10/2026", toDate: "31/10/2026" }, adminCtx)) as {
        summary: { invoiceCount: number; totalPurchase: number };
        invoices: Array<{ number: string }>;
      };
      expect(r.summary.invoiceCount).toBe(1);
      expect(r.summary.totalPurchase).toBe(800000);
      expect(r.invoices[0]?.number).toBe("PI.2026.10.00001");
    });

    it("vendor.lastPurchaseByName → pembelian terakhir pemasok tanpa tahu ID", async () => {
      const r = (await adapter.execute("vendor.lastPurchaseByName", { name: "CV Sentosa" }, adminCtx)) as {
        vendor: { vendorNo: string; name: string };
        lastPurchase: { number: string } | null;
      };
      expect(r.vendor.vendorNo).toBe("VJKT-0001");
      expect(r.lastPurchase?.number).toBe("PI.2026.10.00001");
    });

    it("vendor.unpaidByName → total utang belum dibayar pemasok", async () => {
      const r = (await adapter.execute("vendor.unpaidByName", { name: "CV Sentosa" }, adminCtx)) as {
        vendor: { vendorNo: string };
        totalUnpaid: number;
        countUnpaid: number;
      };
      expect(r.vendor.vendorNo).toBe("VJKT-0001");
      expect(r.totalUnpaid).toBe(800000);
      expect(r.countUnpaid).toBe(1);
    });

    it("vendor.summaryByName → ringkasan pemasok (pembelian + utang)", async () => {
      const r = (await adapter.execute("vendor.summaryByName", { name: "CV Sentosa" }, adminCtx)) as {
        vendor: { name: string };
        summary: { invoiceCount: number; totalPurchase: number; unpaidCount: number };
      };
      expect(r.vendor.name).toBe("CV Sentosa Mandiri");
      expect(r.summary).toMatchObject({ invoiceCount: 1, totalPurchase: 800000, unpaidCount: 1 });
    });

    it("pemasok tidak ditemukan → error informatif, bukan throw", async () => {
      const r = (await adapter.execute("vendor.lastPurchaseByName", { name: "Tidak Ada" }, adminCtx)) as { error: string };
      expect(r.error).toContain("tidak ditemukan");
    });

    it("salesInvoice.perCustomer → penjualan dikelompokkan per pelanggan", async () => {
      const r = (await adapter.execute("salesInvoice.perCustomer", { fromDate: "01/10/2026", toDate: "31/10/2026" }, adminCtx)) as {
        summary: { customerCount: number; invoiceCount: number; totalSales: number };
        customers: Array<{ customerNo: string; name: string; invoiceCount: number; total: number }>;
      };
      expect(r.summary).toMatchObject({ customerCount: 1, invoiceCount: 1, totalSales: 2500000 });
      expect(r.customers[0]).toMatchObject({ customerNo: "CSBY-0001", name: "Budi Santoso", invoiceCount: 1, total: 2500000 });
    });

    it("item.topSelling → barang terlaris dari detailItem tiap faktur", async () => {
      const r = (await adapter.execute("item.topSelling", { fromDate: "01/10/2026", toDate: "31/10/2026" }, adminCtx)) as {
        summary: { invoicesScanned: number; detailErrors: number };
        items: Array<{ itemName: string; quantity: number; amount: number }>;
      };
      expect(r.summary.invoicesScanned).toBe(1);
      expect(r.summary.detailErrors).toBe(0);
      expect(r.items[0]).toMatchObject({ itemName: "Kertas A4", quantity: 10, amount: 2500000 });
    });

    it("receivables.summary → total piutang usaha global + daftar per pelanggan", async () => {
      const r = (await adapter.execute("receivables.summary", {}, adminCtx)) as {
        summary: { totalReceivables: number; invoiceCount: number; customerCount: number };
        customers: Array<{ customerNo: string; name: string; invoiceCount: number; total: number }>;
      };
      expect(r.summary).toMatchObject({ totalReceivables: 2500000, invoiceCount: 1, customerCount: 1 });
      expect(r.customers[0]).toMatchObject({ customerNo: "CSBY-0001", name: "Budi Santoso", invoiceCount: 1, total: 2500000 });
    });

    it("payables.summary → total utang usaha global + daftar per pemasok", async () => {
      const r = (await adapter.execute("payables.summary", {}, adminCtx)) as {
        summary: { totalPayables: number; invoiceCount: number; vendorCount: number };
        vendors: Array<{ vendorNo: string; name: string; invoiceCount: number; total: number }>;
      };
      expect(r.summary).toMatchObject({ totalPayables: 800000, invoiceCount: 1, vendorCount: 1 });
      expect(r.vendors[0]).toMatchObject({ vendorNo: "VJKT-0001", name: "CV Sentosa Mandiri", invoiceCount: 1, total: 800000 });
    });

    it("gl.plSummary → laba rugi dihitung dari akun P&L (leaf saja)", async () => {
      const r = (await adapter.execute("gl.plSummary", {}, adminCtx)) as {
        summary: {
          revenue: number; costOfGoodsSold: number; grossProfit: number;
          operatingExpense: number; otherIncome: number; otherExpense: number; netProfit: number;
        };
        topAccounts: { revenue: Array<{ accountName: string; amount: number }> };
      };
      expect(r.summary).toEqual({
        revenue: 10000000,
        costOfGoodsSold: 6000000,
        grossProfit: 4000000,
        operatingExpense: 2500000,
        otherIncome: 500000,
        otherExpense: 100000,
        netProfit: 1900000,
      });
      expect(r.topAccounts.revenue[0]).toMatchObject({ accountName: "Penjualan Barang", amount: 10000000 });
    });

    it("pelanggan tidak ditemukan → error informatif, bukan throw", async () => {
      const r = (await adapter.execute("customer.lastOrderByName", { name: "Tidak Ada" }, adminCtx)) as {
        error: string;
      };
      expect(r.error).toContain("tidak ditemukan");
    });
  });
});
