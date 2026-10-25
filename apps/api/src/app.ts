import express from "express";
import { ZodError } from "zod";
import cookieParser from "cookie-parser";
import { loadPlatformSession, loadSession } from "./middleware/session.js";
import { meRouter } from "./routes/me.js";
import { launchRouter } from "./routes/launch.js";
import { settingsRouter } from "./routes/settings.js";
import { aiProvidersRouter } from "./routes/ai-providers.js";
import { googleRouter } from "./routes/google.js";
import { chatRouter } from "./routes/chat.js";
import { audioRouter } from "./routes/audio.js";
import { driveRouter } from "./routes/drive.js";
import { adminRouter } from "./routes/admin.js";
import { billingRouter, snapNotifyRouter } from "./routes/billing.js";
import { authRouter } from "./routes/auth.js";
import { waRouter } from "./routes/wa.js";
import { customersRouter } from "./routes/customers.js";
import { ordersRouter } from "./routes/orders.js";
import { sandboxRouter } from "./routes/sandbox.js";
import { webhookAccurateRouter, webhookRootRouter } from "./routes/webhook-accurate.js";
import { LlmHttpError } from "./ai/llm-error.js";
import { opsRouter } from "./routes/ops.js";
import { docTypesRouter } from "./routes/doc-types.js";
import { aiBillingRouter } from "./routes/ai-billing.js";
import { observe } from "./middleware/observe.js";
import { rateLimit } from "./middleware/rate-limit.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // API data akuntansi/saldo tidak boleh di-cache: ETag bisa memicu 304 tanpa body
  // dan tampil sebagai error di klien (mis. paging riwayat saldo).
  app.set("etag", false);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
      },
    })
  );
  app.use(cookieParser());
  app.use(loadSession);
  app.use(loadPlatformSession);
  app.use(observe());
  // batas umum per IP — mencegah penyalahgunaan kasar (login & chat punya limit lebih ketat)
  app.use("/api", rateLimit({ name: "global", windowMs: 60_000, max: 600 }));
  app.use("/api", opsRouter);
  // Notifikasi QRIS Midtrans — pasang paling awal agar tak tertangkap router lain
  // (ada router dengan .use(middleware) tanpa path yang menangkap semua request)
  app.use("/api", snapNotifyRouter);
  // URL notifikasi Midtrans terdaftar sebagai /api/billing/webhook/v1.0/qr/qr-mpm-notify
  app.use("/api/billing/webhook", snapNotifyRouter);
  app.use(snapNotifyRouter);
  app.use("/api", meRouter);
  app.use("/api", authRouter);
  app.use("/api", launchRouter);
  app.use("/api", settingsRouter);
  app.use("/api", aiProvidersRouter);
  app.use("/api", googleRouter);
  app.use("/api", chatRouter);
  app.use("/api", audioRouter);
  app.use("/api", driveRouter);
  app.use("/api", adminRouter);
  app.use("/api", billingRouter);
  app.use("/api", waRouter);
  app.use("/api", customersRouter);
  app.use("/api", ordersRouter);
  app.use("/api", sandboxRouter);
  app.use("/api", docTypesRouter);
  app.use("/api", aiBillingRouter);
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
    if (err instanceof LlmHttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    const status = (err as { status?: number; statusCode?: number })?.status
      ?? (err as { statusCode?: number })?.statusCode
      ?? 500;
    res.status(status).json({ error: status >= 500 ? "internal" : "bad_request" });
  });
  return app;
}
