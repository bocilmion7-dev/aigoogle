import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

let app: ReturnType<typeof createApp>;
let cookie = "";

beforeAll(async () => {
  app = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `t-${randomBytes(4).toString("hex")}`, name: "PT Uji", alias: "UJI" },
  });
  const role = await prisma.role.create({
    data: { tenantId: tenant.id, key: "admin", name: "Admin" },
  });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, providerUserId: `u-${randomBytes(4).toString("hex")}`, email: `uji-${randomBytes(4).toString("hex")}@demo.local`, name: "Uji", roleId: role.id },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86400_000) },
  });
  cookie = `sid=${sid}`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("session & /api/me", () => {
  it("/api/me tanpa cookie → 401", async () => {
    expect((await request(app).get("/api/me")).status).toBe(401);
  });

  it("/api/me dengan cookie valid → profil user + tenant", async () => {
    const res = await request(app).get("/api/me").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      email: expect.stringMatching(/@demo\.local$/),
      roleKey: "admin",
      tenant: { alias: "UJI", provider: "accurate" },
    });
  });

  it("session kedaluwarsa → 401", async () => {
    const expired = randomBytes(32).toString("hex");
    const user = await prisma.user.findFirstOrThrow();
    await prisma.session.create({
      data: { id: expired, userId: user.id, expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await request(app).get("/api/me").set("Cookie", `sid=${expired}`)).status).toBe(401);
  });

  it("POST /api/logout menghapus session; cookie lama jadi 401", async () => {
    const out = await request(app).post("/api/logout").set("Cookie", cookie);
    expect(out.status).toBe(200);
    expect((await request(app).get("/api/me").set("Cookie", cookie)).status).toBe(401);
  });
});
