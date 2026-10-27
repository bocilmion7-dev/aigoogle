import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireUser } from "../middleware/session.js";
import { loadPermissionSet } from "../permissions.js";
import { createWithdrawal, deleteBankAccount, salesReport, saveBankAccount, updateWithdrawalStatus } from "./wallet.js";

export const salesRouter = Router();

/** Laporan penjualan + wallet penjualan (bukan saldo token AI). */
salesRouter.get(
  "/sales",
  requireUser,
  asyncHandler(async (req, res) => {
    res.json(await salesReport(req.user!.tenant.id));
  })
);

/** Ajukan penarikan hasil penjualan dari wallet. */
salesRouter.post(
  "/sales/withdraw",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        amount: z.number().int().min(0),
        bankAccountId: z.string().max(60).optional(),
        bankName: z.string().max(60).optional(),
        bankNo: z.string().max(40).optional(),
        accountName: z.string().max(100).optional(),
        note: z.string().max(300).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const r = await createWithdrawal({
      tenantId: req.user!.tenant.id,
      actor: req.user!.id,
      ...body.data,
    });
    if (!r.ok) return res.status(400).json({ error: r.error ?? "gagal" });
    res.json(r);
  })
);

/** Simpan rekening penarikan baru — tervalidasi Brick BAV (akun real). */
salesRouter.post(
  "/sales/bank-accounts",
  requireUser,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        bankShortCode: z.string().max(40),
        bankName: z.string().max(80).optional(),
        accountNo: z.string().max(40),
      })
      .safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "bad_request" });
    const r = await saveBankAccount({
      tenantId: req.user!.tenant.id,
      actor: req.user!.id,
      bankShortCode: body.data.bankShortCode,
      bankName: body.data.bankName ?? body.data.bankShortCode,
      accountNo: body.data.accountNo,
    });
    if (!r.ok) return res.status(400).json({ error: r.error ?? "gagal" });
    res.json(r);
  })
);

/** Hapus rekening penarikan tersimpan. */
salesRouter.delete(
  "/sales/bank-accounts/:id",
  requireUser,
  asyncHandler(async (req, res) => {
    const r = await deleteBankAccount(req.user!.tenant.id, String(req.params.id ?? ""));
    if (!r.ok) return res.status(400).json({ error: r.error ?? "gagal" });
    res.json(r);
  })
);

/** Update status penarikan (admin perusahaan). */
salesRouter.post(
  "/sales/withdraw/:id/status",
  requireUser,
  asyncHandler(async (req, res) => {
    const b = z.object({ status: z.enum(["approved", "paid", "rejected"]) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: "bad_request" });
    const perms = await loadPermissionSet(req.user!.roleId);
    if (!perms.has("app:users.manage")) return res.status(403).json({ error: "tidak_punya_hak" });
    const r = await updateWithdrawalStatus(req.user!.tenant.id, String(req.params.id ?? ""), b.data.status, req.user!.id);
    if (!r.ok) return res.status(400).json({ error: r.error ?? "gagal" });
    res.json(r);
  })
);
