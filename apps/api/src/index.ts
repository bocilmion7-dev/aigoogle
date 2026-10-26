import { setDefaultResultOrder } from "node:dns";
import { env } from "./env.js";
import { createApp } from "./app.js";
import { runWaJobs } from "./wa/scheduler.js";
import { runProactiveJobs } from "./wa/proactive.js";
import { syncShippingStatuses } from "./wa/shipping-notify.js";
import { biteshipKeyMode, track } from "./shipping/biteship.js";
import { syncAllTenants } from "./sync/daily.js";
import { runNewsIngest } from "./wawasan/ingest.js";
import { DAILY_REFRESH_MINUTES, runDailyDigests, wibDate } from "./wawasan/digest.js";
import { wibMinutes } from "./wawasan/time.js";
import { prisma } from "./db.js";

// Peringatan produksi: key Biteship test membuat order TIDAK dikirim nyata.
if (env.APP_ORIGIN.startsWith("https://") && biteshipKeyMode() === "test") {
  console.warn(
    "[biteship] MODE TEST aktif di produksi — order kurir tidak dikirim nyata. " +
      "Set BITESHIP_USE_LIVE=1 (memakai BITESHIP_LIVE_API_KEY) setelah Order API diaktivasi."
  );
}

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

// Insight pasar: ingest berita eksternal tiap 2 jam (bahan digest).
setTimeout(() => {
  void runNewsIngest()
    .catch((e) => console.error("[insight] ingest gagal:", e instanceof Error ? e.message : e));
}, 60_000);
setInterval(
  () => {
    void runNewsIngest()
      .catch((e) => console.error("[insight] ingest gagal:", e instanceof Error ? e.message : e));
  },
  2 * 3600_000
);

// Insight pasar: digest SEKALI SEHARI (04:30 WIB). Halaman hanya membaca hasilnya.
setInterval(
  () => {
    void (async () => {
      try {
        if (wibMinutes() < DAILY_REFRESH_MINUTES) return;
        const today = wibDate();
        const key = "insight:digest_last";
        const row = await prisma.appSetting.findUnique({ where: { key } });
        if (row?.value === today) return;
        await runDailyDigests(100);
        await prisma.appSetting.upsert({
          where: { key },
          create: { key, value: today },
          update: { value: today },
        });
      } catch (e) {
        console.error("[insight] digest harian gagal:", e instanceof Error ? e.message : e);
      }
    })();
  },
  15 * 60_000
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

// Status pengiriman Biteship — fallback bila webhook belum dipasang (tiap 10 menit)
setInterval(
  () => {
    void syncShippingStatuses((id) => track(id))
      .then((n) => {
        if (n > 0) console.log(`[kirim] ${n} status pengiriman diperbarui`);
      })
      .catch((e) => console.error("[kirim] gagal:", e instanceof Error ? e.message : e));
  },
  10 * 60_000
);

// Scheduler WA — tiap 15 menit (produksi: cron eksternal)
setInterval(
  () => {
    void runWaJobs().catch((e) => console.error("wa jobs", e));
  },
  15 * 60_000
);
