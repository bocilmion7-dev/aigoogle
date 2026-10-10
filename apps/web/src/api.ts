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
