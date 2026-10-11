import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { hashPassword } from "../src/password.js";

let api: ReturnType<typeof createApp>;
let tenantId = "";
let userId = "";
let cookie = "";

beforeAll(async () => {
  api = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `auth-${randomBytes(3).toString("hex")}`, name: "PT Auth", alias: "AUTH" },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({ data: { tenantId: tenant.id, key: "admin", name: "Admin" } });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      providerUserId: `au-${randomBytes(3).toString("hex")}`,
      email: "auth-demo@demo.local",
      name: "Auth Demo",
      phone: "628111",
      passwordHash: hashPassword("password123"),
      roleId: role.id,
    },
  });
  userId = user.id;
});
afterAll(() => prisma.$disconnect());

describe("auth routes", () => {
  it("login salah password → 401", async () => {
    const res = await request(api).post("/api/auth/login").send({ email: "auth-demo@demo.local", password: "salah" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("email_atau_password_salah");
  });

  it("login benar → cookie sid + audit", async () => {
    const res = await request(api)
      .post("/api/auth/login")
      .send({ email: "auth-demo@demo.local", password: "password123" });
    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"] as string | string[];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(";") : setCookie;
    expect(cookieStr).toContain("sid=");
    cookie = `sid=${cookieStr.match(/sid=([^;]+)/)![1]}`;
    const me = await request(api).get("/api/me").set("Cookie", cookie);
    expect(me.body.email).toBe("auth-demo@demo.local");
    expect(me.body.needsPassword).toBe(false);
  });

  it("set-password tanpa login → 401", async () => {
    expect((await request(api).post("/api/auth/set-password").send({ password: "abc12345" })).status).toBe(401);
  });

  it("set-password lemah → 400", async () => {
    const role = await prisma.role.create({ data: { tenantId, key: "staff", name: "Staff" } });
    const u = await prisma.user.create({
      data: {
        tenantId,
        providerUserId: `au2-${randomBytes(3).toString("hex")}`,
        email: "auth-new@demo.local",
        name: "New",
        roleId: role.id,
      },
    });
    const sid = randomBytes(32).toString("hex");
    await prisma.session.create({ data: { id: sid, userId: u.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const c = `sid=${sid}`;
    expect((await request(api).post("/api/auth/set-password").set("Cookie", c).send({ password: "abc" })).status).toBe(400);
    const ok = await request(api).post("/api/auth/set-password").set("Cookie", c).send({ password: "abc12345" });
    expect(ok.status).toBe(200);
    const me = await request(api).get("/api/me").set("Cookie", c);
    expect(me.body.needsPassword).toBe(false);
    const again = await request(api).post("/api/auth/set-password").set("Cookie", c).send({ password: "xyz12345" });
    expect(again.status).toBe(409);
  });

  it("me tanpa login → 401", async () => {
    expect((await request(api).get("/api/me")).status).toBe(401);
  });

  it("logout hapus session", async () => {
    await request(api).post("/api/logout").set("Cookie", cookie);
    expect((await request(api).get("/api/me").set("Cookie", cookie)).status).toBe(401);
  });
});
