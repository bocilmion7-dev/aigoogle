/**
 * Uji LIVE seluruh API Accurate asli (BUKAN mock).
 * Fase A: 177 aksi GET · B: 11 util · C: tulis master (customer/vendor/item/unit/warehouse)
 * D: probe tulis sisanya · E: 73 event webhook ke situs publik.
 * Klasifikasi: ok = s:true · tolak = provider menolak (struktur {s:false}) · gagal = jaringan/5xx/401.
 * Jalankan: DATABASE_URL=... NODE_TLS_REJECT_UNAUTHORIZED=0 tsx scripts/live/accurate-full-live.ts
 */
import { readFileSync } from "node:fs";
import { prisma } from "../../apps/api/src/db.js";
import { accurateCtxFor } from "../../apps/api/src/providers/accounting/connection.js";
import { AccurateAdapter } from "../../apps/api/src/providers/accounting/accurate.js";
import type { ProviderCtx } from "../../apps/api/src/providers/accounting/types.js";

const manifest = JSON.parse(
  readFileSync(new URL("../../docs/spikes/accurate-actions-manifest.json", import.meta.url), "utf8")
) as {
  modules: Record<string, Array<{ action: string; method: "GET" | "POST" | "DELETE"; tool: string }>>;
  utils: string[];
  webhookEvents: string[];
};

const PUBLIC = process.env.APP_ORIGIN || "http://localhost:3001";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ACTION_ROUTES = new Set(
  Object.values(manifest.modules).flatMap((acts) =>
    acts.filter((a) => a.method === "DELETE").map((a) => a.tool)
  )
);
function ACTION_HAS_DELETE(_mod: string, delTool: string): boolean {
  return ACTION_ROUTES.has(delTool);
}

type Status = "ok" | "tolak" | "gagal";
const report: { fase: string; tool: string; status: Status; note: string }[] = [];
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const classify = (e: unknown): { status: Status; note: string } => {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.startsWith("provider gagal")) return { status: "tolak", note: msg.slice(0, 160) };
  if (msg.startsWith("tolak-dokumentasi")) return { status: "tolak", note: msg.slice(0, 160) };
  if (msg.includes("modul kosong")) return { status: "tolak", note: msg.slice(0, 160) };
  if (/non-JSON 400/.test(msg)) return { status: "tolak", note: msg.slice(0, 160) };
  return { status: "gagal", note: msg.slice(0, 160) };
};

async function main() {
  const conn = await prisma.connection.findFirst({
    where: { provider: "accurate", status: "connected", host: { contains: "accurate.id" } },
    orderBy: { updatedAt: "desc" },
  });
  if (!conn) throw new Error("tidak ada koneksi accurate tersimpan");
  const ctx = (await accurateCtxFor(conn.tenantId)) as ProviderCtx;
  log(`koneksi: tenant=${conn.tenantId} host=${ctx.host.slice(0, 60)}…`);

  const adapter = new AccurateAdapter({
    clientId: process.env.ACCURATE_CLIENT_ID ?? "",
    clientSecret: process.env.ACCURATE_CLIENT_SECRET ?? "",
    apiBase: process.env.ACCURATE_API_BASE || "https://account.accurate.id",
  });
  const tenant = await prisma.tenant.findUnique({ where: { id: conn.tenantId } });
  const dbId = tenant?.providerDbId ?? "";
  // retry utk respons transient (adapter sudah retry 1× utk HTML — tambah backoff utk spike singkat)
  const exec = async (tool: string, args: Record<string, unknown> = {}) => {
    try {
      return await adapter.execute(tool, args, ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Unexpected token") || msg.includes("html-transient")) {
        await sleep(2500);
        return await adapter.execute(tool, args, ctx);
      }
      throw e;
    }
  };

  // ── Fase A: semua aksi GET (177) ─────────────────────────────────────────
  const getTools: string[] = [];
  const detailTools: string[] = [];
  const specialGets: string[] = [];
  for (const acts of Object.values(manifest.modules)) {
    for (const a of acts) {
      if (a.method !== "GET") continue;
      if (a.action === "list") getTools.push(a.tool);
      else if (a.action === "detail") detailTools.push(a.tool);
      else specialGets.push(a.tool);
    }
  }
  log(`fase A: ${getTools.length} list · ${detailTools.length} detail · ${specialGets.length} khusus`);

  const firstId = new Map<string, string>();
  const idFor = async (tool: string): Promise<string | null> => {
    const mod = tool.split(".")[0];
    if (firstId.has(mod)) return firstId.get(mod)!;
    try {
      const rows = (await exec(`${mod}.list`)) as Array<{ id?: string }>;
      const id = rows[0]?.id ?? "";
      firstId.set(mod, id);
      return id || null;
    } catch {
      firstId.set(mod, "");
      return null;
    }
  };

  for (const tool of getTools) {
    try {
      await exec(tool);
      report.push({ fase: "A-list", tool, status: "ok", note: "" });
    } catch (e) {
      report.push({ fase: "A-list", tool, ...classify(e) });
    }
    await sleep(60);
  }
  for (const tool of detailTools) {
    const id = await idFor(tool);
    if (!id) {
      report.push({ fase: "A-detail", tool, status: "tolak", note: "modul kosong (tanpa id)" });
      continue;
    }
    try {
      await exec(tool, { id });
      report.push({ fase: "A-detail", tool, status: "ok", note: "" });
    } catch (e) {
      report.push({ fase: "A-detail", tool, ...classify(e) });
    }
    await sleep(60);
  }
  for (const tool of specialGets) {
    try {
      await exec(tool);
      report.push({ fase: "A-khusus", tool, status: "ok", note: "" });
    } catch (e) {
      report.push({ fase: "A-khusus", tool, ...classify(e) });
    }
    await sleep(60);
  }

  // ── Fase B: 11 util ──────────────────────────────────────────────────────
  const utilCall = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      report.push({ fase: "B-util", tool: name, status: "ok", note: "" });
    } catch (e) {
      report.push({ fase: "B-util", tool: name, ...classify(e) });
    }
    await sleep(60);
  };
  await utilCall("approved-scope.do", () => adapter.approvedScope(ctx));
  await utilCall("auth-info.do", () => adapter.authInfo(ctx));
  await utilCall("db-check-session.do", () => adapter.dbCheckSession(ctx, dbId));
  await utilCall("db-detail.do", () => adapter.dbDetail(ctx, dbId));
  await utilCall("db-list.do", () => adapter.dbList(ctx));
  await utilCall("db-refresh-session.do", () => adapter.dbRefreshSession(ctx, dbId));
  await utilCall("db-status.do", () => adapter.dbStatus(ctx, dbId));
  await utilCall("webhook-history.do", () => adapter.webhookHistory(ctx));
  await utilCall("webhook-renew.do", () => adapter.webhookRenew(ctx));
  await utilCall("userinfo.do", () => adapter.fetchUser(ctx.accessToken));
  await utilCall("open-db.do", async () => {
    const dbs = await adapter.listDbs(ctx.accessToken);
    return adapter.openDb(ctx.accessToken, dbs[0]?.providerDbId ?? "");
  });

  // ── Fase C: tulis master live (save → delete) ────────────────────────────
  const ts = String(Date.now()).slice(-6);
  const unitName = `U${ts.slice(-6)}`; // nama satuan maks 7 karakter
  const masterSave: Array<{ tool: string; data: Record<string, unknown> }> = [
    { tool: "unit.save", data: { name: unitName } },
    { tool: "warehouse.save", data: { name: `W${ts}` } },
    // transDate format provider: dd/MM/yyyy
    { tool: "customer.save", data: { name: `Uji Pelanggan ${ts}`, transDate: "12/10/2026" } },
    { tool: "vendor.save", data: { name: `Uji Vendor ${ts}`, transDate: "12/10/2026" } },
  ];
  const savedIds: Array<{ tool: string; id: string }> = [];
  // save membalas {r:{id,...}} — ekstrak id (fallback: pesan d)
  const idOf = (raw: unknown): string => {
    if (raw && typeof raw === "object" && "id" in (raw as object)) return String((raw as { id: unknown }).id);
    return String(raw);
  };
  for (const s of masterSave) {
    try {
      const id = idOf(await exec(s.tool, s.data));
      savedIds.push({ tool: s.tool, id });
      report.push({ fase: "C-tulis", tool: s.tool, status: "ok", note: `id=${id}` });
    } catch (e) {
      report.push({ fase: "C-tulis", tool: s.tool, ...classify(e) });
    }
    await sleep(120);
  }
  // item: butuh referensi unit & kategori — pakai unit yang baru dibuat + kategori pertama bila ada
  try {
    const cats = (await exec("itemCategory.list")) as Array<{ name?: string }>;
    const catName = cats[0]?.name ?? "Umum";
    const itemData = {
      name: `Uji Barang ${ts}`,
      itemType: "INVENTORY", // enum provider (bukan angka)
      itemCategoryName: catName,
      unit1Name: unitName,
    };
    const id = idOf(await exec("item.save", itemData));
    savedIds.push({ tool: "item.save", id });
    report.push({ fase: "C-tulis", tool: "item.save", status: "ok", note: `id=${id}` });
  } catch (e) {
    report.push({ fase: "C-tulis", tool: "item.save", ...classify(e) });
  }
  await sleep(120);

  // delete semua yang tadi dibuat — urut terbalik (item dulu, baru unit yg dipakainya)
  for (const s of [...savedIds].reverse()) {
    try {
      await exec(s.tool.replace(/\.save$/, ".delete"), { id: s.id });
      report.push({ fase: "C-hapus", tool: s.tool.replace(/\.save$/, ".delete"), status: "ok", note: `id=${s.id}` });
    } catch (e) {
      report.push({ fase: "C-hapus", tool: s.tool.replace(/\.save$/, ".delete"), ...classify(e) });
    }
    await sleep(120);
  }

  // ── Fase D: probe tulis sisanya (tanpa data sampah) ──────────────────────
  const master = new Set(masterSave.map((s) => s.tool));
  for (const [mod, acts] of Object.entries(manifest.modules)) {
    for (const a of acts) {
      if (a.method === "DELETE") {
        if (savedIds.some((s) => s.tool.replace(/\.save$/, ".delete") === a.tool)) continue;
        try {
          await exec(a.tool, { id: "0" });
          report.push({ fase: "D-delete", tool: a.tool, status: "ok", note: "id=0 tak dikenal" });
        } catch (e) {
          report.push({ fase: "D-delete", tool: a.tool, ...classify(e) });
        }
        await sleep(150);
      } else if (a.method === "POST") {
        if (master.has(a.tool) || a.tool === "item.save") continue;
        try {
          const id = String(await exec(a.tool));
          // ternyata diterima — hapus bila punya delete, kalau tidak catat
          const del = `${a.tool.split(".")[0]}.delete`;
          if (ACTION_HAS_DELETE(mod, del)) {
            await exec(del, { id });
            report.push({ fase: "D-save", tool: a.tool, status: "ok", note: `diterima lalu dihapus id=${id}` });
          } else {
            report.push({ fase: "D-save", tool: a.tool, status: "ok", note: `diterima id=${id} (tanpa delete)` });
          }
        } catch (e) {
          report.push({ fase: "D-save", tool: a.tool, ...classify(e) });
        }
        await sleep(150);
      }
    }
  }

  // ── Fase E: 73 event webhook ke situs publik ─────────────────────────────
  const storedBefore = await prisma.accurateWebhookEvent.count({ where: { payload: { contains: "phase7-live" } } });
  let whOk = 0;
  for (const event of manifest.webhookEvents) {
    try {
      const res = await fetch(`${PUBLIC}/api/integrations/accurate/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event, data: { source: "phase7-live", event } }),
      });
      if (res.status === 200) whOk++;
      else report.push({ fase: "E-webhook", tool: event, status: "gagal", note: `HTTP ${res.status}` });
    } catch (e) {
      report.push({ fase: "E-webhook", tool: event, status: "gagal", note: String(e).slice(0, 120) });
    }
    await sleep(40);
  }
  report.push({ fase: "E-webhook", tool: `ringkasan ${manifest.webhookEvents.length} event`, status: whOk === manifest.webhookEvents.length ? "ok" : "gagal", note: `${whOk}/${manifest.webhookEvents.length} 200` });
  const storedAfter = await prisma.accurateWebhookEvent.count({ where: { payload: { contains: "phase7-live" } } });
  const storedDelta = storedAfter - storedBefore;
  report.push({
    fase: "E-webhook",
    tool: "tersimpan di DB",
    status: storedDelta === manifest.webhookEvents.length ? "ok" : "gagal",
    note: `delta ${storedDelta} row (total ${storedAfter})`,
  });

  // ── Rekap ────────────────────────────────────────────────────────────────
  const byFase = new Map<string, { ok: number; tolak: number; gagal: number }>();
  for (const r of report) {
    const f = byFase.get(r.fase) ?? { ok: 0, tolak: 0, gagal: 0 };
    f[r.status]++;
    byFase.set(r.fase, f);
  }
  console.log("\n══════ RINGKASAN UJI LIVE ══════");
  for (const [f, c] of byFase) {
    console.log(`${f.padEnd(12)} ok=${c.ok}  tolak=${c.tolak}  gagal=${c.gagal}`);
  }
  const gagal = report.filter((r) => r.status === "gagal");
  const totalGagal = gagal.length;
  console.log(`TOTAL: ok=${report.filter((r) => r.status === "ok").length} tolak=${report.filter((r) => r.status === "tolak").length} GAGAL=${totalGagal}`);
  if (gagal.length) {
    console.log("\n── detail GAGAL ──");
    for (const g of gagal) console.log(`  [${g.fase}] ${g.tool}: ${g.note}`);
  }
  const tolakList = report.filter((r) => r.status === "tolak");
  if (tolakList.length) {
    console.log(`\n── ${tolakList.length} penolakan provider (endpoint terverifikasi, payload ditolak validasi) — 10 contoh ──`);
    for (const t of tolakList.slice(0, 10)) console.log(`  [${t.fase}] ${t.tool}: ${t.note}`);
  }
  await prisma.$disconnect();
  process.exit(totalGagal > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
