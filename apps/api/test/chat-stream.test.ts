import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { createApp as createMockApp } from "@mock/accurate";
import { prisma } from "../src/db.js";

let api: ReturnType<typeof createApp>;
let mockSrv: Server;
let mockBase: string;
let cookie = "";
let tenantId = "";

beforeAll(async () => {
  mockSrv = createMockApp().listen(0);
  await new Promise((r) => mockSrv.once("listening", r));
  mockBase = `http://127.0.0.1:${(mockSrv.address() as { port: number }).port}`;
  process.env.MOCK_ACCURATE_URL = mockBase;
  api = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `c-${randomBytes(4).toString("hex")}`, name: "PT Chat", alias: "CHAT" },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({ data: { tenantId: tenant.id, key: "admin", name: "Admin" } });
  await prisma.rolePermission.createMany({
    data: ["accurate:customer.view", "accurate:sales-invoice.view"].map((permissionKey) => ({ roleId: role.id, permissionKey })),
  });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, providerUserId: `cu-${randomBytes(4).toString("hex")}`, email: "chat@demo.local", name: "Chat", roleId: role.id },
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
      expiresAt: new Date(Date.now() + tok.expires_in * 1000),
      host: open.host, session: open.session,
    },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86400_000) } });
  cookie = `sid=${sid}`;
});

afterAll(async () => {
  const { setLLMForTest } = await import("../src/ai/llm-client.js");
  setLLMForTest(null);
  mockSrv.closeAllConnections();
  await new Promise((r) => mockSrv.close(r));
  await prisma.$disconnect();
});

function parseNdjson(body: string): Array<Record<string, unknown>> {
  return body
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("chat stream", () => {
  it("tanpa login → 401", async () => {
    expect((await request(api).post("/api/chat/stream").send({ message: "hi" })).status).toBe(401);
  });

  it("teks polos (fake LLM) → NDJSON start + text_delta + done; pesan tersimpan", async () => {
    const { FakeLLMClient } = await import("../src/ai/fake-llm.js");
    const { setLLMForTest } = await import("../src/ai/llm-client.js");
    setLLMForTest(() => new FakeLLMClient([{ parts: [{ text: "Halo!" }] }]));
    const res = await request(api).post("/api/chat/stream").set("Cookie", cookie).send({ message: "halo" }).buffer(true).parse((r, cb) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => cb(null, d));
    });
    const events = parseNdjson(res.body as string);
    expect(events[0].type).toBe("start");
    // teks di-stream bertahap (throttle) — gabungan semua delta harus utuh
    const deltas = events.filter((e) => e.type === "text_delta").map((e) => String(e.delta));
    expect(deltas.join("")).toBe("Halo!");
    expect(deltas.length).toBeGreaterThan(1);
    expect(events.at(-1)!.type).toBe("done");
    const sess = await prisma.chatSession.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
    expect(sess).toBeTruthy();
    const msgs = await prisma.chatMessage.findMany({ where: { sessionId: sess!.id }, orderBy: { createdAt: "asc" } });
    expect(msgs.map((m) => m.role)).toEqual(["user", "ai"]);
  });

  it("tool call (fake) → event tool_call + baris audit + toolTrace tersimpan", async () => {
    const { FakeLLMClient } = await import("../src/ai/fake-llm.js");
    const { setLLMForTest } = await import("../src/ai/llm-client.js");
    setLLMForTest(
      () =>
        new FakeLLMClient([
          { parts: [{ functionCall: { name: "customer.list", args: {}, id: "c1" } }] },
          { parts: [{ text: "Ada pelanggan Budi." }] },
        ])
    );
    const res = await request(api).post("/api/chat/stream").set("Cookie", cookie).send({ message: "siapa pelanggan saya?" }).buffer(true).parse((r, cb) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => cb(null, d));
    });
    const events = parseNdjson(res.body as string);
    expect(events.some((e) => e.type === "tool_call" && e.tool === "customer.list")).toBe(true);
    expect(events.some((e) => e.type === "tool_result" && e.ok === true)).toBe(true);
    // writeAudit sengaja fire-and-forget (void) → tunggu sebentar sampai baris masuk
    let audit = await prisma.auditLog.findFirst({ where: { tenantId, action: "tool.call" }, orderBy: { createdAt: "desc" } });
    for (let i = 0; i < 20 && !audit; i++) {
      await new Promise((r) => setTimeout(r, 50));
      audit = await prisma.auditLog.findFirst({ where: { tenantId, action: "tool.call" }, orderBy: { createdAt: "desc" } });
    }
    expect(audit).toBeTruthy();
    expect(audit!.detail).toContain("customer.list");
    const sess = await prisma.chatSession.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
    const lastAi = await prisma.chatMessage.findFirst({ where: { sessionId: sess!.id, role: "ai" }, orderBy: { createdAt: "desc" } });
    expect(lastAi!.toolTrace).toContain("customer.list");
  });

  it("GET /api/chat/sessions → daftar sesi tenant sendiri", async () => {
    const res = await request(api).get("/api/chat/sessions").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("GET messages sesi → urutan user/ai", async () => {
    const list = await request(api).get("/api/chat/sessions").set("Cookie", cookie);
    const id = list.body[0].id as string;
    const res = await request(api).get(`/api/chat/sessions/${id}/messages`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
