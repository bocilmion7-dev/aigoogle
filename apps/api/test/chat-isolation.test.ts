import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

let api: ReturnType<typeof createApp>;
let cookieA = "";
let cookieB = "";
let sessionA = "";

async function mk(prefix: string): Promise<{ cookie: string; tenantId: string }> {
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `${prefix}-${randomBytes(3).toString("hex")}`, name: `PT ${prefix}`, alias: prefix },
  });
  const role = await prisma.role.create({ data: { tenantId: tenant.id, key: "admin", name: "Admin" } });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, providerUserId: `${prefix}-${randomBytes(3).toString("hex")}`, email: `${prefix}@demo.local`, name: prefix, roleId: role.id },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86400_000) } });
  return { cookie: `sid=${sid}`, tenantId: tenant.id };
}

beforeAll(async () => {
  api = createApp();
  const a = await mk("isoA");
  const b = await mk("isoB");
  cookieA = a.cookie;
  cookieB = b.cookie;
  const s = await prisma.chatSession.create({
    data: { tenantId: a.tenantId, userId: (await prisma.user.findFirstOrThrow({ where: { tenantId: a.tenantId } })).id, title: "rahasia A" },
  });
  sessionA = s.id;
  await prisma.chatMessage.create({ data: { sessionId: s.id, role: "ai", content: "JAWABAN RAHASIA A" } });
});
afterAll(() => prisma.$disconnect());

describe("isolasi tenant chat", () => {
  it("sesi milik A terbaca pemiliknya sendiri (200)", async () => {
    const res = await request(api).get(`/api/chat/sessions/${sessionA}/messages`).set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(res.body[0].content).toBe("JAWABAN RAHASIA A");
  });

  it("sesi milik A tidak terbaca oleh B (404)", async () => {
    const res = await request(api).get(`/api/chat/sessions/${sessionA}/messages`).set("Cookie", cookieB);
    expect(res.status).toBe(404);
  });

  it("daftar sesi B tidak memuat sesi A", async () => {
    const res = await request(api).get("/api/chat/sessions").set("Cookie", cookieB);
    expect(res.body.map((s: { id: string }) => s.id)).not.toContain(sessionA);
  });

  it("audit log A tidak terlihat oleh tenant lain (baris terikat tenantId)", async () => {
    const a = await prisma.auditLog.create({
      data: { tenantId: (await prisma.tenant.findFirstOrThrow({ where: { alias: "isoA" } })).id, userId: "u", action: "tool.call", detail: "{}" },
    });
    const leak = await prisma.auditLog.findMany({ where: { id: a.id, NOT: { tenantId: { contains: "isoB" } } } });
    expect(leak).toHaveLength(1);
  });
});
