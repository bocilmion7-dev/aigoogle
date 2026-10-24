/** Metrik in-process ringan (tanpa dependensi): request, latensi, error, LLM. */

interface RouteStat {
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
  /** sampel latensi terakhir (reservoir) utk persentil */
  samples: number[];
}

const MAX_SAMPLES = 500;
const startedAt = Date.now();

const routes = new Map<string, RouteStat>();
const counters = new Map<string, number>();
const llm = { calls: 0, promptTokens: 0, completionTokens: 0, byKind: new Map<string, number>() };

function stat(key: string): RouteStat {
  let s = routes.get(key);
  if (!s) {
    s = { count: 0, errors: 0, totalMs: 0, maxMs: 0, samples: [] };
    routes.set(key, s);
  }
  return s;
}

export function recordRequest(method: string, path: string, status: number, ms: number): void {
  // normalisasi path dinamis → pola rute (cuid/uuid/angka → :id)
  const norm = path
    .replace(/\/[0-9a-f]{20,}/gi, "/:id")
    .replace(/\/\d+/g, "/:n")
    .slice(0, 120);
  const key = `${method} ${norm}`;
  const s = stat(key);
  s.count += 1;
  s.totalMs += ms;
  s.maxMs = Math.max(s.maxMs, ms);
  if (status >= 500) s.errors += 1;
  s.samples.push(ms);
  if (s.samples.length > MAX_SAMPLES) s.samples.shift();
}

export function recordLlm(kind: string, promptTokens: number, completionTokens: number): void {
  llm.calls += 1;
  llm.promptTokens += promptTokens;
  llm.completionTokens += completionTokens;
  llm.byKind.set(kind, (llm.byKind.get(kind) ?? 0) + 1);
}

export function countEvent(name: string, delta = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + delta);
}

function pct(samples: number[], p: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx]!);
}

export function metricsSnapshot(): Record<string, unknown> {
  const list = [...routes.entries()]
    .map(([route, s]) => ({
      route,
      count: s.count,
      errors: s.errors,
      avgMs: s.count ? Math.round(s.totalMs / s.count) : 0,
      maxMs: s.maxMs,
      p50: pct(s.samples, 50),
      p95: pct(s.samples, 95),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);

  return {
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    llm: {
      calls: llm.calls,
      promptTokens: llm.promptTokens,
      completionTokens: llm.completionTokens,
      byKind: Object.fromEntries(llm.byKind),
    },
    events: Object.fromEntries(counters),
    routes: list,
  };
}

/** reset metrik (utk uji) */
export function resetMetrics(): void {
  routes.clear();
  counters.clear();
  llm.calls = 0;
  llm.promptTokens = 0;
  llm.completionTokens = 0;
  llm.byKind.clear();
}
