import "./ui.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";

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

createRoot(document.getElementById("root")!).render(<App />);

// PWA: cache shell + aset (API tetap selalu jaringan)
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support opsional — jangan ganggu aplikasi */
    });
  });
}
