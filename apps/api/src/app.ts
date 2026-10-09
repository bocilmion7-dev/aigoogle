import express from "express";
import cookieParser from "cookie-parser";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());
  app.use(cookieParser());
  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "internal" });
  });
  return app;
}
