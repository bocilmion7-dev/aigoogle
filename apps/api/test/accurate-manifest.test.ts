import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ACCURATE_CATALOG } from "../src/providers/accounting/catalog.js";

const manifest = JSON.parse(
  readFileSync(new URL("../../../docs/spikes/accurate-actions-manifest.json", import.meta.url), "utf8")
) as {
  totals: { modules: number; actions: number; utils: number; webhookEvents: number };
  modules: Record<string, Array<{ action: string; method: string; tool: string; permission: string }>>;
  utils: string[];
  webhookEvents: string[];
};

describe("manifest cakupan penuh Accurate", () => {
  it("totals sesuai union docs: 76 modul / 366 aksi / 11 util / 73 event", () => {
    expect(manifest.totals).toEqual({ modules: 76, actions: 366, utils: 11, webhookEvents: 73, oauthScopes: 196 });
  });

  it("tool naming unik & permission format benar", () => {
    const actions = Object.values(manifest.modules).flat();
    const tools = actions.map((a) => a.tool);
    expect(new Set(tools).size).toBe(tools.length);
    for (const a of actions) {
      expect(a.permission).toMatch(/^accurate:[a-z0-9/-]+\.(view|save|delete)$/);
    }
  });

  it("catalog = semua aksi manifest (366 tool)", () => {
    const names = ACCURATE_CATALOG.map((t) => t.name).sort();
    const fromManifest = Object.values(manifest.modules)
      .flat()
      .map((a) => a.tool)
      .sort();
    expect(names).toEqual(fromManifest);
  });
});
