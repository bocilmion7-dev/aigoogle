import { onCLS, onINP, onLCP, onTTFB } from "web-vitals";

type WebVital = { name: string; value: number };

function post(event: string, props?: Record<string, unknown>, webVital?: WebVital): void {
  try {
    const body = JSON.stringify({ event, props, webVital });
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/telemetry", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => null);
  } catch {
    /* telemetri tidak boleh mengganggu aplikasi */
  }
}

export function track(event: string, props?: Record<string, unknown>): void {
  post(event, props);
}

/** Core Web Vitals → /api/telemetry (in-process metrics, tanpa PII). */
export function initTelemetry(): void {
  const send = (name: string) => (m: { value: number }) => post("web_vital", undefined, { name, value: m.value });
  onCLS(send("CLS"));
  onINP(send("INP"));
  onLCP(send("LCP"));
  onTTFB(send("TTFB"));
}
