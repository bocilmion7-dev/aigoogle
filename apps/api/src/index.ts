import { setDefaultResultOrder } from "node:dns";
import { env } from "./env.js";
import { createApp } from "./app.js";
import { runWaJobs } from "./wa/scheduler.js";

// server ini punya IPv6 default yg tak stabil ke API Google — paksa IPv4 dulu
setDefaultResultOrder("ipv4first");

createApp().listen(env.PORT, () => {
  console.log(`api :${env.PORT}`);
});

// Scheduler WA — tiap 15 menit (produksi: cron eksternal)
setInterval(
  () => {
    void runWaJobs().catch((e) => console.error("wa jobs", e));
  },
  15 * 60_000
);
