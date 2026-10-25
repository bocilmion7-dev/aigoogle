import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { env } from "../env.js";
import { prisma } from "../db.js";
import { decryptToken, encryptToken } from "../crypto.js";
import { requireUser } from "../middleware/session.js";
import { requirePerm } from "../permissions.js";

export const googleRouter = Router();

function isHttps(req: { secure?: boolean; headers: Record<string, unknown> }): boolean {
  return !!req.secure || String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]!.trim() === "https";
}

const SCOPES = ["https://www.googleapis.com/auth/drive"];

/** redirect_uri Google OAuth — derive dari APP_ORIGIN (harus terdaftar di Google Cloud Console). */
const redirectUri = () => `${env.APP_ORIGIN.replace(/\/$/, "")}/api/oauth/google/callback`;

googleRouter.get("/oauth/google/start", requireUser, requirePerm("app:drive.tidy"), (req, res) => {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return res.status(501).json({
      error: "google_secret_missing",
      message: "Isi GOOGLE_OAUTH_CLIENT_SECRET di .env (Google Cloud Console → OAuth client).",
    });
  }
  // state acak & terikat sesi (bukan tenantId mentah) → cegah login/binding CSRF
  const nonce = randomBytes(16).toString("hex");
  res.cookie("goauth", encryptToken(JSON.stringify({ n: nonce, t: req.user!.tenant.id })), {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(req),
    maxAge: 10 * 60_000,
    path: "/api/oauth/google",
  });
  const state = nonce;
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", env.GOOGLE_OAUTH_CLIENT_ID);
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  res.redirect(u.toString());
});

googleRouter.get("/oauth/google/callback", requireUser, requirePerm("app:drive.tidy"), async (req, res, next) => {
  try {
    const { code, state } = z.object({ code: z.string(), state: z.string() }).parse(req.query);
    // verifikasi state: harus cocok dengan cookie sesi + tenant user yang sama
    let pack: { n?: string; t?: string } | null = null;
    try {
      pack = JSON.parse(decryptToken(String(req.cookies?.goauth ?? ""))) as { n?: string; t?: string };
    } catch {
      pack = null;
    }
    res.clearCookie("goauth", { path: "/api/oauth/google" });
    if (!state || !pack?.n || pack.n !== state || pack.t !== req.user!.tenant.id) {
      return res.redirect(`${env.APP_ORIGIN}/explore?error=google_state`);
    }
    const tenantId = req.user!.tenant.id;
    const tokRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
      }),
    });
    if (!tokRes.ok) return res.redirect(`${env.APP_ORIGIN}/explore?error=google_token`);
    const tok = (await tokRes.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    const expiresAt = new Date(Date.now() + (tok.expires_in ?? 3600) * 1000);
    await prisma.connection.upsert({
      where: { tenantId_provider: { tenantId, provider: "google" } },
      create: {
        tenantId,
        provider: "google",
        accessTokenEnc: encryptToken(tok.access_token),
        refreshTokenEnc: encryptToken(tok.refresh_token ?? ""),
        expiresAt,
      },
      update: {
        accessTokenEnc: encryptToken(tok.access_token),
        refreshTokenEnc: encryptToken(tok.refresh_token ?? ""),
        expiresAt,
        status: "connected",
      },
    });
    res.redirect(`${env.APP_ORIGIN}/explore`);
  } catch (e) {
    next(e);
  }
});
