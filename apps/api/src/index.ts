import { setDefaultResultOrder } from "node:dns";
import { env } from "./env.js";
import { createApp } from "./app.js";
import { runWaJobs } from "./wa/scheduler.js";

// server ini punya IPv6 default yg tak stabil ke API Google — paksa IPv4 dulu
setDefaultResultOrder("ipv4first");

// Cegah crash tak terduga mematikan server (Node default: crash → koneksi user
// terputus → banner "Koneksi terputus — coba lagi.").
// - unhandledRejection: floating promise yg reject → catat, TETAP jalan (umumnya tak fatal).
// - uncaughtException: state bisa tak konsisten → catat lalu keluar; systemd
//   (Restart=always) menghidupkan lagi dalam ~3 detik — jauh lebih baik drpd proses
//   mati terus-menerus tanpa supervisi spt sebelumnya.
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException:", err);
  process.exit(1);
});

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
