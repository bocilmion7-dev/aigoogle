import { useSyncExternalStore } from "react";

export interface ChatNotice {
  id: number;
  preview: string;
  at: number;
}

let notice: ChatNotice | null = null;
const listeners = new Set<() => void>();

type AudioContextCtor = typeof AudioContext;

let audioCtx: AudioContext | null = null;

/** Panggil dari gesture pengguna (kirim pesan) agar browser mengizinkan audio. */
export function unlockChatSound(): void {
  if (typeof window === "undefined") return;
  const Ctor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return;
  try {
    if (!audioCtx || audioCtx.state === "closed") audioCtx = new Ctor();
    if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => null);
  } catch {
    /* audio opsional — notifikasi visual tetap tampil */
  }
}

function tone(ctx: AudioContext, freq: number, at: number, dur: number, peak: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** Dua nada pendek — cukup terdengar, tidak mengagetkan. */
export function playChatSound(): void {
  if (typeof window === "undefined") return;
  unlockChatSound();
  const ctx = audioCtx;
  if (!ctx) return;
  const play = () => {
    const t = ctx.currentTime + 0.02;
    tone(ctx, 880, t, 0.16, 0.34);
    tone(ctx, 1174.66, t + 0.15, 0.24, 0.28);
  };
  if (ctx.state === "running") play();
  else void ctx.resume().then(play).catch(() => null);
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ChatNotice | null {
  return notice;
}

export function useChatNotice(): ChatNotice | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function dismissChatNotice(): void {
  if (!notice) return;
  notice = null;
  emit();
}

/** Ringkas markdown/jawaban panjang jadi isi notifikasi yang pendek. */
function preview(content: string): string {
  const text = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Balasan AI sudah siap dibaca.";
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

export function chatNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestChatNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

async function showBrowserNotification(body: string, silent: boolean): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const title = "AI Asisten sudah membalas";
  const options: NotificationOptions = {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "aigoogle-chat-reply",
    silent,
    data: { url: "/app" },
  };
  try {
    const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (registration) {
      await registration.showNotification(title, options);
      return;
    }
  } catch {
    /* fallback ke Notification biasa */
  }
  try {
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      window.location.href = "/app";
      n.close();
    };
  } catch {
    /* browser bisa memblokir notifikasi meski izin diberikan */
  }
}

/**
 * Dipanggil setelah stream chat selesai. Saat pengguna sedang di halaman lain,
 * tampilkan notifikasi in-app dan (bila diizinkan) notifikasi browser.
 */
export function notifyChatReply(content: string): void {
  if (typeof window === "undefined") return;
  const body = preview(content);
  const awayFromChat = window.location.pathname !== "/app";
  const hidden = document.visibilityState !== "visible";
  if (!awayFromChat && !hidden) return;

  if (awayFromChat) {
    notice = { id: Date.now(), preview: body, at: Date.now() };
    emit();
  }
  // Saat tab tersembunyi dan izin browser ada, biarkan notifikasi OS yang
  // berbunyi. Selain itu mainkan nada in-app (mis. saat pindah halaman).
  const systemWillSound = hidden && chatNotificationPermission() === "granted";
  if (!systemWillSound) playChatSound();
  void showBrowserNotification(body, !hidden);
}
