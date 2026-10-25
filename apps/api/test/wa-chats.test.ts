import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

let api: ReturnType<typeof createApp>;
let tenantId = "";
let cookie = "";

beforeAll(async () => {
  api = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `wc-${randomBytes(3).toString("hex")}`, name: "PT Chat WA", alias: "CW" },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({ data: { tenantId, key: "admin", name: "Admin" } });
  const user = await prisma.user.create({
    data: {
      tenantId,
      providerUserId: `wcu-${randomBytes(3).toString("hex")}`,
      email: `wc-${randomBytes(3).toString("hex")}@demo.local`,
      name: "Admin Chat",
      roleId: role.id,
    },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86400_000) } });
  cookie = `sid=${sid}`;
  const base = Date.now() - 60_000;
  await prisma.waMessageLog.createMany({
    data: [
      { tenantId, to: "628111", body: "halo", direction: "in", status: "received", createdAt: new Date(base) },
      { tenantId, to: "628111", body: "hai juga", direction: "out", status: "sent", createdAt: new Date(base + 1000) },
      { tenantId, to: "628222", body: "pesan lama", direction: "in", status: "received", createdAt: new Date(base - 1000) },
    ],
  });
});

afterAll(async () => {
  await prisma.waMessageLog.deleteMany({ where: { tenantId } });
  await prisma.session.deleteMany({ where: { user: { tenantId } } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.role.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("riwayat chat WhatsApp", () => {
  it("GET /api/wa/chats → dikelompokkan per nomor + pesan terakhir", async () => {
    const r = await request(api).get("/api/wa/chats").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.map((c: { peer: string }) => c.peer)).toEqual(["628111", "628222"]);
    const first = r.body[0];
    expect(first.lastMessage).toBe("hai juga");
    expect(first.count).toBe(2);
  });

  it("GET /api/wa/chats/:peer/messages → urut kronologis", async () => {
    const r = await request(api).get("/api/wa/chats/628111/messages").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body.map((m: { body: string }) => m.body)).toEqual(["halo", "hai juga"]);
    expect(r.body[1].direction).toBe("out");
  });

  it("tanpa login → 401", async () => {
    expect((await request(api).get("/api/wa/chats")).status).toBe(401);
  });
});
