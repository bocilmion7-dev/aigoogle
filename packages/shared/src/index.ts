export interface Me {
  userId: string;
  id?: string;
  email: string;
  name: string;
  tenant: { id: string; name: string; alias: string; provider: string };
  roleKey: string;
  permissions?: string[];
  needsPassword?: boolean;
}
export interface ConnectionInfo {
  provider: string;
  status: "connected" | "expired" | "none";
  accountLabel?: string;
  expiresAt?: string;
}
export interface AppSettings {
  voiceEngine: "gemini-native" | "web-speech" | "edge";
  ocrMode?: "vision" | "text";
  waPricePerCredit?: number;
  /** penyedia WhatsApp untuk embedded signup perusahaan: d360 (default) | meta */
  waProvider?: "meta" | "d360";
  waD360ApiKey?: string;
  waD360BaseUrl?: string;
  waD360PartnerId?: string;
  waD360PartnerKey?: string;
}
