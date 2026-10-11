import express from "express";
import cookieParser from "cookie-parser";
import { loadSession } from "./middleware/session.js";
import { meRouter } from "./routes/me.js";
import { launchRouter } from "./routes/launch.js";
import { settingsRouter } from "./routes/settings.js";
import { googleRouter } from "./routes/google.js";
import { chatRouter } from "./routes/chat.js";
import { audioRouter } from "./routes/audio.js";
import { driveRouter } from "./routes/drive.js";
import { adminRouter } from "./routes/admin.js";
import { billingRouter } from "./routes/billing.js";
import { authRouter } from "./routes/auth.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    next();
  });
  app.use(express.json());
  app.use(cookieParser());
  app.use(loadSession);
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", meRouter);
  app.use("/api", authRouter);
  app.use("/api", launchRouter);
  app.use("/api", settingsRouter);
  app.use("/api", googleRouter);
  app.use("/api", chatRouter);
  app.use("/api", audioRouter);
  app.use("/api", driveRouter);
  app.use("/api", adminRouter);
  app.use("/api", billingRouter);

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
