import { Router } from "express";
import { exchangeCode, issueAccess, issueCode, issueRefresh, useRefresh } from "./store.js";

export const oauthRouter = Router();

oauthRouter.get("/authorize", (req, res) => {
  const { redirect_uri, state, user } = req.query as Record<string, string>;
  if (!redirect_uri) return res.status(400).json({ error: "redirect_uri required" });
  const userId = user === "staff" ? "user-staff" : user === "platform" ? "user-platform" : "user-admin";
  const url = new URL(redirect_uri);
  url.searchParams.set("code", issueCode(userId));
  if (state) url.searchParams.set("state", state);
  res.redirect(url.toString());
});

oauthRouter.post("/token", (req, res) => {
  const { grant_type, code, refresh_token } = req.body as Record<string, string>;
  const payload = (userId: string) => ({
    token_type: "Bearer",
    access_token: issueAccess(userId),
    refresh_token: issueRefresh(userId),
    expires_in: 15 * 86400,
  });
  if (grant_type === "authorization_code") {
    const userId = exchangeCode(code);
    if (!userId) return res.status(400).json({ error: "invalid_code" });
    return res.json(payload(userId));
  }
  if (grant_type === "refresh_token") {
    const userId = useRefresh(refresh_token);
    if (!userId) return res.status(400).json({ error: "invalid_refresh_token" });
    return res.json(payload(userId));
  }
  return res.status(400).json({ error: "unsupported_grant_type" });
});
