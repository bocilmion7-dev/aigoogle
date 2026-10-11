import { prisma } from "../db.js";
import { decryptToken } from "../crypto.js";
import { MockDriveClient, type MockSeed } from "./mock-client.js";
import { GoogleDriveClient } from "./google-client.js";
import type { DriveClient } from "./types.js";

let mockSeed: MockSeed = {
  folders: [
    { id: "root", name: "Drive Saya", parents: "" },
    { id: "demo-scan", name: "Scan Demo", parents: "root" },
    { id: "demo-scan2", name: "Scan Demo 2", parents: "root" },
  ],
  files: [
    { id: "demo-1", name: "faktur-001.pdf", parents: "demo-scan", mimeType: "application/pdf", text: "Faktur penjualan No 001" },
    { id: "demo-2", name: "kuitansi-sewa.pdf", parents: "demo-scan", mimeType: "application/pdf", text: "Kuitansi pembayaran sewa" },
    { id: "demo-3", name: "surat-jalan-12.pdf", parents: "demo-scan", mimeType: "application/pdf", text: "Surat Jalan pengiriman No 12" },
    { id: "demo-4", name: "nota-55.pdf", parents: "demo-scan2", mimeType: "application/pdf", text: "Nota pembelian No 55" },
  ],
};
let mockInstance: MockDriveClient | null = null;

export function setMockDriveSeed(seed: MockSeed) {
  mockSeed = seed;
  mockInstance = null;
}

export async function driveClientFor(tenantId: string): Promise<DriveClient | null> {
  if (process.env.MOCK_DRIVE === "1") {
    mockInstance ??= new MockDriveClient(mockSeed);
    return mockInstance;
  }
  const conn = await prisma.connection.findUnique({
    where: { tenantId_provider: { tenantId, provider: "google" } },
  });
  if (!conn) return null;
  return new GoogleDriveClient(decryptToken(conn.accessTokenEnc));
}

export const engineMode = () => (process.env.MOCK_DRIVE === "1" ? "mock" : "google");
