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
    const d = (await adapter.execute("salesInvoice.list", {}, adminCtx)) as Array<{ totalAmount: number }>;
    expect(d.length).toBeGreaterThan(0);
    expect(typeof d[0].totalAmount).toBe("number");
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

  it("capabilityCatalog → 366 tool cakupan penuh teranotasi permission", () => {
    const cat = adapter.capabilityCatalog();
    expect(cat).toHaveLength(366);
    expect(cat.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "customer.detail", "customer.list", "glaccount.list", "item.list",
        "purchaseInvoice.list", "salesInvoice.detail", "salesInvoice.list",
        "salesOrder.list", "salesReceipt.list", "vendor.list",
      ])
    );
    expect(cat.every((t) => t.requiredPermission.startsWith("accurate:"))).toBe(true);
  });

  it("salesInvoice.list dengan fields+keywords → row terfilter", async () => {
    const d = (await adapter.execute("salesInvoice.list", { fields: "number,totalAmount", keywords: "SI.2026.10.00001" }, adminCtx)) as Array<Record<string, unknown>>;
    expect(d[0]).toEqual({ number: "SI.2026.10.00001", totalAmount: 2500000 });
  });

  it("item.list & glAccount.list admin → ada data", async () => {
    const items = (await adapter.execute("item.list", {}, adminCtx)) as Array<{ name: string }>;
    expect(items.map((i) => i.name)).toContain("Kertas A4");
    const accounts = (await adapter.execute("glaccount.list", {}, adminCtx)) as Array<{ no: string }>;
    expect(accounts.map((a) => a.no)).toContain("1000");
  });

  it("customer.detail id C-001 → Budi Santoso; id salah → throw", async () => {
    const d = (await adapter.execute("customer.detail", { id: "C-001" }, adminCtx)) as Array<{ name: string }>;
    expect(d[0].name).toBe("Budi Santoso");
    await expect(adapter.execute("customer.detail", { id: "XXX" }, adminCtx)).rejects.toThrow();
  });
});
