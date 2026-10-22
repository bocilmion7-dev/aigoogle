/** Index detail: semua faktur penjualan & pembelian + baris barangnya → gt_detail.json
 *  (ground truth utk pertanyaan relasi 3–4 tabel: pelanggan↔faktur↔barang↔periode) */
import { writeFileSync } from "node:fs";
import { accurateCtxFor } from "../src/providers/accounting/connection.js";
import { accurateProvider } from "../src/providers/accounting/index.js";

const TENANT = process.env.GT_TENANT ?? "cmv51yr7s0000mgox9rn6axlk";
const OUT = process.env.GT_OUT ?? "/tmp/opencode/gt_detail.json";

async function main() {
  const ctx = await accurateCtxFor(TENANT);
  if (!ctx) throw new Error("koneksi Accurate tidak ada");
  const provider = accurateProvider();
  const exec = async (tool: string, args: Record<string, unknown>) => provider.execute(tool, args, ctx);

  async function listAllPages(tool: string, base: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
    const rows: Array<Record<string, unknown>> = [];
    let page = 1;
    for (;;) {
      const res = (await exec(tool, { ...base, page, pageSize: 100 })) as Record<string, unknown>;
      const items = (Array.isArray(res) ? res : ((res as { items?: unknown[] }).items ?? (res as { d?: unknown[] }).d ?? [])) as Array<Record<string, unknown>>;
      rows.push(...items);
      const total = Number((res as { total?: number }).total ?? 0);
      if (items.length === 0 || rows.length >= total || page > 10) break;
      page += 1;
    }
    return rows;
  }

  async function pool<T>(items: T[], limit: number, fn: (i: T) => Promise<void>) {
    let k = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (k < items.length) { const i = k++; await fn(items[i]); }
    }));
  }

  const salesList = await listAllPages("salesInvoice.list", { sort: "id|asc" });
  console.log("sales invoices:", salesList.length);
  const sales: Array<Record<string, unknown>> = [];
  await pool(salesList, 6, async (r) => {
    try {
      const d = (await exec("salesInvoice.detail", { id: r.id })) as unknown;
      const inv = (Array.isArray(d) ? d[0] : d) as Record<string, unknown>;
      const items = (Array.isArray(inv?.detailItem) ? inv.detailItem : []) as Array<Record<string, unknown>>;
      sales.push({
        number: r.number, transDate: r.transDate, totalAmount: r.totalAmount,
        customerNo: (r.customer as Record<string, unknown> | undefined)?.customerNo ?? null,
        customerName: (r.customer as Record<string, unknown> | undefined)?.name ?? null,
        status: r.statusName ?? null,
        items: items.map((it) => ({
          name: String(it.detailName ?? (it.item as Record<string, unknown> | undefined)?.name ?? "").trim(),
          qty: Number(it.quantity) || 0,
          price: Number(it.price) || 0,
          total: Number(it.totalPrice) || 0,
        })),
      });
    } catch (e) {
      console.log("sales detail ERR", r.number, String(e).slice(0, 80));
    }
  });
  sales.sort((a, b) => String(a.number).localeCompare(String(b.number)));
  console.log("sales detailed:", sales.length);

  const purchaseList = await listAllPages("purchaseInvoice.list", { sort: "id|asc" });
  console.log("purchase invoices:", purchaseList.length);
  const purchases: Array<Record<string, unknown>> = [];
  await pool(purchaseList, 6, async (r) => {
    try {
      const d = (await exec("purchaseInvoice.detail", { id: r.id })) as unknown;
      const inv = (Array.isArray(d) ? d[0] : d) as Record<string, unknown>;
      const items = (Array.isArray(inv?.detailItem) ? inv.detailItem : []) as Array<Record<string, unknown>>;
      purchases.push({
        number: r.number, transDate: r.transDate, totalAmount: r.totalAmount,
        vendorNo: (r.vendor as Record<string, unknown> | undefined)?.vendorNo ?? null,
        vendorName: (r.vendor as Record<string, unknown> | undefined)?.name ?? null,
        items: items.map((it) => ({
          name: String(it.detailName ?? (it.item as Record<string, unknown> | undefined)?.name ?? "").trim(),
          qty: Number(it.quantity) || 0,
          total: Number(it.totalPrice) || 0,
        })),
      });
    } catch (e) {
      console.log("purchase detail ERR", r.number, String(e).slice(0, 80));
    }
  });
  purchases.sort((a, b) => String(a.number).localeCompare(String(b.number)));
  console.log("purchases detailed:", purchases.length);

  writeFileSync(OUT, JSON.stringify({ sales, purchases }, null, 1));
  console.log("wrote", OUT);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
