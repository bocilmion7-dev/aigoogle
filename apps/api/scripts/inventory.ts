/** Inventaris modul Accurate yang PUNYA data utk tenant demo → /tmp/opencode/inventory.json
 *  Jalankan: npx tsx scripts/inventory.ts */
import { writeFileSync } from "node:fs";
import { accurateCtxFor } from "../src/providers/accounting/connection.js";
import { accurateProvider } from "../src/providers/accounting/index.js";
import { ACCURATE_MODULES } from "../src/providers/accounting/accurate-paths.js";

const TENANT = process.env.GT_TENANT ?? "cmv51yr7s0000mgox9rn6axlk";
const OUT = process.env.OUT ?? "/tmp/opencode/inventory.json";

async function main() {
  const ctx = await accurateCtxFor(TENANT);
  if (!ctx) throw new Error("koneksi Accurate tidak ditemukan utk tenant " + TENANT);
  const provider = accurateProvider();
  const out: Record<string, { total: number | string; error?: string; sampleKeys?: string[] }> = {};

  for (const [mod, acts] of Object.entries(ACCURATE_MODULES)) {
    const listAct = acts.find((a) => a.method === "GET" && /(^|\.)list$/.test(a.action) || a.tool.endsWith(".list"));
    if (!listAct) continue;
    try {
      const r = (await provider.execute(listAct.tool, { page: 1, pageSize: 1 }, ctx)) as {
        total?: number | string;
        data?: unknown;
      };
      const total = r?.total ?? (Array.isArray(r?.data) ? (r.data as unknown[]).length : 0);
      out[mod] = {
        total: Number(total) || 0,
        sampleKeys: r && typeof r === "object" && Array.isArray((r as { data?: unknown[] }).data) && (r as { data: unknown[] }).data[0]
          ? Object.keys((r as { data: Array<Record<string, unknown>> }).data[0]).slice(0, 14)
          : undefined,
      };
      if (Number(total) > 0) console.log(`${mod}: total=${total}`);
    } catch (e) {
      out[mod] = { total: 0, error: String(e).slice(0, 120) };
    }
  }
  writeFileSync(OUT, JSON.stringify(out, null, 1), "utf8");
  const withData = Object.entries(out).filter(([, v]) => Number(v.total) > 0);
  console.log(`\n${withData.length}/${Object.keys(out).length} modul berdata → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
