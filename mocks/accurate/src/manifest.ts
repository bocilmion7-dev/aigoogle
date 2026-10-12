import { readFileSync } from "node:fs";

export interface MockAction {
  action: string;
  method: "GET" | "POST" | "DELETE";
  tool: string;
  permission: string;
}

const manifest = JSON.parse(
  readFileSync(new URL("../../../docs/spikes/accurate-actions-manifest.json", import.meta.url), "utf8")
) as {
  modules: Record<string, MockAction[]>;
  utils: string[];
  webhookEvents: string[];
};

export const ACCURATE_MODULES = manifest.modules;
export const ACCURATE_UTILS = manifest.utils;
export const ACCURATE_WEBHOOK_EVENTS = manifest.webhookEvents;
