import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Inline stylesheet entry (base CSS) agar tidak menjadi render-blocking request.
 * CSS lazy per halaman tetap dimuat via chunk seperti biasa.
 */
const dist = join(process.cwd(), "dist");
const indexPath = join(dist, "index.html");
let html = readFileSync(indexPath, "utf8");
const match = html.match(/<link rel="stylesheet" crossorigin href="\/(assets\/index-[^"]+\.css)">/);
if (!match) {
  console.log("[inline-css] tidak ada stylesheet entry — dilewati");
  process.exit(0);
}
const cssPath = join(dist, match[1]);
if (!existsSync(cssPath)) {
  console.log("[inline-css] file tidak ditemukan:", match[1]);
  process.exit(0);
}
const css = readFileSync(cssPath, "utf8");
html = html.replace(match[0], `<style>${css}</style>`);
writeFileSync(indexPath, html);
console.log(`[inline-css] ${match[1]} → inline (${css.length} bytes)`);
