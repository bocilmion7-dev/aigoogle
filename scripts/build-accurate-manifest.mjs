import { readFileSync, writeFileSync } from "node:fs";

const openapi = JSON.parse(readFileSync("docs/spikes/accurate-openapi.json", "utf8"));
const docs = JSON.parse(readFileSync("docs/spikes/accurate-api-docs-modules.json", "utf8"));

const modules = new Map();
const put = (mod, act, method) => {
  if (!modules.has(mod)) modules.set(mod, new Map());
  modules.get(mod).set(act, method);
};
// openapi diolah dulu: method openapi (spesifikasi HTTP asli) MENANG;
// docs-modules hanya melengkapi aksi yang tidak ada di openapi (putIfAbsent).

for (const [p, v] of Object.entries(openapi.paths)) {
  const m = p.match(/^\/api\/((?:[^/]+\/)?[^/]+)\/([a-z0-9-]+)\.do$/);
  if (!m) continue;
  put(m[1], m[2], Object.keys(v)[0].toUpperCase());
}
for (const [mod, info] of Object.entries(docs.accurate.modules)) {
  for (const a of info.actions) {
    const act = a.name.replace(/\.do$/, "");
    if (!modules.has(mod) || !modules.get(mod).has(act)) put(mod, act, a.method.toUpperCase());
  }
}

const utils = Object.keys(openapi.paths)
  .filter((p) => !/^\/api\/((?:[^/]+\/)?[^/]+)\/([a-z0-9-]+)\.do$/.test(p))
  .map((p) => p.replace("/api/", "").replace(".do", ""))
  .sort();

const camel = (s) =>
  s.replace(/(^|[-/])([a-z])/g, (_, __, c) => c.toUpperCase())
    .replace(/^([A-Z])/, (c) => c.toLowerCase());
const manifest = {
  generatedFrom: ["accurate-openapi.json", "accurate-api-docs-modules.json"],
  modules: {},
  utils,
  webhookEvents: docs.webhookEvents,
};
for (const mod of [...modules.keys()].sort()) {
  const acts = [...modules.get(mod).entries()]
    .map(([act, method]) => ({
      action: act,
      method,
      tool: `${camel(mod)}.${act}`,
      permission: `accurate:${mod}.${method === "GET" ? "view" : method === "DELETE" ? "delete" : "save"}`,
    }))
    .sort((a, b) => a.action.localeCompare(b.action));
  manifest.modules[mod] = acts;
}
manifest.totals = {
  modules: Object.keys(manifest.modules).length,
  actions: Object.values(manifest.modules).flat().length,
  utils: manifest.utils.length,
  webhookEvents: manifest.webhookEvents.length,
};
writeFileSync("docs/spikes/accurate-actions-manifest.json", JSON.stringify(manifest, null, 1) + "\n");
console.log(manifest.totals);
