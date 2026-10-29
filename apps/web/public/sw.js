/* Service worker: shell + aset ber-hash; API selalu jaringan.
 *
 * Prinsip v13:
 *  - Aset ber-hash (/assets/) dan font: CACHE-FIRST. Nama ber-hash immutable,
 *    jadi salinan cache selalu valid. Reload setelah idle tidak menunggu
 *    jaringan 8 detik per aset.
 *  - Navigasi: NETWORK-FIRST dengan timeout 3 dtk; fallback index cached.
 *    Deploy baru langsung terpakai, tapi idle tidak menggantung.
 *  - Cache versi sebelumnya (v12/v11/v10/v9/v8) DIPERTAHANKAN saat v13 aktif, agar
 *    tab yang masih terbuka tidak kehilangan chunk lama saat SW baru mengambil alih.
 *  - Fetch yang timeout dibatalkan (AbortController), bukan dibiarkan
 *    menggantung dan menahan koneksi.
 */
/* BUILD_ID diganti otomatis oleh scripts/deploy-web.sh. Perubahan byte pada
 * sw.js memicu instalasi SW baru setiap deploy, sehingga cache index ikut
 * diperbarui walau nomor versi cache tidak dinaikkan manual. */
const BUILD_ID = "__BUILD_ID__";
const CACHE = "aigoogle-shell-v13";
const PREV_CACHES = ["aigoogle-shell-v12", "aigoogle-shell-v11", "aigoogle-shell-v10", "aigoogle-shell-v9", "aigoogle-shell-v8"];
const SHELL = ["/index.html", "/favicon.svg", "/manifest.webmanifest"];
const ENTRY_ASSET_RE = /(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g;
const NAV_TIMEOUT_MS = 5_000;
const ASSET_TIMEOUT_MS = 8_000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      await Promise.all(
        SHELL.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "reload" });
            if (!res.ok) return;
            await c.put(url, res.clone());
            if (url !== "/index.html") return;
            const html = await res.text();
            const assets = [...new Set([...html.matchAll(ENTRY_ASSET_RE)].map((m) => m[1]))];
            await Promise.all(
              assets.map(async (asset) => {
                try {
                  const ar = await fetch(asset, { cache: "reload" });
                  if (ar.ok) await c.put(asset, ar);
                } catch {
                  /* aset opsional */
                }
              })
            );
          } catch {
            /* navigasi tetap fallback ke cache lama */
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([CACHE, ...PREV_CACHES]);
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("aigoogle-shell-") && !keep.has(k)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

async function putIfOk(cache, request, res) {
  if (res && res.ok) {
    try {
      await cache.put(request, res.clone());
    } catch {
      /* kuota penuh / clone gagal */
    }
  }
  return res;
}

/** Cari di cache terbaru dulu, lalu cache versi sebelumnya. */
async function matchAny(request) {
  for (const name of [CACHE, ...PREV_CACHES]) {
    const cache = await caches.open(name);
    const hit = await cache.match(request);
    if (hit) return hit;
  }
  return null;
}

function withTimeout(promise, ms, controller) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      controller?.abort();
      reject(new Error("sw_timeout"));
    }, ms);
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

async function revalidateAsset(req) {
  const ctrl = new AbortController();
  try {
    const res = await withTimeout(fetch(req, { cache: "reload", signal: ctrl.signal }), ASSET_TIMEOUT_MS, ctrl);
    if (res.ok) await putIfOk(await caches.open(CACHE), req, res);
  } catch {
    /* tetap pakai aset cached */
  }
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
        const ctrl = new AbortController();
        try {
          // Network-first singkat: deploy baru langsung terpakai; saat jaringan
          // menggantung, fallback ke index cached setelah 3 dtk.
          const res = await withTimeout(fetch(req, { signal: ctrl.signal }), NAV_TIMEOUT_MS, ctrl);
          if (res.ok) await putIfOk(await caches.open(CACHE), "/index.html", res);
          return res;
        } catch {
          const cached = await matchAny("/index.html");
          if (cached) return cached;
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
        const cached = await matchAny(req);
        if (cached) {
          // Font nama tetap bisa berubah isi; revalidasi di background.
          if (url.pathname.startsWith("/fonts/")) event.waitUntil(revalidateAsset(req));
          return cached;
        }
        const ctrl = new AbortController();
        try {
          const res = await withTimeout(fetch(req, { signal: ctrl.signal }), ASSET_TIMEOUT_MS, ctrl);
          const cache = await caches.open(CACHE);
          if (res.ok) {
            await putIfOk(cache, req, res);
            return res;
          }
          const hit = await matchAny(req);
          if (hit) return hit;
          cache.delete(req).catch(() => null);
          return res;
        } catch {
          const hit = await matchAny(req);
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
