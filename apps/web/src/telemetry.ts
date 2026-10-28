export type Vital = { name: string; value: number };

function post(event: string, props?: Record<string, unknown>): void {
  try {
    const body = JSON.stringify({ event, props });
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

/** Kirim semua Core Web Vitals dalam SATU request (dipanggil dari vitals.ts). */
export function trackVitals(items: Vital[]): void {
  if (!items.length) return;
  post("web_vitals", { items });
}
