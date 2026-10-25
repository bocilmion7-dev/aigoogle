import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { ACCURATE_WEBHOOK_EVENTS } from "../src/providers/accounting/accurate-paths.js";

let api: ReturnType<typeof createApp>;
let adminCookie = "";
let tenantId = "";
const WEBHOOK_KEY = process.env.ACCURATE_WEBHOOK_APP_KEY ?? "";
const whHeaders = WEBHOOK_KEY ? { "x-app-key": WEBHOOK_KEY } : {};

beforeAll(async () => {
  api = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `wh-${randomBytes(3).toString("hex")}`, name: "PT Webhook", alias: "WH" },
  });
  tenantId = tenant.id;
  await prisma.accurateWebhookEvent.deleteMany({ where: { tenantId } });
  const role = await prisma.role.create({ data: { tenantId: tenant.id, key: "admin", name: "Administrator" } });
  await prisma.rolePermission.create({
    data: { roleId: role.id, permissionKey: "app:audit.view" },
  });
  const u = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      providerUserId: `u-${randomBytes(3).toString("hex")}`,
      email: `wh-${randomBytes(3).toString("hex")}@adm.local`,
      name: "admin",
      roleId: role.id,
    },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: u.id, expiresAt: new Date(Date.now() + 86400_000) } });
  adminCookie = `sid=${sid}`;
});
afterAll(() => prisma.$disconnect());

describe("webhook Accurate (73 event)", () => {
  it("daftar manifest = 73 event", () => {
    expect(ACCURATE_WEBHOOK_EVENTS).toHaveLength(73);
    expect(new Set(ACCURATE_WEBHOOK_EVENTS).size).toBe(73);
  });

  it("menyimpan ke-73 event tipe akurat (publik, tanpa cookie)", async () => {
    for (const event of ACCURATE_WEBHOOK_EVENTS) {
      const res = await request(api)
        .post("/api/integrations/accurate/webhook")
        .set(whHeaders)
        .send({ event, tenantId, data: { id: "1", sample: event } });
      expect(res.status, `${event}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.ok).toBe(true);
    }
    const list = await request(api)
      .get("/api/integrations/accurate/webhook-events?take=500")
      .set("Cookie", adminCookie);
    expect(list.status).toBe(200);
    expect(list.body.d).toHaveLength(73);
    const events = new Set(list.body.d.map((r: { event: string }) => r.event));
    expect(events.size).toBe(73);
  });

  it("tanpa App Key ditolak (401) bila key dikonfigurasi", async () => {
    if (!WEBHOOK_KEY) return;
    const res = await request(api)
      .post("/api/integrations/accurate/webhook")
      .send({ event: ACCURATE_WEBHOOK_EVENTS[0], tenantId });
    expect(res.status).toBe(401);
  });

  it("tolak event tak dikenal (400)", async () => {
    const res = await request(api)
      .post("/api/integrations/accurate/webhook")
      .set(whHeaders)
      .send({ event: "bukan.event", tenantId });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("event_tidak_dikenal");
  });

  it("filter ?event= hanya mengembalikan event tsb", async () => {
    const sample = ACCURATE_WEBHOOK_EVENTS[0];
    const list = await request(api)
      .get(`/api/integrations/accurate/webhook-events?event=${encodeURIComponent(sample)}`)
      .set("Cookie", adminCookie);
    expect(list.status).toBe(200);
    expect(list.body.d.length).toBeGreaterThan(0);
    expect(list.body.d.every((r: { event: string }) => r.event === sample)).toBe(true);
  });

  it("list tanpa login → 401; staff tanpa permission → 403", async () => {
    const anon = await request(api).get("/api/integrations/accurate/webhook-events");
    expect(anon.status).toBe(401);
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { roles: { include: { users: true } } },
    });
    const staffRole = await prisma.role.create({
      data: { tenantId: tenantId, key: "staff", name: "Staff" },
    });
    const su = await prisma.user.create({
      data: {
        tenantId,
        providerUserId: `u-${randomBytes(3).toString("hex")}`,
        email: `s-${randomBytes(3).toString("hex")}@adm.local`,
        name: "staff",
        roleId: staffRole.id,
      },
    });
    const sid = randomBytes(32).toString("hex");
    await prisma.session.create({ data: { id: sid, userId: su.id, expiresAt: new Date(Date.now() + 86400_000) } });
    const staff = await request(api)
      .get("/api/integrations/accurate/webhook-events")
      .set("Cookie", `sid=${sid}`);
    expect(staff.status).toBe(403);
    void tenant;
  });
});
