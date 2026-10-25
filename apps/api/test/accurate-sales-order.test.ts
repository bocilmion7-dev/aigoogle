import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp as createMockApp } from "@mock/accurate";
import { AccurateAdapter } from "../src/providers/accounting/accurate.js";
import type { ProviderCtx } from "../src/providers/accounting/types.js";

let server: Server;
let adapter: AccurateAdapter;
let ctx: ProviderCtx;

beforeAll(async () => {
  server = createMockApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  adapter = new AccurateAdapter({ clientId: "c", clientSecret: "s", apiBase: base });
  const url = new URL(adapter.authorizeUrl({ redirectUri: "http://x/cb", state: "s" }));
  url.searchParams.set("user", "admin");
  const res = await fetch(url, { redirect: "manual" });
  const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
  const tok = await adapter.exchangeCode(code, "http://x/cb");
  const open = await adapter.openDb(tok.accessToken, "1001");
  ctx = { tenantId: "t1", host: open.host, session: open.session, accessToken: tok.accessToken };
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

async function customerCount(): Promise<number> {
  const r = (await adapter.execute("customer.list", { pageSize: 100 }, ctx)) as { items: unknown[] };
  return r.items.length;
}

describe("pelanggan dari WhatsApp (mock Accurate)", () => {
  it("cari by nomor HP dulu; dibuat baru bila belum ada, lalu ditemukan lagi", async () => {
    const before = await customerCount();
    const created = await adapter.findOrCreateCustomer(ctx, {
      name: "Rina",
      phone: "628123450000",
      createName: "Rina (WA)",
      description: "Pembeli WhatsApp 628123450000",
    });
    expect(created?.customerNo).toBeTruthy();
    expect(created?.name).toBe("Rina (WA)");
    expect(await customerCount()).toBe(before + 1);

    const again = await adapter.findOrCreateCustomer(ctx, {
      name: "Rina",
      phone: "628123450000",
      createName: "Rina (WA)",
    });
    expect(again?.customerNo).toBe(created?.customerNo);
    expect(await customerCount()).toBe(before + 1);
  });

  it("tanpa createName & tidak ditemukan → null (UI minta isi nama)", async () => {
    const r = await adapter.findOrCreateCustomer(ctx, { name: "Tidak Ada", phone: "620000000000" });
    expect(r).toBeNull();
  });

  it("listCustomers mendukung kata kunci", async () => {
    const rows = await adapter.listCustomers(ctx, { keywords: "Budi" });
    expect(rows.some((c) => c.name === "Budi Santoso")).toBe(true);
    expect(rows[0]?.customerNo).toBeTruthy();
  });
});

describe("dokumen penjualan (mock Accurate)", () => {
  it("sales order memakai itemNo + customerNo, nomornya terbaca", async () => {
    const so = await adapter.createSalesOrder(ctx, {
      customerNo: "CSBY-0001",
      description: "Pesanan WhatsApp uji",
      items: [{ itemNo: "BRG-001", qty: 2, price: 250000 }],
    });
    expect(so.number).toBeTruthy();
    expect(so.id).toBeTruthy();
    const list = (await adapter.execute("salesOrder.list", { keywords: so.number }, ctx)) as {
      items: Array<{ number: string }>;
    };
    expect(list.items.some((x) => x.number === so.number)).toBe(true);
  });

  it("faktur & penerimaan kas bisa berantai (nomor faktur dipakai di kas)", async () => {
    const invoice = await adapter.createSalesInvoice(ctx, {
      customerName: "Budi Santoso",
      description: "Pesanan WhatsApp uji",
      items: [{ name: "Kertas A4", qty: 1, price: 250000 }],
    });
    expect(invoice.number).toBeTruthy();
    const receipt = await adapter.createSalesReceipt(ctx, {
      customerName: "Budi Santoso",
      amount: 250000,
      invoiceNo: invoice.number,
      description: "Pembayaran QRIS",
    });
    expect(receipt.number).toBeTruthy();
  });

  it("faktur & penerimaan kas bisa berantai (nomor faktur dipakai di kas)", async () => {
    const invoice = await adapter.createSalesInvoice(ctx, {
      customerName: "Budi Santoso",
      description: "Pesanan WhatsApp uji",
      items: [{ name: "Kertas A4", qty: 1, price: 250000 }],
    });
    expect(invoice.number).toBeTruthy();
    const receipt = await adapter.createSalesReceipt(ctx, {
      customerName: "Budi Santoso",
      amount: 250000,
      invoiceNo: invoice.number,
      description: "Pembayaran QRIS",
    });
    expect(receipt.number).toBeTruthy();
  });

  it("ongkos kirim ikut total faktur (detailExpense) — total = barang + ongkir", async () => {
    const invoice = await adapter.createSalesInvoice(ctx, {
      customerName: "Budi Santoso",
      description: "Pesanan WA + ongkir",
      items: [{ name: "Tinta Printer", qty: 1, price: 85000 }],
      shipping: { amount: 21000, name: "Ongkir JNE REG" },
    });
    const list = (await adapter.execute("salesInvoice.list", { keywords: invoice.number, fields: "id,number,totalAmount,detailExpense" }, ctx)) as {
      items: Array<{ number: string; totalAmount: number }>;
    };
    const row = list.items.find((x) => x.number === invoice.number)!;
    expect(row).toBeTruthy();
    // 1 barang 85.000 + ongkir 21.000 — bukan barang saja
    expect(Number(row.totalAmount)).toBe(106000);
  });

  it("penerimaan kas melebihi sisa piutang → dibatasi ke sisa piutang (tidak error)", async () => {
    const invoice = await adapter.createSalesInvoice(ctx, {
      customerName: "Budi Santoso",
      description: "Uji cap piutang",
      items: [{ name: "Kertas A4", qty: 2, price: 250000 }],
    });
    // minta bayar 2.000.000 padahal piutang faktur hanya 500.000
    const receipt = await adapter.createSalesReceipt(ctx, {
      customerName: "Budi Santoso",
      amount: 999999,
      invoiceNo: invoice.number,
      description: "Pembayaran melebihi",
    });
    expect(receipt.number).toBeTruthy();
    const list = (await adapter.execute("salesReceipt.list", { keywords: receipt.number, fields: "id,number,chequeAmount,detailInvoice" }, ctx)) as {
      items: Array<{ number: string; chequeAmount?: unknown; detailInvoice?: Array<{ paymentAmount?: unknown }> }>;
    };
    const stored = list.items.find((x) => x.number === receipt.number);
    expect(Number(stored?.chequeAmount ?? 0)).toBe(500000);
    expect(Number(stored?.detailInvoice?.[0]?.paymentAmount)).toBe(500000);
  });

  it("faktur sudah lunas → penerimaan kas ditolak dengan pesan jelas", async () => {
    const invoice = await adapter.createSalesInvoice(ctx, {
      customerName: "Budi Santoso",
      items: [{ name: "Kertas A4", qty: 1, price: 100000 }],
    });
    await adapter.createSalesReceipt(ctx, { customerName: "Budi Santoso", amount: 100000, invoiceNo: invoice.number });
    // piutang sudah 0 (dibayar receipt pertama) → percobaan bayar lagi ditolak
    await expect(
      adapter.createSalesReceipt(ctx, { customerName: "Budi Santoso", amount: 100000, invoiceNo: invoice.number })
    ).rejects.toThrow(/sudah lunas/i);
  });

  it("closeSalesOrder tidak melempar untuk nomor valid", async () => {
    const so = await adapter.createSalesOrder(ctx, {
      customerNo: "CSBY-0001",
      items: [{ itemNo: "BRG-002", qty: 1, price: 85000 }],
    });
    await expect(adapter.closeSalesOrder(ctx, { number: so.number })).resolves.toBeUndefined();
  });

  it("harga item kosong ditolak sebelum memanggil API", async () => {
    await expect(
      adapter.createSalesOrder(ctx, {
        customerNo: "CSBY-0001",
        items: [{ itemNo: "BRG-001", qty: 1, price: 0 }],
      })
    ).rejects.toThrow(/harga item/i);
  });
});
