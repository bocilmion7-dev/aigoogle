/** Ground truth — jalankan tool agregasi & tool mentah LANGSUNG (tanpa LLM) utk kunci jawaban benchmark. */
import { writeFileSync } from "node:fs";
import { accurateCtxFor } from "../src/providers/accounting/connection.js";
import { accurateProvider } from "../src/providers/accounting/index.js";
import { runAggregation, AGGREGATION_TOOLS } from "../src/providers/accounting/aggregation.js";

const TENANT = process.env.GT_TENANT ?? "cmv51yr7s0000mgox9rn6axlk";
const OUT = process.env.GT_OUT ?? "/tmp/opencode/gt.json";

async function main() {
  const ctx = await accurateCtxFor(TENANT);
  if (!ctx) throw new Error("koneksi Accurate tidak ditemukan utk tenant " + TENANT);
  const provider = accurateProvider();
  const exec = (tool: string, args: Record<string, unknown>) => provider.execute(tool, args, ctx);
  const agg = new Set(AGGREGATION_TOOLS.map((a) => a.name));

  const CALLS: Array<{ key: string; tool: string; args: Record<string, unknown> }> = [
    { key: "piutang", tool: "receivables.summary", args: {} },
    { key: "utang", tool: "payables.summary", args: {} },
    { key: "perCustAll", tool: "salesInvoice.perCustomer", args: {} },
    { key: "perCust2016", tool: "salesInvoice.perCustomer", args: { fromDate: "01/01/2016", toDate: "31/12/2016" } },
    { key: "perCust2017", tool: "salesInvoice.perCustomer", args: { fromDate: "01/01/2017", toDate: "31/12/2017" } },
    { key: "perVendorAll", tool: "purchaseInvoice.perVendor", args: {} },
    { key: "perVendor2016", tool: "purchaseInvoice.perVendor", args: { fromDate: "01/01/2016", toDate: "31/12/2016" } },
    { key: "sales2016", tool: "salesInvoice.summary", args: { fromDate: "01/01/2016", toDate: "31/12/2016" } },
    { key: "sales2017", tool: "salesInvoice.summary", args: { fromDate: "01/01/2017", toDate: "31/12/2017" } },
    { key: "salesAll", tool: "salesInvoice.summary", args: {} },
    { key: "purchase2016", tool: "purchaseInvoice.summary", args: { fromDate: "01/01/2016", toDate: "31/12/2016" } },
    { key: "purchaseAll", tool: "purchaseInvoice.summary", args: {} },
    { key: "pl2016", tool: "gl.plSummary", args: { fromDate: "01/01/2016", toDate: "31/12/2016" } },
    { key: "pl2017", tool: "gl.plSummary", args: { fromDate: "01/01/2017", toDate: "31/12/2017" } },
    { key: "bs2016", tool: "gl.bsSummary", args: { fromDate: "01/01/2016", toDate: "31/12/2016" } },
    { key: "bs2017", tool: "gl.bsSummary", args: { fromDate: "01/01/2017", toDate: "31/12/2017" } },
    { key: "fin2016", tool: "finance.overview", args: { fromDate: "01/01/2016", toDate: "31/12/2016" } },
    { key: "cash2016", tool: "cashflow.summary", args: { fromDate: "01/01/2016", toDate: "31/12/2016" } },
    { key: "top2016", tool: "item.topSelling", args: { fromDate: "01/01/2016", toDate: "31/12/2016", limit: 10 } },
    { key: "top2017", tool: "item.topSelling", args: { fromDate: "01/01/2017", toDate: "31/12/2017", limit: 10 } },
    { key: "abadiSum", tool: "customer.summaryByName", args: { name: "Abadi" } },
    { key: "abadiUnpaid", tool: "customer.unpaidByName", args: { name: "Abadi" } },
    { key: "abadiLast", tool: "customer.lastOrderByName", args: { name: "Abadi" } },
    { key: "abadiSales", tool: "customer.salesByName", args: { name: "Abadi" } },
    { key: "abadiSales2016", tool: "customer.salesByName", args: { name: "Abadi", fromDate: "01/01/2016", toDate: "31/12/2016" } },
    { key: "nasionalSum", tool: "customer.summaryByName", args: { name: "Nasional" } },
    { key: "nasionalSales", tool: "customer.salesByName", args: { name: "Nasional" } },
    { key: "globalSum", tool: "customer.summaryByName", args: { name: "Global" } },
    { key: "megaSum", tool: "vendor.summaryByName", args: { name: "Mega Mendung" } },
    { key: "megaUnpaid", tool: "vendor.unpaidByName", args: { name: "Mega Mendung" } },
    { key: "megaLast", tool: "vendor.lastPurchaseByName", args: { name: "Mega Mendung" } },
    { key: "megaPurchases", tool: "vendor.purchasesByName", args: { name: "Mega Mendung" } },
    { key: "gandaSum", tool: "vendor.summaryByName", args: { name: "Ganda Putra" } },
    { key: "gandaUnpaid", tool: "vendor.unpaidByName", args: { name: "Ganda Putra" } },
    { key: "itemAgg", tool: "item.byName", args: { name: "Anti Gores Iphone 5" } },
    { key: "bs2016at", tool: "gl.bsSummary", args: { asOfDate: "31/12/2016" } },
    { key: "bs2017at", tool: "gl.bsSummary", args: { asOfDate: "31/12/2017" } },
    { key: "cash2017", tool: "cashflow.summary", args: { fromDate: "01/01/2017", toDate: "31/12/2017" } },
    { key: "purchase2017", tool: "purchaseInvoice.summary", args: { fromDate: "01/01/2017", toDate: "31/12/2017" } },
    { key: "salesNov2016", tool: "salesInvoice.summary", args: { fromDate: "01/11/2016", toDate: "30/11/2016" } },
    { key: "waterSum", tool: "customer.summaryByName", args: { name: "Water Phone" } },
    { key: "emasSum", tool: "customer.summaryByName", args: { name: "Emas Sentosa" } },
    { key: "gandaPurchases", tool: "vendor.purchasesByName", args: { name: "Ganda Putra" } },
    { key: "yanSum", tool: "vendor.summaryByName", args: { name: "Yan Gadget" } },
    { key: "customersAll", tool: "customer.list", args: { pageSize: 100 } },
    { key: "vendorsAll", tool: "vendor.list", args: { pageSize: 100 } },
  ];

  const out: Record<string, unknown> = {};
  for (const c of CALLS) {
    try {
      out[c.key] = agg.has(c.tool) ? await runAggregation(c.tool, c.args, ctx, exec) : await exec(c.tool, c.args);
      process.stdout.write(`ok ${c.key}\n`);
    } catch (e) {
      out[c.key] = { error: String(e instanceof Error ? e.message : e) };
      process.stdout.write(`ERR ${c.key}: ${String(e instanceof Error ? e.message : e).slice(0, 120)}\n`);
    }
  }
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log("wrote", OUT);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
