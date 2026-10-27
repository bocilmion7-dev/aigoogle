import type { CookieOptions, Request, Response } from "express";
import { env } from "./env.js";

/**
 * Cookie sesi. Di HTTPS pakai prefix __Host- (wajib Secure, Path=/, tanpa Domain).
 * Di HTTP/dev tetap nama lama agar test & dev lokal tidak rusak.
 */
export const secureCookies = env.APP_ORIGIN.startsWith("https://");
export const SESSION_COOKIE = secureCookies ? "__Host-sid" : "sid";
export const PLATFORM_COOKIE = secureCookies ? "__Host-psid" : "psid";
export const IMPERSONATION_COOKIE = secureCookies ? "__Host-imp" : "imp";
export const cookiePath = secureCookies ? "/" : "/api";

export function sessionCookieOptions(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: secureCookies,
    path: cookiePath,
    maxAge,
  };
}

export function readSessionId(req: Request): string | undefined {
  return (req.cookies?.[SESSION_COOKIE] ?? req.cookies?.sid) as string | undefined;
}

export function readPlatformId(req: Request): string | undefined {
  return (req.cookies?.[PLATFORM_COOKIE] ?? req.cookies?.psid) as string | undefined;
}

export function readImpersonationId(req: Request): string | undefined {
  return (req.cookies?.[IMPERSONATION_COOKIE] ?? req.cookies?.imp) as string | undefined;
}

export function setSessionCookie(res: Response, value: string, maxAge: number): void {
  res.cookie(SESSION_COOKIE, value, sessionCookieOptions(maxAge));
  // bersihkan cookie lama saat transisi ke __Host-
  if (secureCookies) res.clearCookie("sid", { path: "/api" });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: cookiePath });
  res.clearCookie("sid", { path: "/api" });
}

export function setPlatformCookie(res: Response, value: string, maxAge: number): void {
  res.cookie(PLATFORM_COOKIE, value, sessionCookieOptions(maxAge));
  if (secureCookies) res.clearCookie("psid", { path: "/api" });
}

export function clearPlatformCookie(res: Response): void {
  res.clearCookie(PLATFORM_COOKIE, { path: cookiePath });
  res.clearCookie("psid", { path: "/api" });
}

export function setImpersonationCookie(res: Response, value: string, maxAge: number): void {
  res.cookie(IMPERSONATION_COOKIE, value, sessionCookieOptions(maxAge));
  if (secureCookies) res.clearCookie("imp", { path: "/api" });
}

export function clearImpersonationCookie(res: Response): void {
  res.clearCookie(IMPERSONATION_COOKIE, { path: cookiePath });
  res.clearCookie("imp", { path: "/api" });
}
