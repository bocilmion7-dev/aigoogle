import express from "express";
import cookieParser from "cookie-parser";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  return app;
}
