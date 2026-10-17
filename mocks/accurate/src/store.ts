import { randomUUID } from "node:crypto";
import { ACCURATE_MODULES } from "./manifest.js";

export interface PrivilegeRow {
  ModuleName: string;
  AllowView: boolean;
  AllowCreate: boolean;
  AllowUpdate: boolean;
  AllowDelete: boolean;
}
export interface MockUser { id: string; email: string; name: string; phone?: string; }
export type Row = Record<string, unknown>;
export interface MockDb {
  id: string; name: string; alias: string;
  userPrivileges: Record<string, string>;
  privileges: Record<string, PrivilegeRow[]>;
  /** data per modul manifest ("customer", "sales-invoice", "pos/transaction", …) */
  data: Record<string, Row[]>;
}

export const ALL_MODULES = Object.keys(ACCURATE_MODULES);

/**
 * Mock menyimpan row dengan NAMA KOLOM yang sama seperti API Accurate ASLI
 * (customer:{name}, totalAmount, transDate, …). Body yang dikirim aplikasi memakai
 * istilah lama (customerName/total/date) → dinormalisasi supaya konsisten dgn bentuk
 * yang dibaca daftar & agregasi (lihat DEFAULT_LIST_FIELDS di apps/api).
 */
export function normalizeRow(body: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = { ...body };
  if (typeof row.customerName === "string" && !row.customer) row.customer = { name: row.customerName };
  if (typeof row.vendorName === "string" && !row.vendor) row.vendor = { name: row.vendorName };
  if (row.total !== undefined && row.totalAmount === undefined) row.totalAmount = row.total;
  if (row.date !== undefined && row.transDate === undefined) row.transDate = row.date;
  return row;
}

const priv = (mods: string[], allow: boolean): PrivilegeRow[] =>
  ALL_MODULES.map((m) => ({
    ModuleName: m,
    AllowView: allow && mods.includes(m),
    AllowCreate: allow && mods.includes(m),
    AllowUpdate: allow && mods.includes(m),
    AllowDelete: allow && mods.includes(m),
  }));

const genericRows = (): Record<string, Row[]> =>
  Object.fromEntries(
    ALL_MODULES.map((m) => {
      const p = m.replace(/[^a-zA-Z]/g, "").slice(0, 3).toUpperCase();
      return [m, [{ id: `${p}-001`, name: `Contoh ${m}` }]];
    })
  );

const dbs: Record<string, MockDb> = {
  "1001": {
    id: "1001", name: "PT Maju Jaya", alias: "MAJU",
    userPrivileges: { "user-admin": "priv-admin", "user-staff": "priv-staff" },
    privileges: {
      "priv-admin": priv(ALL_MODULES, true),
      "priv-staff": priv(["sales-invoice"], true),
    },
    data: {
      ...genericRows(),
      customer: [
        { id: "C-001", customerNo: "CSBY-0001", name: "Budi Santoso", email: "budi@demo.local", mobilePhone: null },
        { id: "C-002", customerNo: "CSBY-0002", name: "Siti Aminah", email: "siti@demo.local", mobilePhone: null },
      ],
      "sales-invoice": [
        {
          id: "SI-001", number: "SI.2026.10.00001", transDate: "01/10/2026", dueDate: "01/11/2026",
          totalAmount: 2500000, approvalStatus: "APPROVED", customerNo: "CSBY-0001",
          customer: { id: "C-001", customerNo: "CSBY-0001", name: "Budi Santoso" }, description: null,
        },
      ],
      item: [
        { id: "I-01", no: "BRG-001", name: "Kertas A4", quantity: 100 },
        { id: "I-02", no: "BRG-002", name: "Tinta Printer", quantity: 50 },
      ],
      vendor: [
        { id: "V-01", vendorNo: "VJKT-0001", name: "CV Sentosa Mandiri", email: null, mobilePhone: null, balance: 0 },
        { id: "V-02", vendorNo: "VJKT-0002", name: "PT Bahan Bangunan", email: null, mobilePhone: null, balance: 0 },
      ],
      glaccount: [
        { id: "G-1000", no: "1000", name: "Kas", accountType: "CASH_BANK", balance: 100000 },
        { id: "G-1100", no: "1100", name: "Bank", accountType: "CASH_BANK", balance: 500000 },
        { id: "G-4000", no: "4000", name: "Penjualan", accountType: "REVENUE", balance: 0 },
        { id: "G-5000", no: "5000", name: "Harga Pokok Penjualan", accountType: "EXPENSE", balance: 0 },
      ],
      "sales-order": [
        {
          id: "SO-001", number: "SO.2026.09.00001", transDate: "28/09/2026", totalAmount: 2500000,
          status: "OPEN", approvalStatus: "APPROVED", customerNo: "CSBY-0001",
          customer: { id: "C-001", customerNo: "CSBY-0001", name: "Budi Santoso" },
        },
      ],
      "sales-receipt": [
        {
          id: "SR-001", number: "111.102-01.2026.10.00002", transDate: "02/10/2026",
          approvalStatus: "APPROVED", customerNo: "CSBY-0001",
          customer: { id: "C-001", customerNo: "CSBY-0001", name: "Budi Santoso" }, description: null,
        },
      ],
      "purchase-invoice": [
        {
          id: "PI-001", number: "PI.2026.10.00001", transDate: "03/10/2026", dueDate: "03/11/2026",
          totalAmount: 800000, approvalStatus: "APPROVED",
          vendor: { id: "V-01", vendorNo: "VJKT-0001", name: "CV Sentosa Mandiri" }, description: null,
        },
      ],
    },
  },
  "1002": {
    id: "1002", name: "CV Sejahtera", alias: "SIAP",
    userPrivileges: { "user-admin": "priv-admin" },
    privileges: { "priv-admin": priv(ALL_MODULES, true) },
    data: {
      ...genericRows(),
      customer: [{ id: "C-101", customerNo: "CSBY-0101", name: "Toko Bersama", email: null, mobilePhone: null }],
      "sales-invoice": [
        {
          id: "SI-101", number: "SI.2026.10.00101", transDate: "03/10/2026", dueDate: "03/11/2026",
          totalAmount: 1750000, approvalStatus: "APPROVED", customerNo: "CSBY-0101",
          customer: { id: "C-101", customerNo: "CSBY-0101", name: "Toko Bersama" }, description: null,
        },
      ],
      item: [
        { id: "I-11", no: "BRG-101", name: "Spanduk", quantity: 20 },
      ],
      vendor: [
        { id: "V-11", vendorNo: "VJKT-0101", name: "PT Multi Supply", email: null, mobilePhone: null, balance: 0 },
      ],
      glaccount: [
        { id: "G-1000", no: "1000", name: "Kas", accountType: "CASH_BANK", balance: 100000 },
        { id: "G-4000", no: "4000", name: "Penjualan", accountType: "REVENUE", balance: 0 },
      ],
      "sales-order": [],
      "sales-receipt": [],
      "purchase-invoice": [],
    },
  },
};

const users: Record<string, MockUser> = {
  "user-admin": { id: "user-admin", email: "admin@demo.local", name: "Admin Demo", phone: "6281234567890" },
  "user-staff": { id: "user-staff", email: "staff@demo.local", name: "Staff Demo", phone: "6289876543210" },
  // dipakai test regresi OAuth — email operator platform (PLATFORM_ADMIN_EMAILS)
  "user-platform": { id: "user-platform", email: "bocilmion7@gmail.com", name: "Platform Operator", phone: "628111111111" },
};

const codes = new Map<string, string>();
const accessTokens = new Map<string, { userId: string; exp: number }>();
const refreshTokens = new Map<string, string>();
const sessions = new Map<string, { dbId: string; userId: string; exp: number }>();
const DAY = 86400;
const HOUR_MS = 3600_000;

export const listDbs = () => Object.values(dbs).map(({ id, name, alias }) => ({ id, name, alias }));
export const getDb = (id: string) => dbs[id] ?? null;
export const listUsers = () => Object.values(users);
export const getUser = (id: string) => users[id] ?? null;

export const issueCode = (userId: string) => {
  const c = `code-${randomUUID()}`;
  codes.set(c, userId);
  return c;
};
export const exchangeCode = (code: string) => {
  const u = codes.get(code) ?? null;
  codes.delete(code);
  return u;
};
export const issueAccess = (userId: string) => {
  const t = `at-${randomUUID()}`;
  accessTokens.set(t, { userId, exp: Date.now() + 15 * DAY * 1000 });
  return t;
};
export const issueRefresh = (userId: string) => {
  const t = `rt-${randomUUID()}`;
  refreshTokens.set(t, userId);
  return t;
};
export const useRefresh = (rt: string) => {
  const u = refreshTokens.get(rt) ?? null;
  refreshTokens.delete(rt);
  return u;
};
export const userFromBearer = (header?: string) => {
  if (!header?.startsWith("Bearer ")) return null;
  const rec = accessTokens.get(header.slice(7));
  if (!rec || rec.exp < Date.now()) return null;
  return rec.userId;
};
export const createSession = (dbId: string, userId: string) => {
  const sid = `sess-${randomUUID()}`;
  sessions.set(sid, { dbId, userId, exp: Date.now() + HOUR_MS });
  return sid;
};
export const resolveSession = (sid: string | undefined) => {
  if (!sid) return null;
  const rec = sessions.get(sid);
  if (!rec || rec.exp < Date.now()) return null;
  return rec;
};
export const privilegeOf = (dbId: string, userId: string, module: string): PrivilegeRow | null =>
  dbs[dbId]?.privileges[dbs[dbId].userPrivileges[userId] ?? ""]?.find((p) => p.ModuleName === module) ?? null;
export const privilegesOf = (dbId: string, userId: string): PrivilegeRow[] =>
  dbs[dbId]?.privileges[dbs[dbId].userPrivileges[userId] ?? ""] ?? [];
export const privilegeGroups = (dbId: string) =>
  Object.entries(dbs[dbId]?.privileges ?? {}).map(([id]) => ({ id, name: id === "priv-admin" ? "Administrator" : "Staff Penjualan" }));
export const isAdminOf = (dbId: string, userId: string) =>
  dbs[dbId]?.userPrivileges[userId] === "priv-admin";
