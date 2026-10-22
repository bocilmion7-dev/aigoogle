/** Snapshot data LENGKAP utk tenant demo → /tmp/opencode/snapshot500.json
 *  - list penuh semua halaman utk modul yang punya data
 *  - detail utk modul ber-baris-item (faktur, order, return, receipt, dll)
 *  Jalankan: npx tsx --env-file=/root/aigoogle/.env scripts/snapshot500.ts */
import { writeFileSync } from "node:fs";
import { accurateCtxFor } from "../src/providers/accounting/connection.js";
import { accurateProvider } from "../src/providers/accounting/index.js";
import { ACCURATE_MODULES } from "../src/providers/accounting/accurate-paths.js";

const TENANT = process.env.GT_TENANT ?? "cmv51yr7s0000mgox9rn6axlk";
const OUT = process.env.OUT ?? "/tmp/opencode/snapshot500.json";

/** modul yang butuh detail (punya baris item / field dalam utk GT relasi) */
const NEED_DETAIL = new Set([
  "sales-invoice",
  "purchase-invoice",
  "sales-order",
  "purchase-order",
  "sales-return",
  "purchase-return",
  "sales-receipt",
  "sales-quotation",
  "delivery-order",
  "purchase-payment",
  "expense",
  "journal-voucher",
  "fixed-asset",
  "other-payment",
  "item-adjustment",
]);

type Row = Record<string, unknown>;

async function listAll(
  exec: (t: string, a: Record<string, unknown>) => Promise<unknown>,
  tool: string
): Promise<{ rows: Row[]; total: number }> {
  const rows: Row[] = [];
  let page = 1;
  let pageCount = 1;
  let total = 0;
  do {
    const r = (await exec(tool, { page, pageSize: 100 })) as {
      items?: Row[];
      total?: number;
      pageCount?: number;
    };
    const items = Array.isArray(r?.items) ? r.items : [];
    rows.push(...items);
    total = Number(r?.total) || rows.length;
    pageCount = Number(r?.pageCount) || 1;
    page += 1;
  } while (page <= pageCount && page <= 60);
  return { rows, total };
}

async function main() {
  const ctx = await accurateCtxFor(TENANT);
  if (!ctx) throw new Error("koneksi Accurate tidak ditemukan utk tenant " + TENANT);
  const provider = accurateProvider();
  const exec = (tool: string, args: Record<string, unknown>) => provider.execute(tool, args, ctx);

  const snap: Record<string, unknown> = { generatedAt: new Date().toISOString(), modules: {} };
  const mods = snap.modules as Record<string, unknown>;

  for (const [mod, acts] of Object.entries(ACCURATE_MODULES)) {
    const listAct = acts.find((a) => a.tool.endsWith(".list"));
    if (!listAct) continue;
    let total = 0;
    try {
      const { rows, total: t } = await listAll(exec, listAct.tool);
      total = t;
      if (rows.length === 0) continue;
      mods[mod] = { tool: listAct.tool, total, rows };
      process.stdout.write(`${mod}:${rows.length} `);

      if (NEED_DETAIL.has(mod)) {
        const detAct = acts.find((a) => a.tool.endsWith(".detail"));
        if (detAct) {
          const details: Record<string, unknown> = {};
          let errs = 0;
          for (const row of rows.slice(0, 120)) {
            try {
              const id = row.id;
              if (id == null) continue;
              details[String(id)] = await exec(detAct.tool, { id });
            } catch {
              errs += 1;
            }
          }
          (mods[mod] as Record<string, unknown>).details = details;
          if (errs) process.stdout.write(`(detail err ${errs}) `);
        }
      }
    } catch (e) {
      console.error(`\n${mod} ERR: ${String(e).slice(0, 140)}`);
    }
  }

  writeFileSync(OUT, JSON.stringify(snap), "utf8");
  const n = Object.keys(mods).length;
  const size = (await import("node:fs")).statSync(OUT).size;
  console.log(`\n\n${n} modul → ${OUT} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
