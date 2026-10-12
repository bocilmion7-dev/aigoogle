import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp as createMockApp } from "@mock/accurate";
import { AccurateAdapter } from "../src/providers/accounting/accurate.js";
import { ACCURATE_CATALOG } from "../src/providers/accounting/catalog.js";
import { ACTION_ROUTES } from "../src/providers/accounting/accurate-paths.js";
import type { ProviderCtx } from "../src/providers/accounting/types.js";

let server: Server;
let adapter: AccurateAdapter;
let adminCtx: ProviderCtx;

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
  const port = (server.address() as { port: number }).port;
  adapter = new AccurateAdapter({ clientId: "c", clientSecret: "s", apiBase: `http://127.0.0.1:${port}` });
  adminCtx = await loginCtx("admin", "1001");
});
afterAll(() => {
  server.closeAllConnections();
  return new Promise((r) => server.close(r));
});

const modulOf = (path: string) => {
  const m = path.match(/^\/accurate\/api\/(.+)\/[^/]+\.do$/);
  if (!m) throw new Error(`path tak dikenal: ${path}`);
  return m[1];
};

describe("execute semua aksi Accurate vs mock", () => {
  it("366 tool semuanya ter-execute tanpa error", async () => {
    expect(ACCURATE_CATALOG).toHaveLength(366);
    // pre-pass: id pertama tiap modul (diambil sebelum delete menghapus apa pun)
    const firstId = new Map<string, string>();
    const idOf = async (path: string, prefix: string): Promise<string> => {
      const mod = modulOf(path);
      if (firstId.has(mod)) return firstId.get(mod)!;
      try {
        const rows = (await adapter.execute(`${prefix}.list`, {}, adminCtx)) as Array<{ id?: string }>;
        firstId.set(mod, rows[0]?.id ?? "");
      } catch {
        firstId.set(mod, "");
      }
      return firstId.get(mod)!;
    };
    const failures: string[] = [];
    const run = async (tool: string, args: Record<string, unknown>) => {
      try {
        await adapter.execute(tool, args, adminCtx);
      } catch (e) {
        failures.push(`${tool}: ${e instanceof Error ? e.message : e}`);
      }
    };
    // urutan aman: baca dulu (list/detail/khusus), baru tulis (save), baru delete
    const order = { read: 0, write: 1, del: 2 } as const;
    const plan: { tool: string; args: Record<string, unknown>; phase: number }[] = [];
    for (const t of ACCURATE_CATALOG) {
      const route = ACTION_ROUTES[t.name];
      expect(route, t.name).toBeTruthy();
      const prefix = t.name.split(".")[0];
      if (route.method === "DELETE") {
        plan.push({ tool: t.name, args: { id: await idOf(route.path, prefix) }, phase: order.del });
      } else if (t.name.endsWith(".detail")) {
        plan.push({ tool: t.name, args: { id: await idOf(route.path, prefix) }, phase: order.read });
      } else if (route.method === "POST") {
        plan.push({ tool: t.name, args: { name: "Uji Cakupan" }, phase: order.write });
      } else {
        plan.push({ tool: t.name, args: {}, phase: order.read });
      }
    }
    for (const step of plan.sort((a, b) => a.phase - b.phase)) {
      await run(step.tool, step.args);
    }
    expect(failures).toEqual([]);
  });
});
