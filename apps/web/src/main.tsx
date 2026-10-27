import "./fonts.css";
import "./base.css";

import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initTelemetry, track } from "./telemetry";

// Tangkap ajakan install lebih awal — event bisa datang sebelum React selesai mount.
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  window.__installPrompt = e as Window["__installPrompt"];
  window.dispatchEvent(new Event("aigoogle:installable"));
});
window.addEventListener("appinstalled", () => {
  window.__installPrompt = null;
  window.dispatchEvent(new Event("aigoogle:installed"));
});

/**
 * Navigasi internal tanpa full page reload.
 * Link biasa (<a href="/...">) tetap dipakai, tapi klik same-origin ditangkap,
 * pushState, lalu App merender halaman baru. Link /api (download/OAuth),
 * target=_blank, download, dan modifier key tetap dibiarkan.
 */
function installSpaNavigation(): void {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const el = event.target as Element | null;
    const anchor = el?.closest?.("a") as HTMLAnchorElement | null;
    if (!anchor) return;
    if (anchor.target && anchor.target !== "_self") return;
    if (anchor.hasAttribute("download") || anchor.dataset.noSpa !== undefined) return;
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#")) return;
    let url: URL;
    try {
      url = new URL(anchor.href, window.location.href);
    } catch {
      return;
    }
    if (url.origin !== window.location.origin) return;
    if (url.pathname.startsWith("/api/")) return;

    const samePath =
      url.pathname === window.location.pathname && url.search === window.location.search;
    // Link hash di halaman yang sama biarkan browser scroll seperti biasa.
    if (samePath && url.hash) return;
    event.preventDefault();
    if (samePath) return;

    window.history.pushState({}, "", url.pathname + url.search + url.hash);
    window.dispatchEvent(new Event("aigoogle:navigate"));
    window.scrollTo(0, 0);
  });
}

installSpaNavigation();
createRoot(document.getElementById("root")!).render(<App />);
initTelemetry();
track("app_open", { path: window.location.pathname });

// PWA: cache shell + aset (API tetap selalu jaringan)
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support opsional — jangan ganggu aplikasi */
    });
  });
}
