import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp as createMockApp } from "@mock/accurate";
import { AccurateAdapter } from "../src/providers/accounting/accurate.js";

let server: Server;
let base: string;
let adapter: AccurateAdapter;

beforeAll(async () => {
  server = createMockApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  adapter = new AccurateAdapter({
    clientId: "c",
    clientSecret: "s",
    apiBase: base,
  });
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

async function loginMock(user?: string) {
  const url = new URL(adapter.authorizeUrl({ redirectUri: "http://x/cb", state: "s" }));
  if (user) url.searchParams.set("user", user);
  const res = await fetch(url, { redirect: "manual" });
  const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
  return adapter.exchangeCode(code, "http://x/cb");
}

describe("AccurateAdapter against mock", () => {
  it("authorizeUrl menunjuk /oauth/authorize dengan client_id & state", () => {
    const u = new URL(adapter.authorizeUrl({ redirectUri: "http://cb", state: "xyz" }));
    expect(u.pathname).toBe("/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("c");
    expect(u.searchParams.get("state")).toBe("xyz");
  });

  it("exchange → fetchUser (admin) → listDbs (2 db) → openDb", async () => {
    const tok = await loginMock();
    expect(tok.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const user = await adapter.fetchUser(tok.accessToken);
    expect(user).toMatchObject({ email: "admin@demo.local" });
    const dbs = await adapter.listDbs(tok.accessToken);
    expect(dbs.map((d) => d.providerDbId)).toEqual(["1001", "1002"]);
    const open = await adapter.openDb(tok.accessToken, "1001");
    expect(open.session).toMatch(/^sess-/);
    expect(open.host).toBe(base);
  });
});
