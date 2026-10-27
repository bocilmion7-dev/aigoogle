import { prisma } from "../db.js";
import { accurateCtxFor } from "../providers/accounting/connection.js";
import { accurateProvider } from "../providers/accounting/index.js";
import { detectTenantIndustries } from "../wawasan/industry.js";
import { playbookFor } from "./playbook.js";
import { wibDate } from "../wawasan/time.js";
import { llmClient } from "../ai/llm-client.js";
import { getModuleModel } from "../ai/module-model.js";
import { recordLlmUsage } from "../ai/usage.js";

/**
 * Analisis Bisnis per tenant — SEMUA angka diambil dari Accurate (sumber
 * kebenaran lengkap). Tujuan: bukan hanya menampilkan kondisi, tetapi
 * memberi SARAN bisnis yang konkret dan bisa dijalankan.
 */

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const pct = (n: number) => `${Math.round(n)}%`;

const p2 = (n: number) => String(n).padStart(2, "0");
const ddmmyyyy = (d: Date) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;

export type Verdict = "sehat" | "perhatian" | "kritis";

export interface AnalysisMetric {
  key: string;
  label: string;
  value: string;
  raw: number;
  hint: string;
}

export interface Finding {
  severity: Verdict;
  title: string;
  detail: string;
  advice: string;
}

export interface AnalysisResult {
  generatedAt: string;
  period: { from: string; to: string; label: string };
  profile: {
    industry: string[];
    industryKeys: string[];
    playbook: string;
    focus: string[];
    scale: "mikro" | "kecil" | "menengah";
    businessModel: string;
  };
  verdict: Verdict;
  score: number;
  metrics: AnalysisMetric[];
  findings: Finding[];
  /** langkah prioritas (maks 3) */
  priorities: string[];
  /** narasi analisis oleh AI (analis profesional, sesuai bidang usaha) */
  narrative: string;
  source: "accurate";
}

interface Ctx {
  tenantId: string;
  provider: ReturnType<typeof accurateProvider>;
  // ctx Accurate dipakai provider.execute
  accCtx: NonNullable<Awaited<ReturnType<typeof accurateCtxFor>>>;
}

async function makeCtx(tenantId: string): Promise<Ctx | null> {
  const accCtx = await accurateCtxFor(tenantId);
  if (!accCtx) return null;
  return { tenantId, provider: accurateProvider(), accCtx };
}

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/**
 * Analisis cukup dihitung SEKALI per hari (WIB). Hasil disimpan di AppSetting
 * agar tetap ada walau API restart. Dihitung ulang hanya bila pengguna menekan
 * "Analisis ulang" (fresh) — supaya hemat panggilan Accurate.
 */
const CACHE_KEY = (tenantId: string) => `analisa:daily:${tenantId}`;

export async function invalidateAnalysis(tenantId: string): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: CACHE_KEY(tenantId) } }).catch(() => null);
}

async function readDailyCache(tenantId: string): Promise<AnalysisResult | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: CACHE_KEY(tenantId) } });
    if (!row) return null;
    const parsed = JSON.parse(row.value) as { date: string; data: AnalysisResult };
    if (parsed?.date !== wibDate() || !parsed.data) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

async function writeDailyCache(tenantId: string, data: AnalysisResult): Promise<void> {
  const value = JSON.stringify({ date: wibDate(), data });
  await prisma.appSetting
    .upsert({ where: { key: CACHE_KEY(tenantId) }, create: { key: CACHE_KEY(tenantId), value }, update: { value } })
    .catch(() => null);
}

/** Analisis lengkap satu tenant. */
export async function analyzeTenant(
  tenantId: string,
  opts?: { fresh?: boolean }
): Promise<AnalysisResult | { error: string }> {
  if (!opts?.fresh) {
    const hit = await readDailyCache(tenantId);
    if (hit) return hit;
  }
  const ctx = await makeCtx(tenantId);
  if (!ctx) return { error: "belum_connect" };
  const { provider, accCtx } = ctx;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const from = ddmmyyyy(monthStart);
  const to = ddmmyyyy(now);
  const pFrom = ddmmyyyy(prevStart);
  const pTo = ddmmyyyy(prevEnd);

  // Semua data dari Accurate (paralel, toleran gagal sebagian)
  const [pl, plPrev, ar, ap, topItems, zeroStock, stockOverview, overview, industries] = await Promise.all([
    provider.execute("gl.plSummary", { fromDate: from, toDate: to }, accCtx).catch(() => null),
    provider.execute("gl.plSummary", { fromDate: pFrom, toDate: pTo }, accCtx).catch(() => null),
    provider.execute("receivables.summary", { limit: 5 }, accCtx).catch(() => null),
    provider.execute("payables.summary", { limit: 5 }, accCtx).catch(() => null),
    provider.execute("item.topSelling", { fromDate: from, toDate: to, limit: 8 }, accCtx).catch(() => null),
    provider.execute("item.zeroStock", {}, accCtx).catch(() => null),
    provider.execute("item.stockOverview", {}, accCtx).catch(() => null),
    provider.execute("finance.overview", { fromDate: from, toDate: to }, accCtx).catch(() => null),
    detectTenantIndustries(tenantId).catch(() => []),
  ]);

  const plS = obj(obj(pl).summary);
  const plPS = obj(obj(plPrev).summary);
  const revenue = num(plS.revenue);
  const cogs = num(plS.costOfGoodsSold);
  const grossProfit = num(plS.grossProfit, revenue - cogs);
  const opex = num(plS.operatingExpense);
  const netProfit = num(plS.netProfit);
  const prevRevenue = num(plPS.revenue);
  const prevNet = num(plPS.netProfit);

  const arObj = obj(ar);
  const apObj = obj(ap);
  const arTotal = num(arObj.totalReceivables ?? arObj.totalUnpaid ?? arObj.total);
  const apTotal = num(apObj.totalPayables ?? apObj.totalUnpaid ?? apObj.total);

  const topList = Array.isArray(obj(topItems).items) ? (obj(topItems).items as Record<string, unknown>[]) : [];
  const zeroCount = num(obj(zeroStock).count);
  const stockKinds = num(obj(stockOverview).itemCount ?? obj(stockOverview).count);

  const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;
  const hasPrev = prevRevenue > 0;
  const growth = hasPrev ? ((revenue - prevRevenue) / prevRevenue) * 100 : 0;
  const aov = topList.length ? revenue / Math.max(1, num(obj(topItems).invoiceCount, topList.length)) : 0;
  const topShare =
    revenue > 0 && topList.length
      ? (topList.slice(0, 3).reduce((s, t) => s + num(t.amount ?? t.total ?? t.revenue), 0) / revenue) * 100
      : 0;

  const scale: "mikro" | "kecil" | "menengah" = revenue < 50_000_000 ? "mikro" : revenue < 500_000_000 ? "kecil" : "menengah";
  const industryKeys = industries.map((i) => i.key);
  const pb = playbookFor(industryKeys);
  const industry = industries.length ? industries.map((i) => i.label).slice(0, 3) : ["Bisnis Umum"];
  const businessModel = topList.length > 12 ? "retail multi-produk" : topList.length > 0 ? "fokus produk" : "umum";

  // ── metrik ringkas ──
  const metrics: AnalysisMetric[] = [
    { key: "revenue", label: "Penjualan bulan ini", value: rp(revenue), raw: revenue, hint: prevRevenue ? `bulan lalu ${rp(prevRevenue)}` : "belum ada pembanding" },
    { key: "netProfit", label: "Laba bersih", value: rp(netProfit), raw: netProfit, hint: `margin ${pct(netMargin)}` },
    { key: "grossMargin", label: "Margin kotor", value: pct(grossMargin), raw: grossMargin, hint: `laba kotor ${rp(grossProfit)}` },
    { key: "growth", label: "Pertumbuhan", value: hasPrev ? pct(growth) : "—", raw: growth, hint: hasPrev ? "dibanding bulan lalu" : "belum ada data bulan lalu" },
    { key: "receivable", label: "Piutang", value: rp(arTotal), raw: arTotal, hint: `${num(arObj.invoiceCount ?? arObj.countUnpaid)} faktur` },
    { key: "payable", label: "Utang", value: rp(apTotal), raw: apTotal, hint: `${num(apObj.invoiceCount ?? apObj.countUnpaid)} faktur` },
  ];

  // ── temuan + saran ──
  const findings: Finding[] = [];

  if (revenue === 0) {
    findings.push({
      severity: "kritis",
      title: "Belum ada penjualan tercatat bulan ini",
      detail: "Accurate tidak menunjukkan faktur penjualan pada periode ini.",
      advice: "Pastikan transaksi penjualan dicatat di Accurate. Bila penjualan memang belum ada, fokus ke promosi dan penawaran ke pelanggan lama.",
    });
  } else {
    if (netProfit < 0) {
      findings.push({
        severity: "kritis",
        title: "Bisnis merugi bulan ini",
        detail: `Pendapatan ${rp(revenue)} tetapi beban + HPP melebihi, laba bersih ${rp(netProfit)}.`,
        advice:
          `Periksa 3 beban terbesar dan HPP. Untuk bisnis ${pb.label.toLowerCase()}, langkah paling berdampak: ` +
          pb.levers.map((l, i) => `(${i + 1}) ${l}`).join(", ") + ".",
      });
    }
    if (grossMargin > 0 && grossMargin < pb.benchmark.grossMargin) {
      findings.push({
        severity: "perhatian",
        title: `Margin kotor ${pct(grossMargin)} di bawah wajar ${pb.label} (${pb.benchmark.grossMargin}%)`,
        detail: `Dari ${rp(revenue)} penjualan, laba kotor hanya ${rp(grossProfit)}.`,
        advice: `Margin di bawah kebiasaan industri ${pb.label.toLowerCase()} rawan rugi setelah biaya operasional. ${pb.levers[0]}.`,
      });
    }
    if (hasPrev && growth < -10) {
      findings.push({
        severity: "perhatian",
        title: `Penjualan turun ${pct(Math.abs(growth))}`,
        detail: `Bulan ini ${rp(revenue)} vs bulan lalu ${rp(prevRevenue)}.`,
        advice: "Cek: apakah terjadi kehilangan pelanggan besar, stok kosong pada produk laris, atau musim sepi? Hubungi kembali pelanggan 30 hari terakhir dan tawarkan paket/bundling.",
      });
    }
    if (hasPrev && growth > 15) {
      findings.push({
        severity: "sehat",
        title: `Penjualan tumbuh ${pct(growth)}`,
        detail: `Naik dari ${rp(prevRevenue)} ke ${rp(revenue)}.`,
        advice: "Pertumbuhan bagus — pastikan stok produk terlaris cukup dan pertimbangkan menambah kapasitas/tenaga agar tidak kehilangan pesanan.",
      });
    }
    if (topShare > 70 && topList.length >= 3) {
      const names = topList.slice(0, 3).map((t) => String(t.itemName ?? t.name ?? "—")).join(", ");
      findings.push({
        severity: "perhatian",
        title: "Penjualan sangat bergantung pada sedikit produk",
        detail: `Tiga produk teratas menyumbang ${pct(topShare)} penjualan (${names}).`,
        advice: "Risiko jika salah satu produk turun pamor. Seimbangkan dengan menambah variasi produk atau bundling produk pelengkap.",
      });
    }
    if (arTotal > 0 && revenue > 0 && arTotal > revenue * 0.5) {
      findings.push({
        severity: "perhatian",
        title: "Piutang besar dibanding penjualan",
        detail: `Piutang ${rp(arTotal)} sementara penjualan bulan ini ${rp(revenue)}.`,
        advice: "Tagih piutang yang jatuh tempo lebih agresif; pertimbangkan termin lebih pendek atau diskon pelunasan cepat agar kas tidak macet.",
      });
    }
    if (apTotal > 0 && arTotal > 0 && apTotal > arTotal) {
      findings.push({
        severity: "perhatian",
        title: "Utang melebihi piutang",
        detail: `Utang ${rp(apTotal)} vs piutang ${rp(arTotal)}.`,
        advice: "Prioritaskan penagihan piutang untuk menutup utang; hindari pembelian baru dengan termin panjang sebelum kas membaik.",
      });
    }
    if (zeroCount > 0) {
      findings.push({
        severity: "perhatian",
        title: `${zeroCount} barang stoknya habis`,
        detail: "Ada barang dengan stok 0 pada Accurate.",
        advice: "Cek apakah termasuk produk terlaris. Segera restock yang laku; untuk yang tidak laku, pertimbangkan tidak memesan ulang.",
      });
    }
  }

  if (pb.risks.length && !findings.some((f) => f.severity === "kritis")) {
    findings.push({
      severity: "sehat",
      title: `Risiko khas ${pb.label} yang perlu dijaga`,
      detail: pb.risks.join("; "),
      advice: `Pantau secara berkala. Fokus indikator: ${pb.focus.join(", ")}.`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "sehat",
      title: "Kondisi bisnis stabil",
      detail: `Penjualan ${rp(revenue)} dengan laba bersih ${rp(netProfit)} dan margin ${pct(netMargin)}.`,
      advice: "Pertahankan; fokus ke peningkatan jumlah pelanggan baru dan produk dengan margin terbaik.",
    });
  }

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        50 +
          (netProfit > 0 ? 20 : -25) +
          (grossMargin >= 30 ? 15 : grossMargin >= 20 ? 5 : -10) +
          (hasPrev ? (growth > 0 ? 10 : growth < -10 ? -15 : 0) : 0) +
          (arTotal > revenue && revenue > 0 ? -10 : 0) +
          (zeroCount > 0 ? -5 : 0)
      )
    )
  );
  const verdict: Verdict = score >= 70 ? "sehat" : score >= 45 ? "perhatian" : "kritis";

  const priorities = findings
    .filter((f) => f.severity !== "sehat")
    .sort((a, b) => (a.severity === "kritis" ? -1 : 0) - (b.severity === "kritis" ? -1 : 0))
    .slice(0, 3)
    .map((f) => f.title);

  const narrative = await buildNarrative({
    tenantId,
    profile: { industry: pb.label, focus: pb.focus, levers: pb.levers, risks: pb.risks, scale },
    metrics,
    findings,
    period: `${monthStart.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}`,
  });

  const result: AnalysisResult = {
    generatedAt: new Date().toISOString(),
    period: { from, to, label: `${monthStart.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}` },
    profile: { industry, industryKeys, playbook: pb.label, focus: pb.focus, scale, businessModel },
    verdict,
    score,
    metrics,
    findings,
    priorities: priorities.length ? priorities : ["Pertahankan kinerja dan fokus menambah pelanggan baru"],
    narrative,
    source: "accurate",
  };
  await writeDailyCache(tenantId, result);
  return result;
}

// ─────────────────────────────────────────────────────────────
// Narasi AI: analis bisnis profesional yang menyesuaikan bidang usaha
// ─────────────────────────────────────────────────────────────

interface NarrativeInput {
  tenantId: string;
  profile: { industry: string; focus: string[]; levers: string[]; risks: string[]; scale: string };
  metrics: AnalysisMetric[];
  findings: Finding[];
  period: string;
}

/**
 * AI hanya MENYUSUN narasi dari angka (sudah dihitung deterministik).
 * Dilarang mengarang angka baru; semua angka wajib dari data yang diberikan.
 */
async function buildNarrative(input: NarrativeInput): Promise<string> {
  const { profile, metrics, findings, period } = input;

  const metricLines = metrics
    .map((m) => `- ${m.label}: ${m.value} (${m.hint})`)
    .join("\n");
  const findingLines = findings
    .map((f) => `- [${f.severity}] ${f.title} — ${f.detail}`)
    .join("\n");

  const system =
    "Anda adalah ANALIS BISNIS PROFESIONAL untuk UMKM Indonesia.\n" +
    "Tugas: beri ANALISIS dan SARAN yang praktis, bukan sekadar mengulang angka.\n" +
    "ATURAN WAJIB:\n" +
    "1. Gunakan HANYA angka dari DATA di bawah. JANGAN mengarang angka/fakta baru.\n" +
    "2. Sesuaikan analisis dengan BIDANG USAHA yang diberikan (tolok ukur, risiko, dan solusi khas industri itu).\n" +
    "3. Jangan beri saran yang tidak realistis untuk skala usaha (lihat skala bisnis).\n" +
    "4. Struktur: (a) kondisi singkat, (b) 2-3 masalah/risiko utama, (c) 3 langkah aksi konkret berurutan.\n" +
    "5. Bahasa Indonesia, ringkas (maksimal 170 kata). DILARANG memakai markdown (** , ## , tanda bintang). Poin pakai '- '.\n" +
    "6. Sebut angka rupiah/persen bila relevan, dan kaitkan saran dengan angka tersebut.";

  const prompt =
    `PERIODE: ${period}\n` +
    `BIDANG USAHA: ${profile.industry}\n` +
    `SKALA: ${profile.scale}\n` +
    `INDIKATOR PENTING INDUSTRI INI: ${profile.focus.join(", ")}\n` +
    `RISIKO KHAS: ${profile.risks.join("; ")}\n` +
    `TUAS PERBAIKAN YANG BIASA BERHASIL: ${profile.levers.join("; ")}\n\n` +
    `DATA KEUANGAN (dari Accurate):\n${metricLines}\n\n` +
    `TEMUAN:\n${findingLines || "- tidak ada temuan khusus"}\n\n` +
    "Tulis analisis + saran bisnisnya sekarang.";

  try {
    const model = (await getModuleModel("chat")) || undefined;
    const { parts } = await llmClient().generate({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      system,
      model,
    });
    const text = parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text!.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    void recordLlmUsage({
      tenantId: input.tenantId,
      userId: "analisa",
      kind: "chat",
      model: model ?? "default",
      promptChars: system.length + prompt.length,
      completionChars: text.length,
    });
    return text;
  } catch {
    // gagal AI → narasi deterministik dari temuan (aplikasi tetap berguna)
    return [
      `Ringkasan ${profile.industry} periode ${period}:`,
      ...findings.slice(0, 3).map((f) => `- ${f.title}. ${f.advice}`),
    ].join("\n");
  }
}
