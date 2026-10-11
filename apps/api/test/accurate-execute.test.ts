import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp as createMockApp } from "@mock/accurate";
import { AccurateAdapter } from "../src/providers/accounting/accurate.js";
import type { ProviderCtx } from "../src/providers/accounting/types.js";

let server: Server;
let base: string;
let adapter: AccurateAdapter;
let adminCtx: ProviderCtx;
let staffCtx: ProviderCtx;

async function loginCtx(user: string, dbId: string): Promise<ProviderCtx> {
  const url = new URL(adapter.authorizeUrl({ redirectUri: "http://x/cb", state: "s" }));
  url.searchParams.set("user", user);
  const res = await fetch(url, { redirect: "manual" });
  const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
  const tok = await adapter.exchangeCode(code, "http://x/cb");
  const open = await adapter.openDb(tok.accessToken, dbId);
  return { tenantId: `t-${user}`, host: open.host, session: open.session, accessToken: tok.accessToken };
}

beforeAll(async () => {
  server = createMockApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  adapter = new AccurateAdapter({ clientId: "c", clientSecret: "s", apiBase: base });
  adminCtx = await loginCtx("admin", "1001");
  staffCtx = await loginCtx("staff", "1001");
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

describe("AccurateAdapter execute/refresh/privilege", () => {
  it("customer.list admin → data mock PT Maju Jaya", async () => {
    const d = (await adapter.execute("customer.list", {}, adminCtx)) as Array<{ name: string }>;
    expect(d.map((c) => c.name)).toContain("Budi Santoso");
  });

  it("salesInvoice.list admin → ada transaksi total", async () => {
    const d = (await adapter.execute("salesInvoice.list", {}, adminCtx)) as Array<{ total: number }>;
    expect(d.length).toBeGreaterThan(0);
    expect(typeof d[0].total).toBe("number");
  });

  it("staff tanpa hak customer → execute throw (provider gagal)", async () => {
    await expect(adapter.execute("customer.list", {}, staffCtx)).rejects.toThrow();
  });

  it("refreshToken → token baru berbeda", async () => {
    const url = new URL(adapter.authorizeUrl({ redirectUri: "http://x/cb", state: "s" }));
    url.searchParams.set("user", "admin");
    const res = await fetch(url, { redirect: "manual" });
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
    const tok = await adapter.exchangeCode(code, "http://x/cb");
    const refreshed = await adapter.refreshToken(tok.refreshToken);
    expect(refreshed.accessToken).not.toBe(tok.accessToken);
    expect(refreshed.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("privilegeCatalog → kelompok Administrator + Staff Penjualan; admin melihat modul view", async () => {
    const groups = await adapter.privilegeCatalog(adminCtx);
    const admin = groups.find((g) => g.id === "priv-admin")!;
    expect(admin.allowViewModules).toEqual(expect.arrayContaining(["customer", "sales-invoice"]));
  });

  it("capabilityCatalog → 2 tool teranotasi permission", () => {
    const cat = adapter.capabilityCatalog();
    expect(cat.map((t) => t.name).sort()).toEqual(["customer.list", "salesInvoice.list"]);
    expect(cat.every((t) => t.requiredPermission.startsWith("accurate:"))).toBe(true);
  });
});
