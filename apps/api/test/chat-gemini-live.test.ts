import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { createApp as createMockApp } from "@mock/accurate";
import { prisma } from "../src/db.js";
import { setGeminiForTest } from "../src/ai/gemini-client.js";

const keyOk = (process.env.GEMINI_API_KEY?.length ?? 0) > 10;
let api: ReturnType<typeof createApp>;
let mockSrv: Server;
let cookie = "";
let outage = false;

beforeAll(async () => {
  setGeminiForTest(null); // pakai client ASLI
  mockSrv = createMockApp().listen(0);
  await new Promise((r) => mockSrv.once("listening", r));
  const mockBase = `http://127.0.0.1:${(mockSrv.address() as { port: number }).port}`;
  process.env.MOCK_ACCURATE_URL = mockBase;
  api = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `live-${randomBytes(4).toString("hex")}`, name: "PT Live", alias: "LIVE" },
  });
  const role = await prisma.role.create({ data: { tenantId: tenant.id, key: "admin", name: "Admin" } });
  await prisma.rolePermission.createMany({
    data: ["accurate:customer.view", "accurate:sales-entry.view"].map((permissionKey) => ({ roleId: role.id, permissionKey })),
  });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, providerUserId: `lu-${randomBytes(4).toString("hex")}`, email: "live@demo.local", name: "Live", roleId: role.id },
  });
  const auth = await fetch(`${mockBase}/oauth/authorize?redirect_uri=${encodeURIComponent("http://x/cb")}&user=admin`, { redirect: "manual" });
  const code = new URL(auth.headers.get("location")!).searchParams.get("code")!;
  const tokRes = await fetch(`${mockBase}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: "http://x/cb", client_id: "c", client_secret: "s" }),
  });
  const tok = (await tokRes.json()) as { access_token: string; refresh_token: string; expires_in: number };
  const open = (await (await fetch(`${mockBase}/api/open-db.do?id=1001`, { headers: { Authorization: `Bearer ${tok.access_token}` } })).json()) as { session: string; host: string };
  const { encryptToken } = await import("../src/crypto.js");
  await prisma.connection.create({
    data: {
      tenantId: tenant.id, provider: "accurate",
      accessTokenEnc: encryptToken(tok.access_token), refreshTokenEnc: encryptToken(tok.refresh_token),
      expiresAt: new Date(Date.now() + tok.expires_in * 1000), host: open.host, session: open.session,
    },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86400_000) } });
  cookie = `sid=${sid}`;
}, 60000);

afterAll(async () => {
  setGeminiForTest(null);
  mockSrv.closeAllConnections();
  await new Promise((r) => mockSrv.close(r));
  await prisma.$disconnect();
});

describe.skipIf(!keyOk)("chat dengan Gemini asli + mock Accurate", () => {
  it("pertanyaan BI 'siapa saja pelanggan saya?' → tool_call customer.list + jawaban menyebut data", async () => {
    let last = "";
    for (let attempt = 0; attempt < 3 && !outage; attempt++) {
      const res = await request(api)
        .post("/api/chat/stream")
        .set("Cookie", cookie)
        .send({ message: "Sebutkan nama pelanggan yang ada di data saya." })
        .buffer(true)
        .parse((r, cb) => {
          let d = "";
          r.on("data", (c) => (d += c));
          r.on("end", () => cb(null, d));
        });
      last = res.body as string;
      if (last.includes('"tool_call"') || last.includes("Budi")) break;
      if (last.includes("tidak tersedia") || last.includes("gangguan")) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (last.includes("tidak tersedia") || last.includes("gangguan") || last === "") {
      outage = true;
      console.warn("Gemini outage/quota — integration test di-skip");
      return;
    }
    expect(last).toContain("customer.list");
    expect(last.toLowerCase()).toContain("budi");
  }, 120000);
});
