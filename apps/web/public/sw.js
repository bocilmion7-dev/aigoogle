/* Service worker: cache shell + aset ber-hash; API selalu jaringan.
 *
 * Aturan penting (v4):
 *  - HANYA simpan respons ok (status 200). Dulu respons 404 ikut di-cache, sehingga
 *    sekali aset gagal (jendela rsync deploy / jaringan putus) browser terus
 *    menyajikan 404 itu — hard reload pun tidak menolong. Itu penyebab utama
 *    halaman "macet" setelah deploy.
 *  - Aset & navigasi: NETWORK-FIRST. Server selalu jadi kebenaran; cache hanya
 *    fallback saat offline. Hash aset berubah tiap deploy, jadi cache lama tak
 *    boleh mengalahkan jaringan.
 *  - Semua fetch diberi BATAS WAKTU (5 dtk navigasi / 8 dtk aset). Koneksi
 *    mobile yang menggantung (bukan putus) dulu membuat refresh menunggu tanpa
 *    akhir — sekarang langsung jatuh ke cache sehingga halaman tetap terbuka.
 */
const CACHE = "aigoogle-shell-v5";
const SHELL = ["/index.html", "/favicon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (c) => {
        // simpan per-item: satu item gagal jangan menggagalkan seluruh instalasi
        await Promise.all(
          SHELL.map((url) =>
            fetch(url, { cache: "reload" })
              .then((res) => (res.ok ? c.put(url, res) : null))
              .catch(() => null)
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** simpan hanya respons sehat */
function putIfOk(cache, request, res) {
  if (res && res.ok) {
    const copy = res.clone();
    cache.put(request, copy).catch(() => null);
  }
  return res;
}

/**
 * Batas waktu jaringan. Koneksi mobile yang "menggantung" (bukan putus) membuat
 * fetch menunggu tanpa batas → halaman tampak macet saat refresh. Setelah batas
 * ini, pakai salinan cache supaya aplikasi tetap terbuka.
 */
const NAV_TIMEOUT_MS = 5_000;
const ASSET_TIMEOUT_MS = 8_000;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("sw_timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // data akuntansi selalu segar

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await withTimeout(fetch(req), NAV_TIMEOUT_MS);
          // jangan menimpa shell dengan halaman error (502/504 saat API restart)
          if (res.ok) putIfOk(await caches.open(CACHE), "/index.html", res);
          return res;
        } catch {
          const cached = await caches.match("/index.html");
          if (cached) return cached;
          // benar-benar offline & belum pernah dibuka → tampilkan pesan ramah
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
              '<body style="font:16px system-ui;padding:2rem;line-height:1.6">' +
              "<h1>Koneksi terputus</h1><p>Sambungkan internet lalu muat ulang halaman.</p>" +
              '<button onclick="location.reload()" style="font:inherit;padding:.6rem 1rem">Muat ulang</button>',
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
      })()
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname === "/favicon.svg" || url.pathname.startsWith("/fonts/")) {
    event.respondWith(
      (async () => {
        try {
          const res = await withTimeout(fetch(req), ASSET_TIMEOUT_MS);
          const cache = await caches.open(CACHE);
          if (res.ok) putIfOk(cache, req, res);
          else cache.delete(req).catch(() => null); // buang entri basi/rusak
          return res;
        } catch {
          // jangan pernah menyajikan HTML 404/502 sebagai JS/CSS
          const hit = await caches.match(req);
          return hit || Response.error();
        }
      })()
    );
  }
});


/* Web Push: tampilkan notifikasi & buka halaman terkait saat diklik. */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "AI Asisten";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/app" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
