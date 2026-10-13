import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

let api: ReturnType<typeof createApp>;
let cookie = "";
let staffCookie = "";
let platCookie = "";

beforeAll(async () => {
  api = createApp();
  // sesi platform (PUT /settings khusus platform — tabel PlatformUser terpisah)
  const pu = await prisma.platformUser.upsert({
    where: { email: "plat-set@demo.local" },
    create: { email: "plat-set@demo.local", name: "Plat Set" },
    update: {},
  });
  const psid = randomBytes(32).toString("hex");
  await prisma.platformSession.create({ data: { id: psid, platformUserId: pu.id, expiresAt: new Date(Date.now() + 86400_000) } });
  platCookie = `psid=${psid}`;
  await prisma.appSetting.deleteMany({
    where: { key: { in: ["voiceEngine", "ocrMode", "waProvider", "waD360ApiKey", "waD360BaseUrl"] } },
  });
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `s-${randomBytes(3).toString("hex")}`, name: "PT Set", alias: "SET" },
  });
  const role = await prisma.role.create({ data: { tenantId: tenant.id, key: "admin", name: "Admin" } });
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionKey: "app:settings.manage" } });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, providerUserId: `su-${randomBytes(3).toString("hex")}`, email: "set@demo.local", name: "Set", roleId: role.id },
  });
  await prisma.connection.create({
    data: {
      tenantId: tenant.id,
      provider: "accurate",
      accessTokenEnc: "x.y.z",
      refreshTokenEnc: "x.y.z",
      expiresAt: new Date(Date.now() + 86400_000),
    },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86400_000) } });
  cookie = `sid=${sid}`;

  const staffRole = await prisma.role.create({ data: { tenantId: tenant.id, key: "staff", name: "Staff" } });
  const staff = await prisma.user.create({
    data: { tenantId: tenant.id, providerUserId: `st-${randomBytes(3).toString("hex")}`, email: "staff-set@demo.local", name: "Staff", roleId: staffRole.id },
  });
  const sid2 = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid2, userId: staff.id, expiresAt: new Date(Date.now() + 86400_000) } });
  staffCookie = `sid=${sid2}`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("settings & connections", () => {
  it("GET /api/settings tanpa login → 401", async () => {
    expect((await request(api).get("/api/settings")).status).toBe(401);
  });

  it("GET default voiceEngine = web-speech; PUT mengubah; GET ulang konsisten", async () => {
    const g1 = await request(api).get("/api/settings").set("Cookie", cookie);
    expect(g1.body).toEqual({
      voiceEngine: "web-speech",
      ocrMode: "vision",
      waPricePerCredit: 200,
      waProvider: "d360",
      waD360ApiKey: "",
      waD360BaseUrl: "https://waba-v2.360dialog.io",
    });
    const put = await request(api).put("/api/settings").set("Cookie", platCookie).send({ voiceEngine: "gemini-native" });
    expect(put.status).toBe(200);
    const g2 = await request(api).get("/api/settings").set("Cookie", cookie);
    expect(g2.body.voiceEngine).toBe("gemini-native");
    const putOcr = await request(api).put("/api/settings").set("Cookie", platCookie).send({ ocrMode: "text" });
    expect(putOcr.status).toBe(200);
    const putPrice = await request(api).put("/api/settings").set("Cookie", platCookie).send({ waPricePerCredit: 350 });
    expect(putPrice.status).toBe(200);
    expect(putPrice.body.waPricePerCredit).toBe(350);
    const g3 = await request(api).get("/api/settings").set("Cookie", cookie);
    expect(g3.body).toEqual({
      voiceEngine: "gemini-native",
      ocrMode: "text",
      waPricePerCredit: 350,
      waProvider: "d360",
      waD360ApiKey: "",
      waD360BaseUrl: "https://waba-v2.360dialog.io",
    });
    await request(api).put("/api/settings").set("Cookie", platCookie).send({ ocrMode: "vision", waPricePerCredit: 200 });
  });

  it("PUT /settings oleh user perusahaan → 401 (khusus platform)", async () => {
    const res = await request(api).put("/api/settings").set("Cookie", staffCookie).send({ ocrMode: "text" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("bukan_platform");
  });

  it("PUT voiceEngine ngawur → 400", async () => {
    const res = await request(api).put("/api/settings").set("Cookie", platCookie).send({ voiceEngine: "asal" });
    expect(res.status).toBe(400);
  });

  it("GET /api/connections → mengandung accurate connected", async () => {
    const res = await request(api).get("/api/connections").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toContainEqual(expect.objectContaining({ provider: "accurate", status: "connected" }));
  });
});
