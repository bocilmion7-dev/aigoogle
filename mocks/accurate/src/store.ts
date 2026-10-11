import { randomUUID } from "node:crypto";

export interface PrivilegeRow {
  ModuleName: string;
  AllowView: boolean;
  AllowCreate: boolean;
  AllowUpdate: boolean;
  AllowDelete: boolean;
}
export interface MockUser { id: string; email: string; name: string; }
export interface Customer { id: string; name: string; }
export interface SalesInvoice { id: string; no: string; customerName: string; date: string; total: number; status: string; }
export interface Item { id: string; code: string; name: string; unit: string; sellingPrice: number; }
export interface Vendor { id: string; code: string; name: string; }
export interface GlAccount { id: string; code: string; name: string; type: "Asset" | "Liability" | "Equity" | "Revenue" | "Expense"; }
export interface SalesOrder { id: string; no: string; customerName: string; date: string; total: number; status: string; }
export interface SalesReceipt { id: string; no: string; customerName: string; date: string; amount: number; }
export interface PurchaseInvoice { id: string; no: string; vendorName: string; date: string; total: number; status: string; }
export interface MockDb {
  id: string; name: string; alias: string;
  userPrivileges: Record<string, string>;
  privileges: Record<string, PrivilegeRow[]>;
  data: {
    customers: Customer[];
    salesInvoices: SalesInvoice[];
    items: Item[];
    vendors: Vendor[];
    glAccounts: GlAccount[];
    salesOrders: SalesOrder[];
    salesReceipts: SalesReceipt[];
    purchaseInvoices: PurchaseInvoice[];
  };
}

const ALL_MODULES = [
  "customer", "sales-invoice", "purchase-invoice", "glaccount",
  "item", "vendor", "sales-order", "sales-receipt",
];
const priv = (mods: string[], allow: boolean): PrivilegeRow[] =>
  ALL_MODULES.map((m) => ({
    ModuleName: m, AllowView: allow && mods.includes(m),
    AllowCreate: false, AllowUpdate: false, AllowDelete: false,
  }));

const dbs: Record<string, MockDb> = {
  "1001": {
    id: "1001", name: "PT Maju Jaya", alias: "MAJU",
    userPrivileges: { "user-admin": "priv-admin", "user-staff": "priv-staff" },
    privileges: {
      "priv-admin": priv(ALL_MODULES, true),
      "priv-staff": priv(["sales-invoice"], true),
    },
    data: {
      customers: [{ id: "C-001", name: "Budi Santoso" }, { id: "C-002", name: "Siti Aminah" }],
      salesInvoices: [
        { id: "SI-001", no: "FJ/2026/0001", customerName: "Budi Santoso", date: "2026-10-01", total: 2500000, status: "Posted" },
      ],
      items: [
        { id: "I-01", code: "BRG-001", name: "Kertas A4", unit: "Rim", sellingPrice: 55000 },
        { id: "I-02", code: "BRG-002", name: "Tinta Printer", unit: "Botol", sellingPrice: 120000 },
      ],
      vendors: [
        { id: "V-01", code: "SUP-001", name: "CV Sentosa Mandiri" },
        { id: "V-02", code: "SUP-002", name: "PT Bahan Bangunan" },
      ],
      glAccounts: [
        { id: "G-1000", code: "1000", name: "Kas", type: "Asset" },
        { id: "G-1100", code: "1100", name: "Bank", type: "Asset" },
        { id: "G-4000", code: "4000", name: "Penjualan", type: "Revenue" },
        { id: "G-5000", code: "5000", name: "Harga Pokok Penjualan", type: "Expense" },
      ],
      salesOrders: [
        { id: "SO-001", no: "SJ/2026/0001", customerName: "Budi Santoso", date: "2026-09-28", total: 2500000, status: "Posted" },
      ],
      salesReceipts: [
        { id: "SR-001", no: "PK/2026/0001", customerName: "Budi Santoso", date: "2026-10-02", amount: 2500000 },
      ],
      purchaseInvoices: [
        { id: "PI-001", no: "FB/2026/0001", vendorName: "CV Sentosa Mandiri", date: "2026-10-03", total: 800000, status: "Posted" },
      ],
    },
  },
  "1002": {
    id: "1002", name: "CV Sejahtera", alias: "SIAP",
    userPrivileges: { "user-admin": "priv-admin" },
    privileges: { "priv-admin": priv(ALL_MODULES, true) },
    data: {
      customers: [{ id: "C-101", name: "Toko Bersama" }],
      salesInvoices: [
        { id: "SI-101", no: "FJ/2026/0101", customerName: "Toko Bersama", date: "2026-10-03", total: 1750000, status: "Posted" },
      ],
      items: [
        { id: "I-11", code: "BRG-101", name: "Spanduk", unit: "Lembar", sellingPrice: 85000 },
      ],
      vendors: [
        { id: "V-11", code: "SUP-101", name: "PT Multi Supply" },
      ],
      glAccounts: [
        { id: "G-1000", code: "1000", name: "Kas", type: "Asset" },
        { id: "G-4000", code: "4000", name: "Penjualan", type: "Revenue" },
      ],
      salesOrders: [],
      salesReceipts: [],
      purchaseInvoices: [],
    },
  },
};

const users: Record<string, MockUser> = {
  "user-admin": { id: "user-admin", email: "admin@demo.local", name: "Admin Demo" },
  "user-staff": { id: "user-staff", email: "staff@demo.local", name: "Staff Demo" },
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
