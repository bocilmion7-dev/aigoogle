export type ChatEvent =
  | { type: "start"; sessionId?: string }
  | { type: "tool_call"; tool: string; label?: string }
  | { type: "tool_result"; tool: string; ok: boolean }
  | { type: "text_delta"; delta: string }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

export interface SessionInfo {
  id: string;
  title: string;
  createdAt: string;
}
export interface MessageInfo {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

/**
 * Batas waktu 1 stream chat: 2 menit + margin 5 detik.
 * Server (tool-loop) punya deadline 120 dtk + waktu penyiapan route — margin ini
 * memastikan PESAN deadline dari server sempat dulu sampai ke klien, sehingga
 * user melihat penjelasan (bukan batal sendiri). Kalau koneksi benar-benar macet,
 * klien membatalkan sendiri — tak ada stream yg menggantung selamanya.
 */
export const CHAT_TIMEOUT_MS = 125_000;

/** Boot/riwayat: timeout 10 dtk — koneksi half-open setelah idle panjang
 *  jangan menggantung selamanya (PageLoader/spinner macet). */
const BOOT_TIMEOUT_MS = 10_000;

/** Abort/timeout dr klien sendiri — bedakan dgn putus koneksi beneran. */
export function isTimeoutError(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

export async function listSessions(): Promise<SessionInfo[]> {
  const res = await fetch("/api/chat/sessions", { signal: AbortSignal.timeout(BOOT_TIMEOUT_MS) });
  return res.ok ? res.json() : [];
}

export async function listMessages(sessionId: string): Promise<MessageInfo[]> {
  const res = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
    signal: AbortSignal.timeout(BOOT_TIMEOUT_MS),
  });
  return res.ok ? res.json() : [];
}

export interface CustomerName {
  name: string;
  customerNo: string;
}

/** nama pelanggan utk autocomplete "@" — gagal senyap → [] (chat tetap jalan tanpa saran) */
export async function listCustomerNames(): Promise<CustomerName[]> {
  try {
    const res = await fetch("/api/customers/names", { signal: AbortSignal.timeout(BOOT_TIMEOUT_MS) });
    if (!res.ok) return [];
    const rows: unknown = await res.json();
    return Array.isArray(rows) ? (rows as CustomerName[]) : [];
  } catch {
    return [];
  }
}

export async function streamChat(
  message: string,
  sessionId: string | null,
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
  voice?: boolean
): Promise<void> {
  const res = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      ...(sessionId ? { sessionId } : {}),
      ...(voice ? { voice: true } : {}),
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    onEvent({
      type: "error",
      message: res.status === 401 ? "Sesi berakhir — buka ulang dari Accurate." : "Gagal mengirim pesan.",
    });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line) as ChatEvent);
      } catch {
        /* baris belum utuh */
      }
    }
  }
}
