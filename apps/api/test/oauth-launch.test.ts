import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { createApp as createMockApp } from "@mock/accurate";
import { prisma } from "../src/db.js";

let api: ReturnType<typeof createApp>;
let mockSrv: Server;
let mockBase: string;

beforeAll(async () => {
  mockSrv = createMockApp().listen(0);
  await new Promise((r) => mockSrv.once("listening", r));
  mockBase = `http://127.0.0.1:${(mockSrv.address() as { port: number }).port}`;
  process.env.MOCK_ACCURATE_URL = mockBase;
  api = createApp();
});
afterAll(async () => {
  mockSrv.closeAllConnections();
  await new Promise((r) => mockSrv.close(r));
  await prisma.$disconnect();
});

describe("launch & callback", () => {
  it("GET /api/launch → 302 ke authorize mock dengan state", async () => {
    const res = await request(api).get("/api/launch?dbId=1001").redirects(0);
    expect(res.status).toBe(302);
    const u = new URL(res.headers.location);
    expect(u.origin + u.pathname).toBe(`${mockBase}/oauth/authorize`);
    expect(u.searchParams.get("state")).toMatch(/^ls-/);
  });

  it("callback penuh: code → session cookie → /api/me + tenant & connection tersimpan, tanpa duplikasi", async () => {
    const launch = await request(api).get("/api/launch?dbId=1001").redirects(0);
    const state = new URL(launch.headers.location).searchParams.get("state")!;
    const cbUrl = encodeURIComponent("http://localhost:3001/api/oauth/accurate/callback");
    const au = await fetch(`${mockBase}/oauth/authorize?client_id=c&redirect_uri=${cbUrl}&state=${state}&user=admin`, { redirect: "manual" });
    const code = new URL(au.headers.get("location")!).searchParams.get("code")!;
    const cb = await request(api).get(`/api/oauth/accurate/callback?code=${code}&state=${state}`).redirects(0);
    expect(cb.status).toBe(302);
    const setCookie = cb.headers["set-cookie"] as string | string[] | undefined;
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(";") : (setCookie ?? "");
    const sid = /sid=([^;]+)/.exec(cookieStr)?.[1];
    expect(sid).toBeTruthy();
    const me = await request(api).get("/api/me").set("Cookie", `sid=${sid}`);
    expect(me.status).toBe(200);
    expect(me.body.tenant.provider).toBe("accurate");
    const tenant = await prisma.tenant.findFirst({ where: { providerDbId: "1001" } });
    expect(tenant).toBeTruthy();
    const conn = await prisma.connection.findFirst({ where: { tenantId: tenant!.id } });
    expect(conn!.host).toBe(mockBase);
    expect(conn!.session).toMatch(/^sess-/);
    const role = await prisma.role.findFirstOrThrow({ where: { tenantId: tenant!.id, key: "admin" } });
    const perms = await prisma.rolePermission.findMany({ where: { roleId: role.id } });
    expect(perms.map((p) => p.permissionKey)).toEqual(
      expect.arrayContaining(["accurate:customer.view", "accurate:sales-entry.view", "app:settings.manage"])
    );
    expect(await prisma.connection.count({ where: { tenantId: tenant!.id, provider: "accurate" } })).toBe(1);
    const au2 = await fetch(`${mockBase}/oauth/authorize?client_id=c&redirect_uri=${cbUrl}&state=${state}&user=admin`, { redirect: "manual" });
    const code2 = new URL(au2.headers.get("location")!).searchParams.get("code")!;
    await request(api).get(`/api/oauth/accurate/callback?code=${code2}&state=${state}`).redirects(0);
    expect(await prisma.tenant.count({ where: { providerDbId: "1001" } })).toBe(1);
    expect(await prisma.user.count({ where: { email: "admin@demo.local" } })).toBe(1);
  });

  it("state tidak dikenal → redirect error", async () => {
    const res = await request(api).get("/api/oauth/accurate/callback?code=x&state=unknown").redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("error");
  });
});
