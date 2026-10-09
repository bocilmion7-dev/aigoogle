import express from "express";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

if (process.env.MOCK_ACCURATE_AUTOSTART === "1") {
  const port = Number(process.env.PORT ?? 4010);
  createApp().listen(port, () => {
    console.log(`mock accurate listening :${port}`);
  });
}
