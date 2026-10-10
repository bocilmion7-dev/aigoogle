import { Router } from "express";
import { env } from "../env.js";

export const googleRouter = Router();

const SCOPES = ["https://www.googleapis.com/auth/drive"];

googleRouter.get("/oauth/google/start", (req, res) => {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return res.status(501).json({
      error: "google_secret_missing",
      message: "Isi GOOGLE_OAUTH_CLIENT_SECRET di .env (Google Cloud Console → OAuth client).",
    });
  }
  const state = req.user ? req.user.tenant.id : "";
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", env.GOOGLE_OAUTH_CLIENT_ID);
  u.searchParams.set("redirect_uri", "http://localhost:3001/api/oauth/google/callback");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  res.redirect(u.toString());
});

// callback: menukar code → refresh token Google → simpan di Connection(provider="google")
// DIIMPLEMENTASIKAN PENUH DI FASE 3 (Explore Manager) — saat secret tersedia.
