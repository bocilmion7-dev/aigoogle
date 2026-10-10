import { prisma } from "../db.js";
import { decryptToken } from "../crypto.js";
import { MockDriveClient, type MockSeed } from "./mock-client.js";
import { GoogleDriveClient } from "./google-client.js";
import type { DriveClient } from "./types.js";

let mockSeed: MockSeed = {
  folders: [{ id: "root", name: "Drive Saya", parents: "" }],
  files: [],
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
