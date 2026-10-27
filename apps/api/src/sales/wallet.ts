import { prisma } from "../db.js";
import { writeAudit } from "../audit.js";
import { getShopOrder } from "../wa/shop-order.js";
import { brickReady, brickValidateAccount, type BrickValidation } from "./brick.js";

/**
 * Wallet Penjualan — saldo hasil penjualan per tenant (TERPISAH dari saldo
 * token AI/AiWallet). Kredit otomatis saat pesanan lunas (QRIS settlement),
 * lalu bisa ditarik (withdraw) oleh pemilik.
 */

/** Tambah saldo penjualan (credit). Idempoten via orderId unik di ledger. */
export async function creditSalesWallet(opts: {
  tenantId: string;
  amount: number;
  orderId: string;
  note?: string;
}): Promise<number> {
  const amount = Math.round(opts.amount);
  if (!(amount > 0)) return 0;
  try {
    const wallet = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.salesWalletTx.findFirst({
          where: { tenantId: opts.tenantId, orderId: opts.orderId, kind: "sale" },
        });
        if (existing) return null; // sudah dicatat — anti dobel
        const w = await tx.salesWallet.upsert({
          where: { tenantId: opts.tenantId },
          create: { tenantId: opts.tenantId, balance: amount },
          update: { balance: { increment: amount } },
        });
        await tx.salesWalletTx.create({
          data: { tenantId: opts.tenantId, kind: "sale", amount, orderId: opts.orderId, note: opts.note ?? "" },
        });
        return w;
      },
      { isolationLevel: "Serializable" }
    );
    if (!wallet) return 0;
    await writeAudit(opts.tenantId, "system", "sales.wallet_credit", { amount, orderId: opts.orderId });
    return wallet.balance;
  } catch (e) {
    // konflik serialisasi → anggap sudah/akan diproses pemanggil lain
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2034") return 0;
    throw e;
  }
}

/**
 * Rekonsiliasi wallet penjualan: kredit ulang setiap pesanan lunas yang belum
 * tercatat di ledger. Dipanggil saat wallet/laporan dibaca, jadi saldo selalu
 * sinkron dengan pesanan sukses (termasuk yang lunas sebelum fitur ada).
 */
export async function reconcileSalesWallet(tenantId: string, force = false): Promise<number> {
  const throttleKey = `sales:reconcile_at:${tenantId}`;
  if (!force) {
    const last = await prisma.appSetting.findUnique({ where: { key: throttleKey } });
    const at = Number(last?.value ?? 0);
    if (at && Date.now() - at < 5 * 60_000) return 0;
  }
  const settings = await prisma.appSetting.findMany({
    where: { key: { startsWith: "wa:shop_order:" } },
    select: { value: true },
  });
  const credited = await prisma.salesWalletTx.findMany({
    where: { tenantId, kind: "sale" },
    select: { orderId: true },
  });
  const already = new Set(credited.map((c) => c.orderId));
  let creditedCount = 0;
  for (const s of settings) {
    try {
      const o = JSON.parse(s.value) as Record<string, unknown>;
      if (o?.tenantId !== tenantId) continue;
      const status = String(o.status ?? "");
      const acc = (o.accurate ?? {}) as Record<string, unknown>;
      const success = status === "paid" || acc.salesInvoice || acc.salesReceipt;
      if (!success) continue;
      const orderId = String(o.orderId ?? "");
      if (!orderId || already.has(orderId)) continue;
      const total = Number(o.total ?? 0);
      if (!(total > 0)) continue;
      await creditSalesWallet({ tenantId, amount: total, orderId, note: `Rekonsiliasi pesanan lunas ${orderId}` });
      already.add(orderId);
      creditedCount++;
    } catch {
      // lewati blob tidak valid
    }
  }
  await prisma.appSetting
    .upsert({
      where: { key: throttleKey },
      create: { key: throttleKey, value: String(Date.now()) },
      update: { value: String(Date.now()) },
    })
    .catch(() => null);
  if (creditedCount > 0) {
    await writeAudit(tenantId, "system", "sales.wallet_reconcile", { count: creditedCount });
  }
  return creditedCount;
}

/** Saldo wallet penjualan + ringkasan ledger. */
export async function salesWalletSummary(tenantId: string) {
  await reconcileSalesWallet(tenantId);
  const wallet = await prisma.salesWallet.upsert({
    where: { tenantId },
    create: { tenantId },
    update: {},
  });
  const [txs, withdrawals] = await Promise.all([
    prisma.salesWalletTx.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.salesWithdrawal.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const pending = withdrawals.filter((w) => w.status === "pending").reduce((s, w) => s + w.amount, 0);
  return {
    balance: wallet.balance,
    pendingWithdrawal: pending,
    available: Math.max(0, wallet.balance - pending),
    txs,
    withdrawals,
  };
}

/** Buat permintaan penarikan — saldo dipotong, status pending sampai dibayar admin. */
export async function createWithdrawal(opts: {
  tenantId: string;
  amount: number;
  bankAccountId?: string;
  bankName?: string;
  bankNo?: string;
  accountName?: string;
  note?: string;
  actor?: string;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const amount = Math.round(opts.amount);
  const min = 10000;
  if (!(amount >= min)) return { ok: false, error: "minimal_penarikan" };
  // Rekening tujuan wajib dari akun tersimpan yang sudah tervalidasi Brick.
  let bankName = opts.bankName ?? "";
  let bankNo = opts.bankNo ?? "";
  let accountName = opts.accountName ?? "";
  if (opts.bankAccountId) {
    const acc = await prisma.salesBankAccount.findFirst({
      where: { id: opts.bankAccountId, tenantId: opts.tenantId },
    });
    if (!acc) return { ok: false, error: "rekening_tidak_ditemukan" };
    bankName = acc.bankName;
    bankNo = acc.accountNo;
    accountName = acc.accountName;
  } else if (!bankName || !bankNo) {
    return { ok: false, error: "rekening_wajib" };
  }
  try {
    const w = await prisma.$transaction(
      async (tx) => {
        const wallet = await tx.salesWallet.upsert({
          where: { tenantId: opts.tenantId },
          create: { tenantId: opts.tenantId },
          update: {},
        });
        const pending = await tx.salesWithdrawal.aggregate({
          where: { tenantId: opts.tenantId, status: "pending" },
          _sum: { amount: true },
        });
        const available = wallet.balance - (pending._sum.amount ?? 0);
        if (amount > available) throw new Error("saldo_kurang");

        await tx.salesWallet.update({
          where: { tenantId: opts.tenantId },
          data: { balance: { decrement: amount } },
        });
        await tx.salesWalletTx.create({
          data: {
            tenantId: opts.tenantId,
            kind: "withdraw",
            amount: -amount,
            note: `Penarikan ${bankName} ${bankNo}`.trim(),
          },
        });
        return tx.salesWithdrawal.create({
          data: {
            tenantId: opts.tenantId,
            amount,
            bankName: bankName.slice(0, 60),
            bankNo: bankNo.slice(0, 40),
            accountName: accountName.slice(0, 100),
            note: (opts.note ?? "").slice(0, 300),
          },
        });
      },
      { isolationLevel: "Serializable" }
    );
    await writeAudit(opts.tenantId, opts.actor ?? "system", "sales.withdraw_request", {
      id: w.id,
      amount,
      bank: bankName,
      bankNo,
    });
    return { ok: true, id: w.id };
  } catch (e) {
    if (e instanceof Error && e.message === "saldo_kurang") return { ok: false, error: "saldo_kurang" };
    // konflik serialisasi (dua penarikan bersamaan) → minta pengguna coba lagi
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2034") {
      return { ok: false, error: "coba_lagi" };
    }
    throw e;
  }
}

/** Update status penarikan oleh admin/platform; rejected/cancel mengembalikan saldo. */
export async function updateWithdrawalStatus(
  tenantId: string,
  withdrawalId: string,
  status: "approved" | "paid" | "rejected",
  actor: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const w = await prisma.$transaction(
      async (tx) => {
        const row = await tx.salesWithdrawal.findFirst({ where: { id: withdrawalId, tenantId } });
        if (!row) throw new Error("tidak_ditemukan");
        if (!["pending", "approved"].includes(row.status)) throw new Error("sudah_diproses");
        await tx.salesWithdrawal.update({ where: { id: row.id }, data: { status } });
        if (status === "rejected") {
          await tx.salesWallet.update({
            where: { tenantId },
            data: { balance: { increment: row.amount } },
          });
          await tx.salesWalletTx.create({
            data: { tenantId, kind: "refund", amount: row.amount, note: `Pengembalian penarikan ${row.id}` },
          });
        }
        return row;
      },
      { isolationLevel: "Serializable" }
    );
    await writeAudit(tenantId, actor, "sales.withdraw_status", { id: w.id, status, amount: w.amount });
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && ["tidak_ditemukan", "sudah_diproses"].includes(e.message)) {
      return { ok: false, error: e.message };
    }
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2034") {
      return { ok: false, error: "coba_lagi" };
    }
    throw e;
  }
}

/** Daftar rekening penarikan tersimpan per tenant (tervalidasi Brick). */
export async function listBankAccounts(tenantId: string) {
  return prisma.salesBankAccount.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
}

/** Simpan rekening baru — WAJIB lolos validasi Brick BAV dulu (akun real). */
export async function saveBankAccount(opts: {
  tenantId: string;
  bankShortCode: string;
  bankName: string;
  accountNo: string;
  actor?: string;
}): Promise<{ ok: boolean; error?: string; account?: unknown }> {
  const bankShortCode = opts.bankShortCode.trim().toUpperCase();
  const accountNo = opts.accountNo.replace(/\D/g, "");
  if (!bankShortCode || !accountNo) return { ok: false, error: "data_belum_lengkap" };
  const dup = await prisma.salesBankAccount.findFirst({
    where: { tenantId: opts.tenantId, bankShortCode, accountNo },
  });
  if (dup) return { ok: false, error: "rekening_sudah_ada" };
  let valid: BrickValidation;
  try {
    valid = await brickValidateAccount({ bankShortCode, accountNumber: accountNo });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "gagal_validasi";
    if (msg.startsWith("brick_belum_dikonfigurasi")) return { ok: false, error: "validasi_belum_dikonfigurasi" };
    return { ok: false, error: "validasi_gagal" };
  }
  if (!valid.ok || !valid.accountName) {
    return { ok: false, error: "rekening_tidak_valid" };
  }
  const account = await prisma.salesBankAccount.create({
    data: {
      tenantId: opts.tenantId,
      bankShortCode,
      bankName: (opts.bankName || bankShortCode).slice(0, 80),
      accountNo,
      accountName: valid.accountName.slice(0, 100),
      activityId: valid.activityId ?? "",
    },
  });
  await writeAudit(opts.tenantId, opts.actor ?? "system", "sales.bank_account_add", {
    id: account.id,
    bank: bankShortCode,
    accountNo,
    accountName: valid.accountName,
  });
  return { ok: true, account };
}

/** Hapus rekening penarikan tersimpan. */
export async function deleteBankAccount(tenantId: string, id: string) {
  const acc = await prisma.salesBankAccount.findFirst({ where: { id, tenantId } });
  if (!acc) return { ok: false, error: "tidak_ditemukan" };
  await prisma.salesBankAccount.delete({ where: { id: acc.id } });
  await writeAudit(tenantId, "system", "sales.bank_account_remove", { id: acc.id, bank: acc.bankShortCode });
  return { ok: true };
}

/** Statistik laporan penjualan: total, per bulan, dan daftar pesanan sukses. */
export async function salesReport(tenantId: string) {  const [wallet, daily, bankAccounts] = await Promise.all([
    salesWalletSummary(tenantId),
    prisma.dailyMetric.findMany({ where: { tenantId }, orderBy: { date: "desc" }, take: 90 }),
    listBankAccounts(tenantId),
  ]);
  // pesanan sukses = lunas / sudah difakturkan / selesai (dari ShopOrder JSON)
  const settings = await prisma.appSetting.findMany({
    where: { key: { startsWith: "wa:shop_order:" } },
    select: { value: true },
  });
  const orders: Array<Record<string, unknown>> = [];
  for (const s of settings) {
    try {
      const o = JSON.parse(s.value) as Record<string, unknown>;
      if (o?.tenantId !== tenantId) continue;
      const status = String(o.status ?? "");
      const acc = (o.accurate ?? {}) as Record<string, unknown>;
      const success = status === "paid" || acc.salesInvoice || acc.salesReceipt;
      if (success) orders.push(o);
    } catch {
      // lewati blob tidak valid
    }
  }
  orders.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  const totalSuccess = orders.reduce((s, o) => s + (Number(o.total ?? 0) || 0), 0);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthOrders = orders.filter((o) => String(o.createdAt ?? "").startsWith(thisMonth));
  const monthTotal = monthOrders.reduce((s, o) => s + (Number(o.total ?? 0) || 0), 0);

  return {
    wallet,
    bankAccounts,
    report: {
      totalOrders: orders.length,
      totalAmount: totalSuccess,
      monthOrders: monthOrders.length,
      monthAmount: monthTotal,
      daily: daily.map((d) => ({ date: d.date, salesTotal: d.salesTotal, salesCount: d.salesCount })),
    },
    orders: orders.slice(0, 100),
  };
}

export { getShopOrder };
