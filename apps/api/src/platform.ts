import { prisma } from "./db.js";

/** Tenant internal khusus operator platform — BUKAN perusahaan pelanggan.
 *  Admin Platform mengurus sistem ini dan tidak menumpang tenant Accurate mana pun:
 *  identitasnya disimpan di tenant "platform" yang terpisah, tanpa koneksi Accurate. */
export async function platformTenant() {
  return prisma.tenant.upsert({
    where: { provider_providerDbId: { provider: "platform", providerDbId: "internal" } },
    create: { provider: "platform", providerDbId: "internal", name: "AIGoogle Platform", alias: "PLATFORM" },
    update: {},
  });
}
