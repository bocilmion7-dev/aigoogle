import { prisma } from "../db.js";

/** Modul AI yang boleh punya model sendiri (global, disimpan di AppSetting). */
export type AiModule = "chat" | "voice" | "drive" | "uploadImage" | "uploadDocument";

export const AI_MODULES: readonly AiModule[] = [
  "chat",
  "voice",
  "drive",
  "uploadImage",
  "uploadDocument",
] as const;

export const AI_MODULE_LABELS: Record<AiModule, string> = {
  chat: "Chat Teks",
  voice: "Chat Suara",
  drive: "Drive / Rapikan",
  uploadImage: "Upload Gambar",
  uploadDocument: "Upload Dokumen",
};

export const AI_MODULE_HINTS: Record<AiModule, string> = {
  chat: "Percakapan teks di Dashboard — model cepat & murah sudah cukup.",
  voice: "Percakapan suara (STT browser → LLM → TTS) — model respon singkat & jelas.",
  drive: "Klasifikasi PDF/gambar saat merapikan Google Drive — butuh model vision.",
  uploadImage: "Scan struk/nota/foto pelanggan — butuh model vision.",
  uploadDocument: "Scan PDF/DOCX pelanggan — teks lokal dulu, vision hanya bila PDF scan.",
};

const key = (m: AiModule) => `aiModel.${m}`;

/** Model pilihan untuk satu modul; "" = otomatis (rank-1 provider aktif + failover). */
export async function getModuleModel(m: AiModule): Promise<string> {
  const row = await prisma.appSetting.findUnique({ where: { key: key(m) } });
  return row?.value ?? "";
}

export async function getAllModuleModels(): Promise<Record<AiModule, string>> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: AI_MODULES.map(key) } },
  });
  const out = {} as Record<AiModule, string>;
  for (const m of AI_MODULES) {
    out[m] = rows.find((r) => r.key === key(m))?.value ?? "";
  }
  return out;
}

export async function setModuleModels(models: Partial<Record<AiModule, string>>): Promise<void> {
  for (const [m, value] of Object.entries(models) as Array<[AiModule, string]>) {
    if (!AI_MODULES.includes(m)) continue;
    await prisma.appSetting.upsert({
      where: { key: key(m) },
      create: { key: key(m), value },
      update: { value },
    });
  }
}
