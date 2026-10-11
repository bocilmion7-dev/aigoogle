export interface AppFeature {
  key: string;
  label: string;
}

export const APP_FEATURES: AppFeature[] = [
  { key: "app:users.manage", label: "Kelola User & Role" },
  { key: "app:settings.manage", label: "Pengaturan" },
  { key: "app:drive.tidy", label: "Rapikan Drive (Explore)" },
  { key: "app:chat.history", label: "Riwayat Chat" },
  { key: "app:audit.view", label: "Lihat Log Audit" },
];

export const APP_PERMISSION_PREFIXES = ["app:", "accurate:"] as const;

export function isValidPermissionKey(key: string): boolean {
  return APP_PERMISSION_PREFIXES.some((p) => key.startsWith(p)) && key.length <= 100;
}
