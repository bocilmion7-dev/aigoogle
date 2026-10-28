import { onCLS, onINP, onLCP, onTTFB } from "web-vitals";
import { trackVitals, type Vital } from "./telemetry";

/**
 * Core Web Vitals, dimuat setelah halaman sempat idle (bukan di bundle awal).
 * Semua metrik dikumpulkan lalu dikirim SEKALI lewat sendBeacon saat tab
 * disembunyikan/ditutup — menghindari 3–4 ping terpisah di awal muat.
 */
export function initTelemetry(): void {
  const items: Vital[] = [];
  const add = (name: string) => (m: { value: number }) => {
    const existing = items.find((v) => v.name === name);
    if (existing) existing.value = m.value;
    else items.push({ name, value: m.value });
  };

  onCLS(add("CLS"));
  onINP(add("INP"));
  onLCP(add("LCP"));
  onTTFB(add("TTFB"));

  let flushed = false;
  const flush = () => {
    if (flushed || !items.length) return;
    flushed = true;
    trackVitals(items);
  };

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "hidden") flush();
    },
    { once: true }
  );
  window.addEventListener("pagehide", flush, { once: true });
  // Jaring pengaman: tab yang dibiarkan terbuka tetap mengirim metrik awal.
  window.setTimeout(flush, 10_000);
}
