import { useEffect, useState } from "react";
import { IconBell } from "./icons";
import {
  chatNotificationPermission,
  dismissChatNotice,
  requestChatNotificationPermission,
  useChatNotice,
} from "./chat-notify";

/**
 * Notifikasi in-app saat AI selesai membalas tetapi pengguna sedang berada di
 * halaman lain. Tetap tampil sampai dibuka/ditutup supaya balasan tidak terlewat.
 */
export function ChatReplyToast() {
  const notice = useChatNotice();
  const [permission, setPermission] = useState(chatNotificationPermission());

  useEffect(() => {
    if (notice) setPermission(chatNotificationPermission());
  }, [notice]);

  if (!notice) return null;

  return (
    <aside className="chat-toast" role="status" aria-live="polite">
      <span className="chat-toast__icon" aria-hidden="true">
        <IconBell size={18} />
      </span>
      <div className="chat-toast__body">
        <strong className="chat-toast__title">AI sudah membalas</strong>
        <p className="chat-toast__preview">{notice.preview}</p>
        <div className="chat-toast__actions">
          <a className="chat-toast__link" href="/app" onClick={dismissChatNotice}>
            Buka chat
          </a>
          {permission === "default" && (
            <button
              type="button"
              className="chat-toast__enable"
              onClick={() => {
                void requestChatNotificationPermission().then(setPermission);
              }}
            >
              Aktifkan notif browser
            </button>
          )}
        </div>
      </div>
      <button
        type="button"
        className="chat-toast__close"
        onClick={dismissChatNotice}
        aria-label="Tutup notifikasi"
      >
        ×
      </button>
    </aside>
  );
}
