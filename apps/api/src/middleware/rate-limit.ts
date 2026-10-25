import type { NextFunction, Request, Response } from "express";

/**
 * Rate limiter in-memory (sliding window per kunci) — tanpa dependensi.
 * Cukup utk satu instance; saat multi-instance pindah ke Redis (API sama).
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

// bersihkan entri kedaluwarsa berkala (unref → tak menahan proses)
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of store) if (b.resetAt <= now) store.delete(k);
}, 60_000);
sweeper.unref?.();

export interface RateLimitOpts {
  /** nama bucket — pisahkan antar-route */
  name: string;
  windowMs: number;
  max: number;
  /** kunci tambahan (default: user id bila login, selain itu IP) */
  key?: (req: Request) => string;
}

function clientKey(req: Request): string {
  const u = (req as Request & { user?: { id?: string } }).user;
  if (u?.id) return `u:${u.id}`;
  // X-Real-IP diisi nginx dari koneksi sebenarnya. JANGAN pakai X-Forwarded-For
  // (entri pertama bisa dipalsukan klien → rate limit login bisa di-bypass).
  const real = String(req.headers["x-real-ip"] ?? "").trim();
  return `ip:${real || req.ip || req.socket.remoteAddress || "?"}`;
}

export function rateLimit(o: RateLimitOpts) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${o.name}:${o.key ? o.key(req) : clientKey(req)}`;
    const now = Date.now();
    let b = store.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + o.windowMs };
      store.set(key, b);
    }
    b.count += 1;
    res.setHeader("X-RateLimit-Limit", String(o.max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, o.max - b.count)));
    if (b.count > o.max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((b.resetAt - now) / 1000))));
      res.status(429).json({
        error: "terlalu_banyak_permintaan",
        message: "Terlalu banyak permintaan — coba lagi sebentar.",
      });
      return;
    }
    next();
  };
}

/** reset state (utk uji) */
export function resetRateLimits(): void {
  store.clear();
}
