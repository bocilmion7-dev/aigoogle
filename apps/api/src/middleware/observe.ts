import type { NextFunction, Request, Response } from "express";
import { recordRequest } from "../metrics.js";

/**
 * Observasi request: ukur latensi, catat metrik, dan log JSON utk request
 * lambat (>=2 dtk) atau gagal (>=500). Log biasa tetap ringkas.
 */
export function observe() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const t0 = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - t0;
      const path = req.originalUrl.split("?")[0] ?? req.path;
      recordRequest(req.method, path, res.statusCode, ms);
      if (ms >= 2000 || res.statusCode >= 500) {
        const line = JSON.stringify({
          level: res.statusCode >= 500 ? "error" : "warn",
          kind: "request",
          method: req.method,
          path,
          status: res.statusCode,
          ms,
          user: (req as Request & { user?: { id?: string } }).user?.id ?? null,
        });
        if (res.statusCode >= 500) console.error(line);
        else console.warn(line);
      }
    });
    next();
  };
}
