import { createHash } from "node:crypto";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Tambahkan CSP ketat saat build. Hash dihitung untuk semua <script> inline
 * (mis. JSON-LD) sehingga tidak perlu 'unsafe-inline' untuk script.
 * HSTS & frame-ancestors tetap harus dipasang di nginx (meta tidak mendukung).
 */
function cspPlugin(): Plugin {
  return {
    name: "aigoogle-csp",
    apply: "build",
    transformIndexHtml(html) {
      const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
        (m) => `'sha256-${createHash("sha256").update(m[1] ?? "").digest("base64")}'`
      );
      const scriptSrc = ["'self'", ...hashes].join(" ");
      const csp = [
        "default-src 'self'",
        `script-src ${scriptSrc}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-src https://www.facebook.com https://web.facebook.com",
        "worker-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ");
      return html.replace("</head>", `    <meta http-equiv="Content-Security-Policy" content="${csp}" />\n  </head>`);
    },
  };
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  // Preact compat memangkas runtime React dari ~140 KB menjadi belasan KB.
  // API komponen tetap React, jadi halaman tidak perlu diubah.
  resolve: {
    alias: [
      { find: /^react-dom\/client$/, replacement: "preact/compat/client" },
      { find: /^react-dom$/, replacement: "preact/compat" },
      { find: /^react\/jsx-runtime$/, replacement: "preact/jsx-runtime" },
      { find: /^react\/jsx-dev-runtime$/, replacement: "preact/jsx-dev-runtime" },
      { find: /^react$/, replacement: "preact/compat" },
    ],
  },
  server: { port: 5173, proxy: { "/api": "http://localhost:3001" } },
});
