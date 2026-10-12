import { readFileSync } from "node:fs";

export interface ActionEntry {
  action: string;
  method: "GET" | "POST" | "DELETE";
  tool: string;
  permission: string;
}

const file = new URL("../../../../../docs/spikes/accurate-actions-manifest.json", import.meta.url);
const manifest = JSON.parse(readFileSync(file, "utf8")) as {
  modules: Record<string, ActionEntry[]>;
  utils: string[];
  webhookEvents: string[];
};

export const ACCURATE_MODULES = manifest.modules;
export const ACCURATE_UTILS = manifest.utils;
export const ACCURATE_WEBHOOK_EVENTS = manifest.webhookEvents;

/** tool → { path, method } utk SEMUA aksi modul */
export const ACTION_ROUTES: Record<string, { path: string; method: "GET" | "POST" | "DELETE" }> = {};
for (const [mod, acts] of Object.entries(ACCURATE_MODULES)) {
  for (const a of acts) {
    ACTION_ROUTES[a.tool] = { path: `/accurate/api/${mod}/${a.action}.do`, method: a.method };
  }
}
