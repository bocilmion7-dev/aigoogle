import { readFileSync, writeFileSync } from "node:fs";

const openapi = JSON.parse(readFileSync("docs/spikes/accurate-openapi.json", "utf8"));
const docs = JSON.parse(readFileSync("docs/spikes/accurate-api-docs-modules.json", "utf8"));

// daftar scope resmi (securitySchemes → oauth2 implicit flow) — di luar daftar = invalid_scope
const officialScopes = new Set(
  Object.keys(
    openapi.components?.securitySchemes?.default?.flows?.implicit?.scopes ?? {}
  )
);

const modules = new Map();
const put = (mod, act, method, docsOnly = false) => {
  if (!modules.has(mod)) modules.set(mod, new Map());
  const cur = modules.get(mod).get(act);
  if (!cur) modules.get(mod).set(act, { method, docsOnly });
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
    if (!modules.has(mod) || !modules.get(mod).has(act)) put(mod, act, a.method.toUpperCase(), true);
  }
}

// scope OAuth per aksi: openapi security[0].default → docs-modules scope* → tebakan pola (harus resmi)
const scopeOf = (mod, act) => {
  const p = `/api/${mod}/${act}.do`;
  const spec = openapi.paths[p];
  if (spec) {
    const meth = Object.keys(spec)[0];
    const sec = spec[meth]?.security?.[0]?.default;
    if (Array.isArray(sec) && sec.length) {
      const valid = sec.filter((x) => officialScopes.has(x));
      if (valid.length) return valid;
    }
  }
  const d = docs.accurate.modules?.[mod];
  if (d) {
    const a = d.actions?.find((x) => (x.name || "").replace(/\.do$/, "") === act);
    if (a?.scope && officialScopes.has(a.scope)) return [a.scope];
    if (act === "list" && d.scopeView && officialScopes.has(d.scopeView)) return [d.scopeView];
    if (act === "save" && d.scopeSave && officialScopes.has(d.scopeSave)) return [d.scopeSave];
    if (act === "delete" && d.scopeDelete && officialScopes.has(d.scopeDelete)) return [d.scopeDelete];
  }
  const guess = `${mod.replace(/[-/]/g, "_")}_${act === "list" || act === "detail" ? "view" : act === "delete" ? "delete" : "save"}`;
  return officialScopes.has(guess) ? [guess] : [];
};

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
    .map(([act, entry]) => ({
      action: act,
      method: entry.method,
      tool: `${camel(mod)}.${act}`,
      permission: `accurate:${mod}.${entry.method === "GET" ? "view" : entry.method === "DELETE" ? "delete" : "save"}`,
      scope: scopeOf(mod, act),
      ...(entry.docsOnly ? { docsOnly: true } : {}),
    }))
    .sort((a, b) => a.action.localeCompare(b.action));
  manifest.modules[mod] = acts;
}

// union scope OAuth utk authorizeUrl — hanya scope resmi securitySchemes
// (11 util operation tanpa security: cukup token Bearer, TANPA scope → db_access dilarang utk approve)
const scopeSet = new Set();
for (const acts of Object.values(manifest.modules)) {
  for (const a of acts) for (const x of a.scope) scopeSet.add(x);
}
manifest.oauthScopes = [...scopeSet].sort();

manifest.totals = {
  modules: Object.keys(manifest.modules).length,
  actions: Object.values(manifest.modules).flat().length,
  utils: manifest.utils.length,
  webhookEvents: manifest.webhookEvents.length,
  oauthScopes: manifest.oauthScopes.length,
};
writeFileSync("docs/spikes/accurate-actions-manifest.json", JSON.stringify(manifest, null, 1) + "\n");
console.log(manifest.totals);
