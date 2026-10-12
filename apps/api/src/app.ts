import express from "express";
import { ZodError } from "zod";
import cookieParser from "cookie-parser";
import { loadPlatformSession, loadSession } from "./middleware/session.js";
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
import { waRouter } from "./routes/wa.js";
import { customersRouter } from "./routes/customers.js";
import { webhookAccurateRouter, webhookRootRouter } from "./routes/webhook-accurate.js";

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
  app.use(loadPlatformSession);
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
  app.use("/api", waRouter);
  app.use("/api", customersRouter);
  app.use("/api", webhookAccurateRouter);
  // POST /webhook — target URL webhook yang terdaftar di Area Developer Accurate
  app.use(webhookRootRouter);

  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: "validasi",
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    console.error(err);
    const status = (err as { status?: number; statusCode?: number })?.status
      ?? (err as { statusCode?: number })?.statusCode
      ?? 500;
    res.status(status).json({ error: status >= 500 ? "internal" : "bad_request" });
  });
  return app;
}
