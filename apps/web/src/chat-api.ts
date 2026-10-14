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

export async function listSessions(): Promise<SessionInfo[]> {
  const res = await fetch("/api/chat/sessions");
  return res.ok ? res.json() : [];
}

export async function listMessages(sessionId: string): Promise<MessageInfo[]> {
  const res = await fetch(`/api/chat/sessions/${sessionId}/messages`);
  return res.ok ? res.json() : [];
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
