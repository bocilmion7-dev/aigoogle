/** Retry detail faktur yang gagal karena rate-limit — konkurensi 2 + jeda 1.2s */
import { readFileSync, writeFileSync } from "node:fs";
import { accurateCtxFor } from "../src/providers/accounting/connection.js";
import { accurateProvider } from "../src/providers/accounting/index.js";

const TENANT = process.env.GT_TENANT ?? "cmv51yr7s0000mgox9rn6axlk";
const OUT = process.env.GT_OUT ?? "/tmp/opencode/gt_detail.json";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
      await sleep(800);
    }
    return rows;
  }

  const data = JSON.parse(readFileSync(OUT, "utf8")) as {
    sales: Array<Record<string, unknown>>;
    purchases: Array<Record<string, unknown>>;
  };

  const salesList = await listAllPages("salesInvoice.list", { sort: "id|asc" });
  const haveSales = new Set(data.sales.map((s) => String(s.number)));
  const missSales = salesList.filter((r) => !haveSales.has(String(r.number)));
  console.log("sales missing:", missSales.length);
  for (const r of missSales) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const d = (await exec("salesInvoice.detail", { id: r.id })) as unknown;
        const inv = (Array.isArray(d) ? d[0] : d) as Record<string, unknown>;
        const items = (Array.isArray(inv?.detailItem) ? inv.detailItem : []) as Array<Record<string, unknown>>;
        data.sales.push({
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
        console.log("ok sales", r.number);
        break;
      } catch (e) {
        console.log(`retry${attempt} sales`, r.number, String(e).slice(0, 60));
        await sleep(3000 * attempt);
      }
    }
    await sleep(1200);
  }

  const purchaseList = await listAllPages("purchaseInvoice.list", { sort: "id|asc" });
  const haveP = new Set(data.purchases.map((s) => String(s.number)));
  const missP = purchaseList.filter((r) => !haveP.has(String(r.number)));
  console.log("purchase missing:", missP.length);
  for (const r of missP) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const d = (await exec("purchaseInvoice.detail", { id: r.id })) as unknown;
        const inv = (Array.isArray(d) ? d[0] : d) as Record<string, unknown>;
        const items = (Array.isArray(inv?.detailItem) ? inv.detailItem : []) as Array<Record<string, unknown>>;
        data.purchases.push({
          number: r.number, transDate: r.transDate, totalAmount: r.totalAmount,
          vendorNo: (r.vendor as Record<string, unknown> | undefined)?.vendorNo ?? null,
          vendorName: (r.vendor as Record<string, unknown> | undefined)?.name ?? null,
          items: items.map((it) => ({
            name: String(it.detailName ?? (it.item as Record<string, unknown> | undefined)?.name ?? "").trim(),
            qty: Number(it.quantity) || 0,
            total: Number(it.totalPrice) || 0,
          })),
        });
        console.log("ok purchase", r.number);
        break;
      } catch (e) {
        console.log(`retry${attempt} purchase`, r.number, String(e).slice(0, 60));
        await sleep(3000 * attempt);
      }
    }
    await sleep(1200);
  }

  data.sales.sort((a, b) => String(a.number).localeCompare(String(b.number)));
  data.purchases.sort((a, b) => String(a.number).localeCompare(String(b.number)));
  writeFileSync(OUT, JSON.stringify(data, null, 1));
  console.log("done: sales", data.sales.length, "purchases", data.purchases.length);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
