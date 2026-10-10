import express from "express";
import cookieParser from "cookie-parser";
import { loadSession } from "./middleware/session.js";
import { meRouter } from "./routes/me.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());
  app.use(cookieParser());
  app.use(loadSession);
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", meRouter);

  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    console.error(err);
    const status = (err as { status?: number; statusCode?: number })?.status
      ?? (err as { statusCode?: number })?.statusCode
      ?? 500;
    res.status(status).json({ error: status >= 500 ? "internal" : "bad_request" });
  });
  return app;
}
