import type { NextFunction, Request, Response } from "express";
import { resolveSession, userFromBearer } from "./store.js";

export interface MockCtx { dbId: string; userId: string; }
declare global {
  namespace Express {
    interface Request { mockCtx?: MockCtx; mockUserId?: string; }
  }
}

export function ok(d: unknown, extra?: Record<string, unknown>) {
  return { s: true, d, ...(extra ?? {}) };
}
export function fail(d: string[]) {
  return { s: false, d };
}
export function sp(total: number) {
  return { page: 1, sort: null, pageSize: total, pageCount: 1, rowCount: total, start: 0, limit: null };
}

export function bearerGuard(req: Request, res: Response, next: NextFunction) {
  const userId = userFromBearer(req.headers.authorization);
  if (!userId) return res.status(401).json(fail(["Token tidak valid"]));
  req.mockUserId = userId;
  next();
}

export function sessionGuard(req: Request, res: Response, next: NextFunction) {
  const userId = userFromBearer(req.headers.authorization);
  if (!userId) return res.status(401).json(fail(["Token tidak valid"]));
  const ctx = resolveSession(req.header("X-Session-ID") ?? undefined);
  if (!ctx) return res.status(401).json(fail(["Session tidak valid"]));
  if (ctx.userId !== userId) return res.status(401).json(fail(["Session bukan milik token ini"]));
  req.mockCtx = ctx;
  next();
}
