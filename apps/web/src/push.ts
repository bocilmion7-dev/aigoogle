function urlBase64ToUint8Array(base64: string): BufferSource {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))) as BufferSource;
}

export async function enablePush(): Promise<{ ok: boolean; error?: string; sent?: number }> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, error: "Browser tidak mendukung notifikasi push." };
  }
  const info = (await fetch("/api/push/public-key").then((r) => r.json()).catch(() => null)) as
    | { enabled: boolean; key: string }
    | null;
  if (!info?.enabled || !info.key) return { ok: false, error: "Push belum dikonfigurasi admin." };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, error: "Izin notifikasi ditolak." };
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(info.key),
    }));
  const r = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  if (!r.ok) return { ok: false, error: "Gagal menyimpan langganan push." };
  return { ok: true };
}

/** Apakah perangkat ini sudah punya langganan push aktif? */
export async function getPushSubscriptionState(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export async function disablePush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => null);
  await sub.unsubscribe().catch(() => null);
}

export async function testPush(): Promise<number> {
  const r = await fetch("/api/push/test", { method: "POST" });
  const j = (await r.json().catch(() => ({}))) as { sent?: number; error?: string };
  if (!r.ok) throw new Error(j.error ?? "Gagal mengirim notifikasi uji.");
  return j.sent ?? 0;
}
