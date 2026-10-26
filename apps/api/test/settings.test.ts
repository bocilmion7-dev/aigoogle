import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { env } from "../src/env.js";
import { DEFAULT_AI_SIGNUP_BONUS_TOKENS, DEFAULT_AI_SUB_PLANS, DEFAULT_AI_TOPUP_PACKAGES, DEFAULT_WA_META_TOPUPS, DEFAULT_WA_SUB_PLANS } from "@aigoogle/shared";

let api: ReturnType<typeof createApp>;
let cookie = "";
let staffCookie = "";
let platCookie = "";

// DB lokal persisten antar-run: backup setelan asli sebelum di-reset, kembalikan setelah test
const SETTING_KEYS = [
  "voiceEngine", "ocrMode", "waProvider", "waSubPlans", "waMetaTopups", "aiTopupPackages", "aiSubPlans", "aiSignupBonusTokens",
] as const;
let settingBackup: { key: string; value: string }[] = [];

// `env` di-snapshot saat import. Bila mesin developer mengisi WASERVER_* di .env,
// hasil GET ikut berubah dan assertion hardcode "false" jadi gagal. Pin dulu ke
// "belum dikonfigurasi" supaya suite deterministik di mesin mana pun.
const waserverBackup = { url: env.WASERVER_URL, key: env.WASERVER_API_KEY };

beforeAll(async () => {
  env.WASERVER_URL = "";
  env.WASERVER_API_KEY = "";
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
  env.WASERVER_URL = waserverBackup.url;
  env.WASERVER_API_KEY = waserverBackup.key;
  await prisma.appSetting.deleteMany({ where: { key: { in: [...SETTING_KEYS] } } });
  if (settingBackup.length) await prisma.appSetting.createMany({ data: settingBackup });
  await prisma.$disconnect();
});

describe("settings & connections", () => {
  it("GET /api/settings tanpa login → 401", async () => {
    expect((await request(api).get("/api/settings")).status).toBe(401);
  });

  it("GET default voiceEngine = web-speech; PUT mengubah; GET ulang konsisten", async () => {
    const g1 = await request(api).get("/api/settings").set("Cookie", platCookie);
    expect(g1.body).toEqual({
      voiceEngine: "web-speech",
      ocrMode: "vision",
      waPricePerCredit: 200,
      waSubPlans: DEFAULT_WA_SUB_PLANS,
      waMetaTopups: DEFAULT_WA_META_TOPUPS,
      aiTopupPackages: DEFAULT_AI_TOPUP_PACKAGES,
      aiSubPlans: DEFAULT_AI_SUB_PLANS,
      aiSignupBonusTokens: DEFAULT_AI_SIGNUP_BONUS_TOKENS,
      waProvider: "waserver",
      waserverReady: false,
    });
    const put = await request(api).put("/api/settings").set("Cookie", platCookie).send({ voiceEngine: "edge" });
    expect(put.status).toBe(200);
    const g2 = await request(api).get("/api/settings").set("Cookie", platCookie);
    expect(g2.body.voiceEngine).toBe("edge");
    const putOcr = await request(api).put("/api/settings").set("Cookie", platCookie).send({ ocrMode: "text" });
    expect(putOcr.status).toBe(200);
    const putPrice = await request(api).put("/api/settings").set("Cookie", platCookie).send({ waPricePerCredit: 350 });
    expect(putPrice.status).toBe(200);
    expect(putPrice.body.waPricePerCredit).toBe(350);
    const g3 = await request(api).get("/api/settings").set("Cookie", platCookie);
    expect(g3.body).toEqual({
      voiceEngine: "edge",
      ocrMode: "text",
      waPricePerCredit: 350,
      waSubPlans: DEFAULT_WA_SUB_PLANS,
      waMetaTopups: DEFAULT_WA_META_TOPUPS,
      aiTopupPackages: DEFAULT_AI_TOPUP_PACKAGES,
      aiSubPlans: DEFAULT_AI_SUB_PLANS,
      aiSignupBonusTokens: DEFAULT_AI_SIGNUP_BONUS_TOKENS,
      waProvider: "waserver",
      waserverReady: false,
    });
    await request(api).put("/api/settings").set("Cookie", platCookie).send({ ocrMode: "vision", waPricePerCredit: 200 });
  });

  it("PUT waSubPlans (3 paket) oleh platform → tersimpan & terbaca", async () => {
    const custom = [
      { id: "p1", name: "1 Bulan", months: 1, price: 25000 },
      { id: "p2", name: "3 Bulan", months: 3, price: 65000 },
      { id: "p3", name: "6 Bulan", months: 6, price: 120000 },
    ];
    const put = await request(api).put("/api/settings").set("Cookie", platCookie).send({ waSubPlans: custom });
    expect(put.status).toBe(200);
    expect(put.body.waSubPlans).toEqual(custom);
    const g = await request(api).get("/api/settings").set("Cookie", cookie);
    expect(g.body.waSubPlans).toEqual(custom);
    const customTopups = [
      { id: "t1", label: "10 Ribu", amount: 10000 },
      { id: "t2", label: "30 Ribu", amount: 30000 },
      { id: "t3", label: "75 Ribu", amount: 75000 },
    ];
    const putTopups = await request(api).put("/api/settings").set("Cookie", platCookie).send({ waMetaTopups: customTopups });
    expect(putTopups.status).toBe(200);
    expect(putTopups.body.waMetaTopups).toEqual(customTopups);
    const customAi = [
      { id: "a1", price: 10000, tokens: 20000000 },
      { id: "a2", price: 20000, tokens: 45000000 },
    ];
    const putAi = await request(api).put("/api/settings").set("Cookie", platCookie).send({ aiTopupPackages: customAi });
    expect(putAi.status).toBe(200);
    expect(putAi.body.aiTopupPackages).toEqual(customAi);
    await request(api)
      .put("/api/settings")
      .set("Cookie", platCookie)
      .send({
        waSubPlans: DEFAULT_WA_SUB_PLANS,
        waMetaTopups: DEFAULT_WA_META_TOPUPS,
        aiTopupPackages: DEFAULT_AI_TOPUP_PACKAGES,
      });
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
    expect(r.body).not.toHaveProperty("waserverApiKey");
  });

  it("admin perusahaan dengan settings.manage tetap tidak menerima secret platform", async () => {
    const r = await request(api).get("/api/settings").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty("waserverApiKey");
    expect(r.body).not.toHaveProperty("waserverKey");
  });

  it("GET /settings dengan sesi platform (psid) saja → 200", async () => {
    const r = await request(api).get("/api/settings").set("Cookie", platCookie);
    expect(r.status).toBe(200);
    expect(r.body.waProvider).toBeDefined();
  });

  it("GET /api/connections → mengandung accurate connected", async () => {
    const res = await request(api).get("/api/connections").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toContainEqual(expect.objectContaining({ provider: "accurate", status: "connected" }));
  });
});
