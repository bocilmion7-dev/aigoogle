import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Validasi URL keluar (LLM provider, webhook, dsb.) agar tidak menjadi SSRF.
 * Menolak loopback/private/link-local/metadata dan host yang resolve ke IP privat.
 * localhost hanya diizinkan di non-production (mis. gateway LLM lokal saat dev).
 */
const BLOCKED_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.google.com",
  "metadata",
  "instance-data",
]);

function isPrivateIp(raw: string): boolean {
  const ip = raw.toLowerCase();
  if (ip.startsWith("::ffff:")) return isPrivateIp(ip.slice(7));
  if (ip === "::" || ip === "::1") return true;
  if (ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;

  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export async function assertSafeOutboundUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("url_tidak_valid");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("url_protocol_tidak_diizinkan");
  if (u.username || u.password) throw new Error("url_kredensial_tidak_diizinkan");

  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new Error("url_host_kosong");

  const local =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "::1";
  if (local) {
    if (process.env.NODE_ENV === "production") throw new Error("url_privat_tidak_diizinkan");
    return u;
  }

  if (BLOCKED_HOSTS.has(host) || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new Error("url_privat_tidak_diizinkan");
  }

  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error("url_privat_tidak_diizinkan");
    return u;
  }

  // Di produksi resolve DNS dan tolak bila salah satu address privat
  // (mitigasi DNS rebinding dasar). Di dev/test hostname contoh seperti
  // `a.example` sengaja tidak resolve, jadi lewati resolusi.
  if (process.env.NODE_ENV === "production") {
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) {
      throw new Error("url_privat_tidak_diizinkan");
    }
  }
  return u;
}

export function normalizeOutboundBaseUrl(u: URL): string {
  return u.toString().replace(/\/+$/, "");
}
