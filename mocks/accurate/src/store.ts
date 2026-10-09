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
export interface SalesEntry { id: string; customerName: string; date: string; total: number; }
export interface MockDb {
  id: string; name: string; alias: string;
  userPrivileges: Record<string, string>;
  privileges: Record<string, PrivilegeRow[]>;
  data: { customers: Customer[]; salesEntries: SalesEntry[] };
}

const ALL_MODULES = ["customer", "sales-entry", "purchase-entry", "account"];
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
      "priv-staff": priv(["sales-entry"], true),
    },
    data: {
      customers: [{ id: "C-001", name: "Budi Santoso" }, { id: "C-002", name: "Siti Aminah" }],
      salesEntries: [{ id: "SJ-001", customerName: "Budi Santoso", date: "2026-10-01", total: 2500000 }],
    },
  },
  "1002": {
    id: "1002", name: "CV Sejahtera", alias: "SIAP",
    userPrivileges: { "user-admin": "priv-admin" },
    privileges: { "priv-admin": priv(ALL_MODULES, true) },
    data: {
      customers: [{ id: "C-101", name: "Toko Bersama" }],
      salesEntries: [{ id: "SJ-101", customerName: "Toko Bersama", date: "2026-10-03", total: 1750000 }],
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
