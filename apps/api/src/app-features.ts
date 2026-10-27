export interface AppFeature {
  key: string;
  label: string;
}

export const APP_FEATURES: AppFeature[] = [
  { key: "app:users.manage", label: "Kelola User & Role" },
  { key: "app:settings.manage", label: "Pengaturan" },
  { key: "app:drive.tidy", label: "Rapikan Drive (Explore)" },
  { key: "app:chat.history", label: "Riwayat Chat" },
  { key: "app:wa.send", label: "Kirim WhatsApp" },
  { key: "app:audit.view", label: "Lihat Log Audit" },
];

/** Permission platform-only — TIDAK boleh diberikan ke role perusahaan. */
export const PLATFORM_ONLY_PERMISSIONS = new Set(["app:settings.manage"]);

/** Fitur yang boleh muncul di editor role perusahaan (tanpa permission platform). */
export const COMPANY_APP_FEATURES = APP_FEATURES.filter((f) => !PLATFORM_ONLY_PERMISSIONS.has(f.key));

export const APP_PERMISSION_PREFIXES = ["app:", "accurate:"] as const;

export function isValidPermissionKey(key: string): boolean {
  return APP_PERMISSION_PREFIXES.some((p) => key.startsWith(p)) && key.length <= 100;
}
