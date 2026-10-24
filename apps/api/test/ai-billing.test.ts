import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import {
  AiSaldoHabis,
  adjustWallet,
  assertCanUseAi,
  billingSettings,
  chargeAi,
  computeCharge,
  finalizeAiTopup,
  getBalance,
  topupFee,
  walletSummary,
} from "../src/ai/billing.js";

const TENANT = "tenant-uji-billing";
const USER = "user-uji-billing";

beforeAll(async () => {
  await prisma.aiModelPrice.upsert({
    where: { model: "uji-model" },
    create: { model: "uji-model", inputUsdPer1M: 1, outputUsdPer1M: 2, markup: 2, source: "manual" },
    update: { inputUsdPer1M: 1, outputUsdPer1M: 2, markup: 2 },
  });
  await prisma.appSetting.upsert({
    where: { key: "ai:usd_idr" },
    create: { key: "ai:usd_idr", value: "10000" },
    update: { value: "10000" },
  });
  await prisma.appSetting.upsert({
    where: { key: "ai:signup_bonus" },
    create: { key: "ai:signup_bonus", value: "5000" },
    update: { value: "5000" },
  });
  await prisma.aiLedger.deleteMany({ where: { userId: USER } });
  await prisma.aiWallet.deleteMany({ where: { userId: USER } });
  await prisma.aiTopup.deleteMany({ where: { userId: USER } });
});

afterAll(async () => {
  await prisma.aiLedger.deleteMany({ where: { userId: USER } });
  await prisma.aiWallet.deleteMany({ where: { userId: USER } });
  await prisma.aiTopup.deleteMany({ where: { userId: USER } });
  await prisma.aiModelPrice.deleteMany({ where: { model: "uji-model" } });
  await prisma.appSetting.deleteMany({ where: { key: { in: ["ai:usd_idr", "ai:signup_bonus"] } } });
});

describe("hitung biaya AI", () => {
  it("modal & tagihan = token × harga × kurs × markup", () => {
    const { cost, charge } = computeCharge({ inputUsdPer1M: 1, outputUsdPer1M: 2, markup: 2, usdIdr: 10000 }, 1_000_000, 1_000_000);
    // 1 USD input + 2 USD output = 3 USD → Rp30.000 modal, markup 2× → Rp60.000
    expect(cost).toBe(30_000);
    expect(charge).toBe(60_000);
  });

  it("biaya top up = 2% (admin + service charge Midtrans)", () => {
    expect(topupFee(25_000)).toBe(500);
    expect(topupFee(100_000)).toBe(2_000);
    expect(topupFee(10_000)).toBe(200);
  });

  it("minimal 1 rupiah walau biaya mikro", () => {
    expect(computeCharge({ inputUsdPer1M: 0, outputUsdPer1M: 0, markup: 1.5, usdIdr: 16500 }, 10, 10).charge).toBe(1);
  });
});

describe("wallet member", () => {
  it("wallet baru dapat saldo awal (bonus) sesuai setelan platform", async () => {
    const bal = await getBalance(USER, TENANT);
    expect(bal).toBe(5000);
    const bonus = await prisma.aiLedger.findFirst({ where: { userId: USER, kind: "bonus" } });
    expect(bonus?.amount).toBe(5000);
  });

  it("chargeAi memotong saldo + mencatat modal/margin", async () => {
    const out = await chargeAi({
      userId: USER,
      tenantId: TENANT,
      kind: "chat",
      model: "uji-model",
      promptTokens: 1000,
      completionTokens: 500,
    });
    // 1000 tok input = 0.001 USD; 500 tok output = 0.001 USD → 0.002 USD = Rp20 modal; 2× = Rp40
    expect(out.cost).toBe(20);
    expect(out.charge).toBe(40);
    expect(out.charged).toBe(40);
    expect(await getBalance(USER, TENANT)).toBe(4960);
  });

  it("saldo di bawah reserve → assertCanUseAi melempar AiSaldoHabis", async () => {
    await prisma.aiWallet.update({ where: { userId: USER }, data: { balance: 100 } });
    await expect(assertCanUseAi(USER, TENANT)).rejects.toBeInstanceOf(AiSaldoHabis);
    await prisma.aiWallet.update({ where: { userId: USER }, data: { balance: 5000 } });
    expect(await assertCanUseAi(USER, TENANT)).toBe(5000);
  });

  it("adjustWallet menambah saldo + ledger", async () => {
    const out = await adjustWallet({ userId: USER, tenantId: TENANT, amount: 2500, note: "uji", byUserId: USER });
    expect(out.balance).toBe(7500);
    const row = await prisma.aiLedger.findFirst({ where: { userId: USER, kind: "adjust" } });
    expect(row?.amount).toBe(2500);
  });
});

describe("top up", () => {
  it("finalizeAiTopup idempotent (kredit hanya sekali)", async () => {
    const orderId = `ai-uji-${Date.now()}`;
    await prisma.aiTopup.create({
      data: { orderId, userId: USER, tenantId: TENANT, amount: 10050, credits: 10000 },
    });
    const before = await getBalance(USER, TENANT);
    await finalizeAiTopup(orderId, true, "settlement", "winpay");
    await finalizeAiTopup(orderId, true, "settlement", "winpay");
    expect(await getBalance(USER, TENANT)).toBe(before + 10000);
    const rows = await prisma.aiLedger.findMany({ where: { userId: USER, refId: orderId } });
    expect(rows).toHaveLength(1);
  });

  it("topup gagal tidak menambah saldo", async () => {
    const orderId = `ai-uji-fail-${Date.now()}`;
    await prisma.aiTopup.create({ data: { orderId, userId: USER, tenantId: TENANT, amount: 10050, credits: 10000 } });
    const before = await getBalance(USER, TENANT);
    await finalizeAiTopup(orderId, false, "cancel", "winpay");
    expect(await getBalance(USER, TENANT)).toBe(before);
  });
});

describe("setelan billing", () => {
  it("membaca kurs/bonus dari appSetting", async () => {
    const cfg = await billingSettings();
    expect(cfg.usdIdr).toBe(10000);
    expect(cfg.signupBonus).toBe(5000);
    expect(cfg.markup).toBeGreaterThanOrEqual(1);
  });

  it("walletSummary menghitung pemakaian 30 hari", async () => {
    const s = await walletSummary(USER, TENANT);
    expect(s.calls30d).toBeGreaterThan(0);
    expect(s.tokens30d).toBeGreaterThan(0);
    expect(s.spent30d).toBeGreaterThan(0);
  });
});
