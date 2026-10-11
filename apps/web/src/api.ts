import type { AppSettings, ConnectionInfo, Me } from "@aigoogle/shared";

export async function getMe(): Promise<Me | null> {
  const res = await fetch("/api/me");
  if (!res.ok) return null;
  return res.json();
}

export async function getSettings(): Promise<AppSettings> {
  const res = await fetch("/api/settings");
  if (!res.ok) throw new Error("gagal memuat pengaturan");
  return res.json();
}

export async function putSettings(body: AppSettings): Promise<AppSettings> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("gagal menyimpan pengaturan");
  return res.json();
}

export async function getConnections(): Promise<ConnectionInfo[]> {
  const res = await fetch("/api/connections");
  if (!res.ok) return [];
  return res.json();
}

export interface AdminRole {
  id: string;
  key: string;
  name: string;
  permissions: string[];
}
export interface PrivilegesPayload {
  modules: Array<{ key: string; label: string; mirrorChecked: boolean }>;
  appFeatures: Array<{ key: string; label: string }>;
}
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  roleKey: string;
}
export interface AuditRow {
  id: string;
  action: string;
  userEmail: string;
  detail: string;
  createdAt: string;
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? "gagal");
  }
  return res.json() as Promise<T>;
}

export const getRoles = () => adminFetch<AdminRole[]>("/api/admin/roles");
export const getPrivileges = () => adminFetch<PrivilegesPayload>("/api/admin/privileges");
export const putRolePermissions = (id: string, permissions: string[]) =>
  adminFetch<{ ok: boolean }>(`/api/admin/roles/${id}/permissions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permissions }),
  });
export const getAdminUsers = () => adminFetch<AdminUser[]>("/api/admin/users");
export const putUserRole = (id: string, roleKey: string) =>
  adminFetch<{ ok: boolean }>(`/api/admin/users/${id}/role`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roleKey }),
  });
export const getAuditLogs = (limit = 50) => adminFetch<AuditRow[]>(`/api/admin/audit?limit=${limit}`);
