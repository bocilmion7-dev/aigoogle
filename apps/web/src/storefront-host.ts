/**
 * Subdomain storefront: <slug>.ai-asisten.my.id
 * Base domain bisa dioverride saat build: VITE_STORE_BASE_DOMAIN=...
 */
const configured = String(import.meta.env.VITE_STORE_BASE_DOMAIN ?? "").trim();
export const STOREFRONT_BASE_DOMAIN = (configured || "ai-asisten.my.id").toLowerCase().replace(/^\.+|\.+$/g, "");

const RESERVED = new Set([
  "www", "app", "api", "admin", "auth", "login", "dashboard", "static",
  "assets", "fonts", "mail", "cdn", "kinerjatim", "storefront", "t",
]);

/** Slug dari host subdomain; "" bila host utama/reserved/bukan base domain. */
export function storefrontSlugFromHost(host = window.location.hostname): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!STOREFRONT_BASE_DOMAIN || h === STOREFRONT_BASE_DOMAIN) return "";
  const suffix = `.${STOREFRONT_BASE_DOMAIN}`;
  if (!h.endsWith(suffix)) return "";
  const sub = h.slice(0, -suffix.length);
  if (!sub || sub.includes(".") || RESERVED.has(sub)) return "";
  return sub;
}

/** Base path internal: "" saat di subdomain, "/t/<slug>" saat di domain utama. */
export function storefrontBasePath(slug: string): string {
  return storefrontSlugFromHost() === slug ? "" : `/t/${slug}`;
}
