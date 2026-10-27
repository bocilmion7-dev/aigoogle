import type { NextFunction, Request, Response } from "express";
import { Redis } from "ioredis";

/**
 * Rate limiter sliding-window per kunci.
 *
 * - Default: in-memory (cukup untuk 1 instance / dev).
 * - Produksi multi-instance: set `REDIS_URL` → counter dibagi semua instance
 *   sehingga limit tidak bisa di-bypass dengan menembak instance berbeda.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

interface LimitStore {
  incr(key: string, windowMs: number): Promise<Bucket>;
}

const memory = new Map<string, Bucket>();

class MemoryStore implements LimitStore {
  async incr(key: string, windowMs: number): Promise<Bucket> {
    const now = Date.now();
    let b = memory.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      memory.set(key, b);
    }
    b.count += 1;
    return b;
  }
}

const LUA_INCR = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {c, ttl}
`;

class RedisStore implements LimitStore {
  private readonly client: Redis;
  constructor(url: string) {
    this.client = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      enableOfflineQueue: true,
    });
  }
  async incr(key: string, windowMs: number): Promise<Bucket> {
    const raw = (await this.client.eval(LUA_INCR, 1, `rl:${key}`, String(windowMs))) as [number, number];
    const count = Number(raw[0] ?? 0);
    const ttl = Number(raw[1] ?? windowMs);
    return { count, resetAt: Date.now() + Math.max(0, ttl) };
  }
}

const memoryStore = new MemoryStore();
let redisStore: RedisStore | null = null;
function store(): LimitStore {
  if (process.env.REDIS_URL) {
    if (!redisStore) redisStore = new RedisStore(process.env.REDIS_URL);
    return {
      incr: async (key, windowMs) => {
        try {
          return await redisStore!.incr(key, windowMs);
        } catch {
          // Redis down → tetap batasi di instance ini, jangan fail-open total.
          return memoryStore.incr(key, windowMs);
        }
      },
    };
  }
  return memoryStore;
}

// bersihkan entri kedaluwarsa berkala (unref → tak menahan proses)
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of memory) if (b.resetAt <= now) memory.delete(k);
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
    void (async () => {
      try {
        const key = `${o.name}:${o.key ? o.key(req) : clientKey(req)}`;
        const b = await store().incr(key, o.windowMs);
        const now = Date.now();
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
      } catch (e) {
        next(e);
      }
    })();
  };
}

/** reset state (utk uji) */
export function resetRateLimits(): void {
  memory.clear();
}
