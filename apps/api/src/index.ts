import { setDefaultResultOrder } from "node:dns";
import { env } from "./env.js";
import { createApp } from "./app.js";
import { runWaJobs } from "./wa/scheduler.js";
import { runProactiveJobs } from "./wa/proactive.js";
import { syncAllTenants } from "./sync/daily.js";

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

const server = createApp().listen(env.PORT, () => {
  console.log(`api :${env.PORT}`);
});
// Koneksi keepalive dijaga jelas (standar pair utk proxy nginx):
// Node menutup socket idle sendiri — tak ada koneksi setengah mati yg
// menggantung di event loop menunggu klien yang sudah pergi.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;

// Sinkronisasi snapshot harian Accurate (tren/analitik) — tiap 6 jam.
// Jalan pertama 90 dtk setelah start agar tidak berebut saat boot.
setTimeout(() => {
  void syncAllTenants(3)
    .then((r) => console.log(`[sync] ${r.filter((x) => x.ok).length}/${r.length} tenant tersinkron`))
    .catch((e) => console.error("[sync] gagal:", e instanceof Error ? e.message : e));
}, 90_000);
setInterval(
  () => {
    void syncAllTenants(3)
      .then((r) => console.log(`[sync] ${r.filter((x) => x.ok).length}/${r.length} tenant tersinkron`))
      .catch((e) => console.error("[sync] gagal:", e instanceof Error ? e.message : e));
  },
  6 * 3600_000
);

// Pesan proaktif WA (digest harian) — dicek tiap 30 menit; idempoten per hari.
setInterval(
  () => {
    void runProactiveJobs()
      .then((r) => {
        const sent = r.filter((x) => x.sent).length;
        if (sent > 0) console.log(`[proaktif] ${sent} digest terkirim`);
      })
      .catch((e) => console.error("[proaktif] gagal:", e instanceof Error ? e.message : e));
  },
  30 * 60_000
);

// Scheduler WA — tiap 15 menit (produksi: cron eksternal)
setInterval(
  () => {
    void runWaJobs().catch((e) => console.error("wa jobs", e));
  },
  15 * 60_000
);
