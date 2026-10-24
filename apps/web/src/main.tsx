import "./ui.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);

// PWA: cache shell + aset (API tetap selalu jaringan)
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support opsional — jangan ganggu aplikasi */
    });
  });
}
