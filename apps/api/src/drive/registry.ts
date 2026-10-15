import { prisma } from "../db.js";
import { decryptToken, encryptToken } from "../crypto.js";
import { env } from "../env.js";
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

/** Access token Google hanya berlaku ~1 jam; tukar pakai refresh token bila hampir habis. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

async function refreshGoogleAccessToken(
  tenantId: string,
  refreshTokenEnc: string
): Promise<string | null> {
  const refreshToken = decryptToken(refreshTokenEnc);
  if (!refreshToken || !env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const tok = (await res.json()) as { access_token: string; expires_in?: number };
  if (!tok.access_token) return null;
  await prisma.connection.update({
    where: { tenantId_provider: { tenantId, provider: "google" } },
    data: {
      accessTokenEnc: encryptToken(tok.access_token),
      expiresAt: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000),
    },
  });
  return tok.access_token;
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
  let token = decryptToken(conn.accessTokenEnc);
  if (!conn.expiresAt || conn.expiresAt.getTime() <= Date.now() + EXPIRY_MARGIN_MS) {
    const fresh = await refreshGoogleAccessToken(tenantId, conn.refreshTokenEnc);
    if (!fresh) return null; // refresh gagal → pengguna perlu menghubungkan ulang
    token = fresh;
  }
  return new GoogleDriveClient(token);
}

export const engineMode = () => (process.env.MOCK_DRIVE === "1" ? "mock" : "google");
