import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

let api: ReturnType<typeof createApp>;
let cookie = "";
let staffCookie = "";
let platCookie = "";

// DB lokal persisten antar-run: backup setelan asli sebelum di-reset, kembalikan setelah test
const SETTING_KEYS = [
  "voiceEngine", "ocrMode", "waProvider", "waD360ApiKey", "waD360BaseUrl",
  "paymentProvider", "winpayEnv", "winpayClientId", "winpayPrivateKey", "winpayPublicKey",
] as const;
let settingBackup: { key: string; value: string }[] = [];

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
  settingBackup = await prisma.appSetting.findMany({ where: { key: { in: [...SETTING_KEYS] } } });
  await prisma.appSetting.deleteMany({ where: { key: { in: [...SETTING_KEYS] } } });
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
  await prisma.appSetting.deleteMany({ where: { key: { in: [...SETTING_KEYS] } } });
  if (settingBackup.length) await prisma.appSetting.createMany({ data: settingBackup });
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
      waD360PartnerId: "",
      waD360PartnerKey: "",
      paymentProvider: "winpay",
      winpayEnv: "production",
      winpayClientId: "3ae34b38-24c6-4fe4-8b26-9deb548020e7",
      winpayPrivateKey: "",
      winpayPublicKey: "",
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
      waD360PartnerId: "",
      waD360PartnerKey: "",
      paymentProvider: "winpay",
      winpayEnv: "production",
      winpayClientId: "3ae34b38-24c6-4fe4-8b26-9deb548020e7",
      winpayPrivateKey: "",
      winpayPublicKey: "",
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

  it("user tanpa settings.manage tak melihat kunci tersembunyi", async () => {
    const r = await request(api).get("/api/settings").set("Cookie", staffCookie);
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty("waD360ApiKey");
    expect(r.body).not.toHaveProperty("winpayPrivateKey");
    expect(r.body.paymentProvider).toBe("winpay");
  });

  it("PUT paymentProvider winpay↔midtrans oleh platform; default kembali winpay", async () => {
    const p1 = await request(api).put("/api/settings").set("Cookie", platCookie).send({ paymentProvider: "midtrans" });
    expect(p1.status).toBe(200);
    expect(p1.body.paymentProvider).toBe("midtrans");
    const g = await request(api).get("/api/settings").set("Cookie", cookie);
    expect(g.body.paymentProvider).toBe("midtrans");
    await request(api).put("/api/settings").set("Cookie", platCookie).send({ paymentProvider: "winpay" });
    const g2 = await request(api).get("/api/settings").set("Cookie", cookie);
    expect(g2.body.paymentProvider).toBe("winpay");
  });

  it("GET /settings dengan sesi platform (psid) saja → 200", async () => {
    const r = await request(api).get("/api/settings").set("Cookie", platCookie);
    expect(r.status).toBe(200);
    expect(r.body.winpayClientId).toBe("3ae34b38-24c6-4fe4-8b26-9deb548020e7");
  });

  it("GET /api/connections → mengandung accurate connected", async () => {
    const res = await request(api).get("/api/connections").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toContainEqual(expect.objectContaining({ provider: "accurate", status: "connected" }));
  });
});
