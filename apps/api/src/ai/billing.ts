import { prisma } from "../db.js";
import { env } from "../env.js";
import { writeAudit } from "../audit.js";
import { DEFAULT_AI_SIGNUP_BONUS_TOKENS, DEFAULT_AI_SUB_PLANS, DEFAULT_AI_TOPUP_PACKAGES, type AiSubPlan, type AiTopupPackage } from "@aigoogle/shared";

/**
 * Billing AI per MEMBER (saldo rupiah).
 * Harga basis OpenRouter (USD per 1 juta token) × kurs × markup → tagihan rupiah.
 * Tanpa kedaluwarsa, blokir total bila saldo di bawah reserve.
 */
export class AiSaldoHabis extends Error {
  constructor(
    public balance: number,
    public need: number
  ) {
    super("saldo_ai_habis");
  }
}

/** Masa langganan AI & masa demo 3 hari sudah habis. */
export class AiLanggananHabis extends Error {
  constructor(
    public reason: "trial" | "subscription",
    public trialEndsAt: Date | null
  ) {
    super("langganan_ai_habis");
  }
}

const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export interface AiBillingCfg {
  usdIdr: number;
  markup: number;
  signupBonus: number;
  /** bonus pendaftaran dalam token (tampilan) */
  signupBonusTokens: number;
  minReserve: number;
  /** harga jual 1.000 token (rupiah) — dasar tampilan saldo token */
  rupiahPer1kTokens: number;
}

export async function billingSettings(): Promise<AiBillingCfg> {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: { in: ["ai:usd_idr", "ai:markup", "ai:signup_bonus", "aiSignupBonusTokens", "ai:min_reserve", "ai:rupiah_per_1k_tokens"] },
    },
  });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const rupiahPer1kTokens = Math.max(0.001, num(get("ai:rupiah_per_1k_tokens"), 40));
  const signupBonus = Math.max(0, Math.round(num(get("ai:signup_bonus"), 10000)));
  const rawBonusTokens = get("aiSignupBonusTokens");
  const signupBonusTokens =
    rawBonusTokens !== undefined
      ? Math.max(0, Math.round(num(rawBonusTokens, DEFAULT_AI_SIGNUP_BONUS_TOKENS)))
      : // kompatibilitas setelan lama (bonus dalam rupiah)
        rupiahToTokens(signupBonus, rupiahPer1kTokens);
  return {
    usdIdr: Math.max(1, num(get("ai:usd_idr"), 16500)),
    markup: Math.max(1, num(get("ai:markup"), 1.5)),
    signupBonus,
    signupBonusTokens,
    minReserve: Math.max(1, Math.round(num(get("ai:min_reserve"), 500))),
    rupiahPer1kTokens,
  };
}

/** Parse & validasi paket top up token AI (dinamis; fallback default bila rusak). */
export function parseAiTopupPackages(raw: string | undefined | null): AiTopupPackage[] {
  if (!raw) return DEFAULT_AI_TOPUP_PACKAGES;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr) || arr.length < 1) return DEFAULT_AI_TOPUP_PACKAGES;
    return arr.slice(0, 12).map((p, i) => {
      const o = (p ?? {}) as Record<string, unknown>;
      return {
        id: typeof o.id === "string" && o.id ? o.id.slice(0, 24) : `a${i + 1}`,
        price: Math.min(10_000_000, Math.max(1000, Math.round(Number(o.price) || DEFAULT_AI_TOPUP_PACKAGES[0]!.price))),
        tokens: Math.min(1_000_000_000, Math.max(1000, Math.round(Number(o.tokens) || DEFAULT_AI_TOPUP_PACKAGES[0]!.tokens))),
      };
    });
  } catch {
    return DEFAULT_AI_TOPUP_PACKAGES;
  }
}

export async function getAiTopupPackages(): Promise<AiTopupPackage[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: "aiTopupPackages" } });
  return parseAiTopupPackages(row?.value);
}

/** Parse & validasi 3 paket langganan AI (fallback ke default bila rusak). */
export function parseAiSubPlans(raw: string | undefined | null): AiSubPlan[] {
  if (!raw) return DEFAULT_AI_SUB_PLANS;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr) || arr.length !== 3) return DEFAULT_AI_SUB_PLANS;
    return arr.map((p, i) => {
      const o = (p ?? {}) as Record<string, unknown>;
      const def = DEFAULT_AI_SUB_PLANS[i]!;
      return {
        id: typeof o.id === "string" && o.id ? o.id.slice(0, 24) : def.id,
        name: typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 40) : def.name,
        months: Math.min(36, Math.max(1, Math.round(Number(o.months) || def.months))),
        price: Math.min(10_000_000, Math.max(1000, Math.round(Number(o.price) || def.price))),
        tokens: Math.min(1_000_000_000, Math.max(1000, Math.round(Number(o.tokens) || def.tokens))),
        features: Array.isArray(o.features)
          ? o.features.map((f) => String(f).trim().slice(0, 80)).filter(Boolean).slice(0, 8)
          : def.features,
      };
    });
  } catch {
    return DEFAULT_AI_SUB_PLANS;
  }
}

export async function getAiSubPlans(): Promise<AiSubPlan[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: "aiSubPlans" } });
  return parseAiSubPlans(row?.value);
}

/** rupiah → token (1.000 token = rupiahPer1kTokens) */
export function rupiahToTokens(rupiah: number, rupiahPer1kTokens: number): number {
  return Math.floor((Math.max(0, rupiah) / Math.max(0.001, rupiahPer1kTokens)) * 1000);
}

/** token → rupiah */
export function tokensToRupiah(tokens: number, rupiahPer1kTokens: number): number {
  return Math.round((Math.max(0, tokens) / 1000) * Math.max(0.001, rupiahPer1kTokens));
}

/** biaya admin + service charge Midtrans untuk top up saldo AI (2%) */
export function topupFee(baseAmount: number): number {
  return Math.max(0, Math.round(baseAmount * 0.02));
}

/**
 * Wallet dibuat saat pertama dipakai. Bonus pendaftaran hanya diberikan SEKALI
 * per perusahaan (tenant) — bagi user pertama yang mendaftar lewat Accurate.
 */
export async function ensureWallet(userId: string, tenantId: string) {
  const existing = await prisma.aiWallet.findUnique({ where: { userId } });
  if (existing) return existing;
  const cfg = await billingSettings();
  const bonusRupiah = tokensToRupiah(cfg.signupBonusTokens, cfg.rupiahPer1kTokens);
  try {
    return await prisma.$transaction(async (tx) => {
      const priorBonus = await tx.aiLedger.findFirst({
        where: { tenantId, kind: "bonus" },
        select: { id: true },
      });
      const grant = priorBonus ? 0 : bonusRupiah;
      const w = await tx.aiWallet.create({ data: { userId, tenantId, balance: grant } });
      if (grant > 0) {
        await tx.aiLedger.create({
          data: {
            userId,
            tenantId,
            kind: "bonus",
            amount: grant,
            meta: `bonus token pendaftaran (${cfg.signupBonusTokens.toLocaleString("id-ID")} token)`,
          },
        });
      }
      return w;
    });
  } catch (e) {
    // dua request paralel bisa sama-sama membuat wallet; yang kalah pakai wallet existing
    if ((e as { code?: string }).code === "P2002") {
      const existingNow = await prisma.aiWallet.findUnique({ where: { userId } });
      if (existingNow) return existingNow;
    }
    throw e;
  }
}

/** Kredit token (mis. langganan bulanan) ke wallet member — token dikonversi ke rupiah internal. */
export async function creditTokens(opts: {
  userId: string;
  tenantId: string;
  tokens: number;
  refId: string;
  meta: string;
}): Promise<{ balance: number; credits: number }> {
  const cfg = await billingSettings();
  const credits = tokensToRupiah(opts.tokens, cfg.rupiahPer1kTokens);
  await ensureWallet(opts.userId, opts.tenantId);
  return prisma.$transaction(async (tx) => {
    const w = await tx.aiWallet.update({
      where: { userId: opts.userId },
      data: { balance: { increment: credits } },
    });
    await tx.aiLedger.create({
      data: {
        userId: opts.userId,
        tenantId: opts.tenantId,
        kind: "topup",
        amount: credits,
        refId: opts.refId.slice(0, 80),
        meta: opts.meta.slice(0, 200),
      },
    });
    return { balance: w.balance, credits };
  });
}

/** Pemilik/admin pertama perusahaan — penerima token langganan/bonus otomatis. */
export async function tenantOwnerId(tenantId: string): Promise<string | null> {
  const owner = await prisma.user.findFirst({
    where: { tenantId, role: { permissions: { some: { permissionKey: "app:users.manage" } } } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (owner) return owner.id;
  const first = await prisma.user.findFirst({ where: { tenantId }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return first?.id ?? null;
}

export async function getBalance(userId: string, tenantId: string): Promise<number> {
  return (await ensureWallet(userId, tenantId)).balance;
}

export interface ModelPrice {
  model: string;
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  markup: number;
  usdIdr: number;
}

/**
 * Model yang dipakai bisa berbeda dari nama di setelan modul (mis. override env
 * saat development). Bila tak ada harga utk nama itu, pakai harga model override.
 */
async function effectiveModel(model: string): Promise<string> {
  const direct = await prisma.aiModelPrice.findUnique({ where: { model } });
  if (direct) return model;
  const ov = env.LLM_OVERRIDE_MODEL;
  if (ov) {
    const alt = await prisma.aiModelPrice.findUnique({ where: { model: ov } });
    if (alt) return ov;
  }
  return model;
}

export async function priceFor(model: string): Promise<ModelPrice> {
  const cfg = await billingSettings();
  const row = await prisma.aiModelPrice.findUnique({ where: { model } });
  return {
    model,
    inputUsdPer1M: row?.inputUsdPer1M ?? 0.3,
    outputUsdPer1M: row?.outputUsdPer1M ?? 1.2,
    markup: row?.markup ?? cfg.markup,
    usdIdr: cfg.usdIdr,
  };
}

/** biaya modal & tagihan (rupiah) dari jumlah token */
export function computeCharge(
  p: Pick<ModelPrice, "inputUsdPer1M" | "outputUsdPer1M" | "markup" | "usdIdr">,
  promptTokens: number,
  completionTokens: number
): { cost: number; charge: number } {
  const usd = (Math.max(0, promptTokens) / 1e6) * p.inputUsdPer1M + (Math.max(0, completionTokens) / 1e6) * p.outputUsdPer1M;
  const cost = usd * p.usdIdr;
  // minimal 1 rupiah per panggilan berbayar; pembulatan ke atas (margin mikro)
  const charge = Math.max(1, Math.ceil(cost * p.markup));
  return { cost: Math.max(0, Math.round(cost)), charge };
}

/** potong saldo untuk satu pemakaian AI (setelah panggilan selesai) */
export async function chargeAi(opts: {
  userId: string;
  tenantId: string;
  kind: "chat" | "voice" | "router" | "doc" | "drive";
  model: string;
  promptTokens: number;
  completionTokens: number;
  refId?: string;
  meta?: Record<string, unknown>;
}): Promise<{ balance: number; charged: number; cost: number; charge: number }> {
  await ensureWallet(opts.userId, opts.tenantId);
  const billedModel = await effectiveModel(opts.model);
  const p = await priceFor(billedModel);
  const { cost, charge } = computeCharge(p, opts.promptTokens, opts.completionTokens);
  const result = await prisma.$transaction(async (tx) => {
    const w = await tx.aiWallet.findUniqueOrThrow({ where: { userId: opts.userId } });
    const deduct = Math.min(w.balance, charge);
    await tx.aiLedger.create({
      data: {
        userId: opts.userId,
        tenantId: opts.tenantId,
        kind: "usage",
        amount: -deduct,
        cost,
        model: billedModel.slice(0, 80),
        promptTokens: Math.max(0, Math.round(opts.promptTokens)),
        completionTokens: Math.max(0, Math.round(opts.completionTokens)),
        refId: (opts.refId ?? "").slice(0, 80),
        meta: JSON.stringify({ ...(opts.meta ?? {}), charge, shortfall: charge - deduct }),
      },
    });
    if (deduct > 0) {
      await tx.aiWallet.update({ where: { userId: opts.userId }, data: { balance: { decrement: deduct } } });
    }
    return { balance: w.balance - deduct, charged: deduct, cost, charge };
  });
  void import("../billing/dunning.js")
    .then((m) => m.maybeAlertLowBalance(opts.userId, opts.tenantId, result.balance))
    .catch(() => null);
  return result;
}

/**
 * Pemakaian AI OTOMATIS (tanpa user di konteks) tetap dibebankan ke MEMBER:
 * dialokasikan ke admin/owner perusahaan (pemilik pekerjaan).
 */
export async function chargeAuto(opts: {
  tenantId: string;
  kind: "chat" | "voice" | "router" | "doc" | "drive";
  model: string;
  promptTokens: number;
  completionTokens: number;
  refId?: string;
  meta?: Record<string, unknown>;
}): Promise<{ balance: number; charged: number } | null> {
  const owner = await prisma.user.findFirst({
    where: {
      tenantId: opts.tenantId,
      role: { permissions: { some: { permissionKey: "app:users.manage" } } },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!owner) return null;
  const out = await chargeAi({
    userId: owner.id,
    tenantId: opts.tenantId,
    kind: opts.kind,
    model: opts.model,
    promptTokens: opts.promptTokens,
    completionTokens: opts.completionTokens,
    refId: opts.refId,
    meta: { ...(opts.meta ?? {}), auto: true },
  });
  return { balance: out.balance, charged: out.charged };
}

/** cek sebelum memulai pekerjaan AI — blokir total bila saldo < reserve */
export async function assertCanUseAi(userId: string, tenantId: string): Promise<number> {
  const cfg = await billingSettings();
  const bal = await getBalance(userId, tenantId);
  if (bal < cfg.minReserve) throw new AiSaldoHabis(bal, cfg.minReserve);
  return bal;
}

export interface AiAccessStatus {
  reason: "ok" | "subscription" | "token";
  subscriptionActive: boolean;
  everSubscribed: boolean;
  trialActive: boolean;
  trialEndsAt: string | null;
  balance: number;
  minReserve: number;
}

/**
 * Status akses AI perusahaan:
 * - langganan AI aktif → lanjut;
 * - belum langganan → masa demo 3 hari sejak perusahaan didaftarkan via Accurate;
 * - trial/langganan habis → wajib subscription;
 * - token di bawah reserve → wajib top up (wallet).
 */
export async function aiAccessStatus(userId: string, tenantId: string): Promise<AiAccessStatus> {
  const now = new Date();
  const [cfg, sub, tenant, balance] = await Promise.all([
    billingSettings(),
    prisma.subscription.findFirst({
      where: {
        tenantId,
        OR: [{ plan: { startsWith: "ai:" } }, { plan: "pro" }],
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { createdAt: true } }),
    getBalance(userId, tenantId),
  ]);
  const subscriptionActive = !!sub && sub.status === "active" && (!sub.expiresAt || sub.expiresAt > now);
  const trialEndsAt = tenant ? new Date(tenant.createdAt.getTime() + 3 * 86400_000) : null;
  const trialActive = !!trialEndsAt && trialEndsAt > now;
  const reason: AiAccessStatus["reason"] =
    !subscriptionActive && !trialActive ? "subscription" : balance < cfg.minReserve ? "token" : "ok";
  return {
    reason,
    subscriptionActive,
    everSubscribed: !!sub,
    trialActive,
    trialEndsAt: trialEndsAt?.toISOString() ?? null,
    balance,
    minReserve: cfg.minReserve,
  };
}

/** Gate lengkap: langganan/demo dulu, lalu saldo token. */
export async function assertAiAccess(userId: string, tenantId: string): Promise<AiAccessStatus> {
  const status = await aiAccessStatus(userId, tenantId);
  if (status.reason === "subscription") {
    throw new AiLanggananHabis(status.everSubscribed ? "subscription" : "trial", status.trialEndsAt ? new Date(status.trialEndsAt) : null);
  }
  if (status.reason === "token") throw new AiSaldoHabis(status.balance, status.minReserve);
  return status;
}

export async function adjustWallet(opts: {
  userId: string;
  tenantId: string;
  amount: number;
  note: string;
  byUserId: string;
}): Promise<{ balance: number }> {
  await ensureWallet(opts.userId, opts.tenantId);
  const amount = Math.round(opts.amount);
  const res = await prisma.$transaction(async (tx) => {
    const w = await tx.aiWallet.update({ where: { userId: opts.userId }, data: { balance: { increment: amount } } });
    await tx.aiLedger.create({
      data: {
        userId: opts.userId,
        tenantId: opts.tenantId,
        kind: "adjust",
        amount,
        refId: opts.byUserId.slice(0, 80),
        meta: opts.note.slice(0, 200),
      },
    });
    return w;
  });
  await writeAudit(opts.tenantId, opts.byUserId, "ai.wallet_adjust", {
    userId: opts.userId,
    amount,
    balance: res.balance,
    note: opts.note.slice(0, 200),
  });
  return { balance: res.balance };
}

/** kredit topup (idempotent per orderId) */
export async function finalizeAiTopup(
  orderId: string,
  paid: boolean,
  finalStatus: string,
  paymentMethod: string
): Promise<boolean> {
  const topup = await prisma.aiTopup.findUnique({ where: { orderId } });
  if (!topup) return false;
  if (topup.status === "settlement") return true;
  await prisma.aiTopup.update({
    where: { id: topup.id },
    data: { status: finalStatus, paymentMethod },
  });
  if (paid) {
    await ensureWallet(topup.userId, topup.tenantId);
    await prisma.$transaction(async (tx) => {
      await tx.aiWallet.update({ where: { userId: topup.userId }, data: { balance: { increment: topup.credits } } });
      await tx.aiLedger.create({
        data: {
          userId: topup.userId,
          tenantId: topup.tenantId,
          kind: "topup",
          amount: topup.credits,
          refId: topup.orderId,
          meta: `qris ${paymentMethod}`,
        },
      });
    });
    await writeAudit(topup.tenantId, "system", "ai.topup_settled", {
      orderId: topup.orderId,
      credits: topup.credits,
      userId: topup.userId,
    });
  } else {
    await writeAudit(topup.tenantId, "system", "ai.topup_failed", { orderId: topup.orderId, status: finalStatus });
  }
  return true;
}

export async function walletSummary(userId: string, tenantId: string) {
  const cfg = await billingSettings();
  const w = await ensureWallet(userId, tenantId);
  const since = new Date(Date.now() - 30 * 86400_000);
  const rows = await prisma.aiLedger.findMany({ where: { userId, createdAt: { gte: since } } });
  const usage = rows.filter((r) => r.kind === "usage");
  return {
    /** saldo dalam TOKEN (tampilan utama) */
    balanceTokens: rupiahToTokens(w.balance, cfg.rupiahPer1kTokens),
    rupiahPer1kTokens: cfg.rupiahPer1kTokens,
    minReserveTokens: rupiahToTokens(cfg.minReserve, cfg.rupiahPer1kTokens),
    markup: cfg.markup,
    usdIdr: cfg.usdIdr,
    /** token yang benar-benar dipakai (prompt+completion) 30 hari */
    tokens30d: usage.reduce((a, r) => a + r.promptTokens + r.completionTokens, 0),
    /** token setara biaya terpotong 30 hari */
    spentTokens30d: usage.reduce((a, r) => a + rupiahToTokens(Math.abs(r.amount), cfg.rupiahPer1kTokens), 0),
    calls30d: usage.length,
    /** paket top up token yang diatur Admin Platform */
    topupPackages: await getAiTopupPackages(),
    /** status akses: langganan/demo/token */
    access: await aiAccessStatus(userId, tenantId),
    /** internal (rupiah) — untuk admin/laporan */
    balance: w.balance,
    spent30d: usage.reduce((a, r) => a + Math.abs(r.amount), 0),
    cost30d: usage.reduce((a, r) => a + r.cost, 0),
    minReserve: cfg.minReserve,
  };
}

export async function ledgerFor(userId: string, take = 10, skip = 0) {
  return prisma.aiLedger.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(take, 1), 200),
    skip: Math.max(0, skip),
  });
}

// ── Harga (basis OpenRouter) ────────────────────────────────────────────────

interface OpenRouterModel {
  id: string;
  pricing?: { prompt?: string; completion?: string };
}

function matchOpenRouter(list: OpenRouterModel[], model: string, openrouterId: string): OpenRouterModel | null {
  if (openrouterId) {
    const exact = list.find((m) => m.id === openrouterId);
    if (exact) return exact;
  }
  const base = model.toLowerCase();
  const candidates = list.filter((m) => {
    const tail = m.id.split("/").pop()?.toLowerCase() ?? "";
    return tail === base || tail.startsWith(`${base}-`) || m.id.toLowerCase() === base;
  });
  return candidates.length === 1 ? candidates[0]! : null;
}

/** sinkron harga dari OpenRouter (USD per token → per 1 juta token) */
export async function syncOpenRouterPricing(): Promise<{ updated: number; total: number }> {
  const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`openrouter ${res.status}`);
  const data = (await res.json()) as { data?: OpenRouterModel[] };
  const list = data.data ?? [];
  const rows = await prisma.aiModelPrice.findMany();
  let updated = 0;
  for (const row of rows) {
    const match = matchOpenRouter(list, row.model, row.openrouterId);
    if (!match) continue;
    const input = Number(match.pricing?.prompt ?? 0) * 1e6;
    const output = Number(match.pricing?.completion ?? 0) * 1e6;
    if (!(input > 0) || !(output > 0)) continue;
    await prisma.aiModelPrice.update({
      where: { id: row.id },
      data: { inputUsdPer1M: input, outputUsdPer1M: output, openrouterId: match.id, source: "openrouter" },
    });
    updated += 1;
  }
  return { updated, total: rows.length };
}

/** laporan margin platform (tagihan vs modal) */
export async function revenueReport(days = 30) {
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await prisma.aiLedger.findMany({
    where: { createdAt: { gte: since }, kind: { in: ["usage", "topup"] } },
  });
  const usage = rows.filter((r) => r.kind === "usage");
  const topup = rows.filter((r) => r.kind === "topup");
  const charged = usage.reduce((a, r) => a + Math.abs(r.amount), 0);
  const cost = usage.reduce((a, r) => a + r.cost, 0);
  const byTenant = new Map<string, { charged: number; cost: number; calls: number; topup: number }>();
  for (const r of rows) {
    const e = byTenant.get(r.tenantId) ?? { charged: 0, cost: 0, calls: 0, topup: 0 };
    if (r.kind === "usage") {
      e.charged += Math.abs(r.amount);
      e.cost += r.cost;
      e.calls += 1;
    } else {
      e.topup += r.amount;
    }
    byTenant.set(r.tenantId, e);
  }
  return {
    days,
    totals: {
      charged,
      cost,
      margin: charged - cost,
      topup: topup.reduce((a, r) => a + r.amount, 0),
      calls: usage.length,
    },
    tenants: [...byTenant.entries()]
      .map(([tenantId, v]) => ({ tenantId, ...v, margin: v.charged - v.cost }))
      .sort((a, b) => b.charged - a.charged)
      .slice(0, 50),
  };
}
