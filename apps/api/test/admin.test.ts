import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

let api: ReturnType<typeof createApp>;
let adminCookie = "";
let staffCookie = "";
let adminId = "";
let staffId = "";
let adminRoleId = "";

beforeAll(async () => {
  api = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `adm-${randomBytes(3).toString("hex")}`, name: "PT Admin", alias: "ADM" },
  });
  const adminRole = await prisma.role.create({ data: { tenantId: tenant.id, key: "admin", name: "Administrator" } });
  adminRoleId = adminRole.id;
  await prisma.rolePermission.createMany({
    data: [
      { roleId: adminRole.id, permissionKey: "app:users.manage" },
      { roleId: adminRole.id, permissionKey: "app:audit.view" },
      { roleId: adminRole.id, permissionKey: "accurate:customer.view" },
    ],
  });
  const staffRole = await prisma.role.create({ data: { tenantId: tenant.id, key: "staff", name: "Staff" } });
  await prisma.rolePermission.create({ data: { roleId: staffRole.id, permissionKey: "accurate:customer.view" } });
  const mk = async (role: string, roleId: string) => {
    const u = await prisma.user.create({
      data: { tenantId: tenant.id, providerUserId: `u-${randomBytes(3).toString("hex")}`, email: `${role}@adm.local`, name: role, roleId },
    });
    const sid = randomBytes(32).toString("hex");
    await prisma.session.create({ data: { id: sid, userId: u.id, expiresAt: new Date(Date.now() + 86400_000) } });
    return { id: u.id, cookie: `sid=${sid}` };
  };
  const a = await mk("admin", adminRole.id);
  const s = await mk("staff", staffRole.id);
  adminId = a.id;
  staffId = s.id;
  adminCookie = a.cookie;
  staffCookie = s.cookie;
});
afterAll(() => prisma.$disconnect());

describe("gerbang admin", () => {
  it("tanpa login → 401", async () => {
    const r = await request(api).get("/api/admin/roles");
    expect(r.status).toBe(401);
  });
  it("role tanpa app:users.manage → 403", async () => {
    const r = await request(api).get("/api/admin/roles").set("Cookie", staffCookie);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("tidak_punya_hak");
  });
  it("/api/me memuat permissions", async () => {
    const r = await request(api).get("/api/me").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.permissions).toEqual(expect.arrayContaining(["app:users.manage", "app:audit.view"]));
  });
});

describe("roles & privileges", () => {
  it("GET roles → admin+staff dengan permissions", async () => {
    const r = await request(api).get("/api/admin/roles").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.map((x: { key: string }) => x.key).sort()).toEqual(["admin", "staff"]);
    const a = r.body.find((x: { key: string }) => x.key === "admin");
    expect(a.permissions).toContain("app:users.manage");
  });
  it("GET privileges → modules dari catalog + appFeatures", async () => {
    const r = await request(api).get("/api/admin/privileges").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.modules.map((m: { key: string }) => m.key)).toEqual(
      expect.arrayContaining(["accurate:customer.view", "accurate:sales-invoice.view", "accurate:item.view"])
    );
    expect(r.body.appFeatures.map((f: { key: string }) => f.key)).toContain("app:drive.tidy");
  });
  it("PUT permissions → replace + key sampah ditolak", async () => {
    const bad = await request(api)
      .put(`/api/admin/roles/${adminRoleId}/permissions`)
      .set("Cookie", adminCookie)
      .send({ permissions: ["foo:bar"] });
    expect(bad.status).toBe(400);
    const ok = await request(api)
      .put(`/api/admin/roles/${adminRoleId}/permissions`)
      .set("Cookie", adminCookie)
      .send({ permissions: ["app:users.manage", "app:audit.view"] });
    expect(ok.status).toBe(200);
    const r = await request(api).get("/api/admin/roles").set("Cookie", adminCookie);
    const a = r.body.find((x: { key: string }) => x.key === "admin");
    expect(a.permissions.sort()).toEqual(["app:audit.view", "app:users.manage"]);
    await prisma.rolePermission.create({ data: { roleId: adminRoleId, permissionKey: "accurate:customer.view" } });
  });
});

describe("users & role", () => {
  it("GET users → 2 user dengan roleKey", async () => {
    const r = await request(api).get("/api/admin/users").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);
    expect(r.body.map((u: { roleKey: string }) => u.roleKey).sort()).toEqual(["admin", "staff"]);
  });
  it("ubah role user lain OK; ubah role sendiri → 400", async () => {
    const self = await request(api)
      .put(`/api/admin/users/${adminId}/role`)
      .set("Cookie", adminCookie)
      .send({ roleKey: "staff" });
    expect(self.status).toBe(400);
    expect(self.body.error).toBe("tidak_boleh_ubah_role_sendiri");
    const ok = await request(api)
      .put(`/api/admin/users/${staffId}/role`)
      .set("Cookie", adminCookie)
      .send({ roleKey: "staff" });
    expect(ok.status).toBe(200);
    const rows = await prisma.auditLog.findMany({ where: { action: "user.role.update" } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe("audit log", () => {
  it("gate app:audit.view: staff → 403", async () => {
    const r = await request(api).get("/api/admin/audit").set("Cookie", staffCookie);
    expect(r.status).toBe(403);
  });
  it("GET audit → entri + userEmail", async () => {
    const r = await request(api).get("/api/admin/audit?limit=20").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body[0].userEmail).toBe("admin@adm.local");
    const filtered = await request(api).get("/api/admin/audit?action=role.permissions.update").set("Cookie", adminCookie);
    expect(filtered.body.every((x: { action: string }) => x.action === "role.permissions.update")).toBe(true);
  });
});
