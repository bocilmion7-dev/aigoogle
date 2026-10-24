import { prisma } from "../db.js";
import { recordLlm } from "../metrics.js";
import { chargeAi } from "./billing.js";

/**
 * Pencatatan pemakaian LLM per tenant (estimasi token = karakter/4).
 * Tujuan: kuota harian + analytics biaya — bukan tagihan presisi.
 */
const estTokens = (chars: number): number => (chars > 0 ? Math.max(1, Math.round(chars / 4)) : 0);
const dayKey = (): string => new Date().toISOString().slice(0, 10);

export type LlmKind = "chat" | "voice" | "router" | "doc";

export async function recordLlmUsage(opts: {
  tenantId: string;
  kind: LlmKind;
  model?: string;
  promptChars: number;
  completionChars: number;
  /** bila diisi → pemakaian dipotong dari saldo AI member ini */
  userId?: string;
}): Promise<void> {
  const promptTokens = estTokens(opts.promptChars);
  const completionTokens = estTokens(opts.completionChars);
  recordLlm(opts.kind, promptTokens, completionTokens);
  const model = (opts.model ?? "").slice(0, 80);
  if (opts.userId) {
    void chargeAi({
      userId: opts.userId,
      tenantId: opts.tenantId,
      kind: opts.kind,
      model: model || "unknown",
      promptTokens,
      completionTokens,
    }).catch((e) => console.warn("[billing] charge gagal:", e instanceof Error ? e.message.slice(0, 120) : e));
  }
  try {
    await prisma.llmUsage.upsert({
      where: {
        tenantId_day_kind_model: { tenantId: opts.tenantId, day: dayKey(), kind: opts.kind, model },
      },
      create: {
        tenantId: opts.tenantId,
        day: dayKey(),
        kind: opts.kind,
        model,
        calls: 1,
        promptTokens,
        completionTokens,
      },
      update: {
        calls: { increment: 1 },
        promptTokens: { increment: promptTokens },
        completionTokens: { increment: completionTokens },
      },
    });
  } catch (e) {
    // jangan pernah menggagalkan chat hanya karena pencatatan gagal
    console.warn("[usage] gagal catat:", e instanceof Error ? e.message.slice(0, 120) : e);
  }
}

export async function usageToday(tenantId: string): Promise<{ calls: number; tokens: number }> {
  const rows = await prisma.llmUsage.findMany({ where: { tenantId, day: dayKey() } });
  return {
    calls: rows.reduce((a, r) => a + r.calls, 0),
    tokens: rows.reduce((a, r) => a + r.promptTokens + r.completionTokens, 0),
  };
}

/** kuota token harian per tenant (0 = tanpa batas); fallback ke setelan global */
export async function dailyLimit(tenantId: string): Promise<number> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [`llm:daily_token_limit:${tenantId}`, "llm:daily_token_limit"] } },
  });
  const perTenant = rows.find((r) => r.key.endsWith(`:${tenantId}`))?.value;
  const global = rows.find((r) => r.key === "llm:daily_token_limit")?.value;
  const v = Number(perTenant ?? global ?? 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
}
