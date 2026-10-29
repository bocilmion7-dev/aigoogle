import { useSyncExternalStore } from "react";
import { CHAT_TIMEOUT_MS, isTimeoutError, listMessages, listSessions, streamChat } from "./chat-api";
import { notifyAiGate, notifyAiWalletChanged } from "./api";
import { notifyChatReply, unlockChatSound } from "./chat-notify";
import { track } from "./telemetry";

export interface UiMsg {
  role: "user" | "ai";
  content: string;
  /** nama proses berjalan (bukan nama tool) — tampil selagi AI bekerja */
  process?: string;
}

export interface ChatState {
  sessionId: string | null;
  msgs: UiMsg[];
  busy: boolean;
  error: string | null;
  loadErr: string | null;
  booted: boolean;
}

const initialState: ChatState = {
  sessionId: null,
  msgs: [],
  busy: false,
  error: null,
  loadErr: null,
  booted: false,
};

let state: ChatState = initialState;
let bootPromise: Promise<void> | null = null;
let lastStreamAt = Date.now();
const listeners = new Set<() => void>();

/** Jeda sebelum koneksi dianggap "dingin" — browser/HP bisa menyimpan koneksi
 * keep-alive setengah mati; POST chat tidak di-retry otomatis oleh browser. */
const IDLE_RECONNECT_MS = 15_000;

/** Hangatkan koneksi dengan GET idempoten (boleh di-retry browser) sebelum POST
 * chat pertama setelah idle. Mencegah indikator berputar sampai timeout karena
 * request menumpang socket lama yang sudah ditutup proxy/operator. */
async function warmConnectionIfIdle(): Promise<void> {
  if (Date.now() - lastStreamAt < IDLE_RECONNECT_MS) return;
  try {
    await fetch(`/api/health?warm=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    /* tetap coba chat — health bisa diblokir sementara */
  }
  lastStreamAt = Date.now();
}

function emit(): void {
  for (const listener of listeners) listener();
}

function patch(next: Partial<ChatState> | ((current: ChatState) => Partial<ChatState>)): void {
  const update = typeof next === "function" ? next(state) : next;
  state = { ...state, ...update };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ChatState {
  return state;
}

export function useChatStore(): ChatState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function saveLastSession(id: string | null): void {
  try {
    if (id) localStorage.setItem("chat:lastSession", id);
    else localStorage.removeItem("chat:lastSession");
  } catch {
    /* localStorage bisa diblokir (mode privat) — riwayat tetap jalan */
  }
}

function readLastSession(): string | null {
  try {
    return localStorage.getItem("chat:lastSession");
  } catch {
    return null;
  }
}

export function setChatSessionId(id: string): void {
  saveLastSession(id);
  patch({ sessionId: id });
}

function openSession(id: string): Promise<void> {
  patch({ sessionId: id, error: null, loadErr: null });
  saveLastSession(id);
  return listMessages(id)
    .then((history) => {
      // Jangan menimpa percakapan yang sudah berjalan (mis. pengguna mengirim
      // pesan saat riwayat sesi lama masih dimuat).
      if (state.sessionId !== id || state.busy) return;
      patch({
        msgs: history.map((m) => ({ role: m.role as "user" | "ai", content: m.content })),
        booted: true,
      });
    })
    .catch((e) => {
      if (state.sessionId !== id) return;
      patch({
        loadErr: isTimeoutError(e)
          ? "Koneksi lambat — riwayat percakapan gagal dimuat."
          : "Gagal memuat riwayat percakapan.",
        booted: true,
      });
    })
    .finally(() => {
      if (state.sessionId === id && !state.booted) patch({ booted: true });
    });
}

/**
 * Muat sesi terakhir sekali saja. Store ini hidup di level modul, jadi stream
 * chat tetap berjalan walaupun komponen halaman Chat sudah di-unmount.
 */
export function bootChat(): Promise<void> {
  if (state.booted || state.msgs.length > 0) {
    if (!state.booted) patch({ booted: true });
    return Promise.resolve();
  }
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    try {
      const { sessions: list } = await listSessions(50, 0);
      // Pengguna mungkin sudah mulai chat saat daftar sesi masih dimuat.
      if (state.busy || state.msgs.length > 0) {
        patch({ booted: true });
        return;
      }
      const saved = readLastSession();
      const pick = list.find((s) => s.id === saved) ?? list[0];
      if (pick) await openSession(pick.id);
      else patch({ booted: true });
    } catch (e) {
      patch({
        booted: true,
        loadErr: isTimeoutError(e)
          ? "Koneksi lambat — daftar sesi gagal dimuat."
          : "Gagal memuat daftar sesi.",
      });
    } finally {
      bootPromise = null;
    }
  })();
  return bootPromise;
}

export function retryChatLoads(): void {
  patch({ loadErr: null, booted: false });
  if (state.sessionId) void openSession(state.sessionId);
  else void bootChat();
}

export function appendChatMessage(content: string): void {
  patch({ msgs: [...state.msgs, { role: "ai", content }] });
}

const CONTOH_TANYAAN = [
  "Berapa total penjualan bulan ini?",
  "Berapa total pembelian bulan ini?",
  "Siapa saja pelanggan saya?",
  "Siapa saja pemasok saya?",
  "Rincikan penjualan per pelanggan",
  "Berapa piutang yang belum tertagih?",
  "Berapa utang yang belum dibayar?",
  "Barang apa yang paling laris bulan ini?",
  "Stok barang apa yang menipis?",
  "Berapa laba kotor bulan ini?",
];

/**
 * Kirim pesan dan teruskan stream ke store global. Callback tidak menyentuh
 * state komponen, sehingga navigasi ke halaman lain tidak memutus proses.
 */
export async function sendChat(text: string, opts: { voice?: boolean } = {}): Promise<void> {
  const message = text.trim();
  if (!message || state.busy) return;

  if (message === "/contoh") {
    patch({
      msgs: [
        ...state.msgs,
        { role: "user", content: "/contoh" },
        {
          role: "ai",
          content:
            "Contoh pertanyaan yang bisa Anda tanyakan:\n" +
            CONTOH_TANYAAN.map((q, i) => `${i + 1}. ${q}`).join("\n") +
            "\n\nKetik salah satunya di kolom bawah — atau tekan mic dan ucapkan.",
        },
      ],
    });
    return;
  }

  const sessionId = state.sessionId;
  // buka izin audio saat gesture kirim — nanti notifikasi bisa berbunyi
  unlockChatSound();
  track("chat_send", { chars: message.length, voice: !!opts.voice });
  patch({
    busy: true,
    error: null,
    loadErr: null,
    booted: true,
    msgs: [
      ...state.msgs,
      { role: "user", content: message },
      { role: "ai", content: "", process: "Menganalisis pertanyaan…" },
    ],
  });

  await warmConnectionIfIdle();
  lastStreamAt = Date.now();

  try {
    await streamChat(
      message,
      sessionId,
      (e) => {
        if (e.type === "start" && e.sessionId) {
          saveLastSession(e.sessionId);
          patch({ sessionId: e.sessionId });
        }
        if (e.type === "error") {
          if (e.code === "langganan_ai_habis") {
            notifyAiGate("subscription");
            return;
          }
          if (e.code === "saldo_ai_habis" || e.code === "token_ai_habis") {
            notifyAiGate("token");
            return;
          }
        }

        patch((current) => {
          if (current.msgs.length === 0) return {};
          const copy = [...current.msgs];
          const last = { ...copy[copy.length - 1] };
          if (e.type === "tool_call") last.process = e.label || "Memproses data…";
          if (e.type === "tool_result") last.process = e.ok ? "Menyusun jawaban…" : "Mencoba cara lain…";
          if (e.type === "text_delta" || e.type === "done") last.process = undefined;
          if (e.type === "text_delta") last.content += e.delta;
          copy[copy.length - 1] = last;
          return {
            msgs: copy,
            ...(e.type === "error" ? { error: e.message } : {}),
            ...(e.type === "done" ? { busy: false } : {}),
          };
        });

        if (e.type === "done") {
          notifyAiWalletChanged();
          void listSessions(50, 0).catch(() => null);
          const last = state.msgs[state.msgs.length - 1];
          if (last?.role === "ai" && last.content) notifyChatReply(last.content);
        }
      },
      AbortSignal.timeout(CHAT_TIMEOUT_MS),
      opts.voice
    );
  } catch (e) {
    console.error("[chat] stream failed:", e);
    patch({
      error: isTimeoutError(e)
        ? "Waktu tunggu habis (2 menit) — coba lagi."
        : "Koneksi terputus — coba lagi.",
    });
  } finally {
    lastStreamAt = Date.now();
    if (state.busy) patch({ busy: false });
  }
}
