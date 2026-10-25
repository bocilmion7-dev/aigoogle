import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __installPrompt?: InstallPromptEvent | null;
  }
}

const DISMISS_KEY = "aigoogle:install-dismissed";
const INSTALLED_KEY = "aigoogle:installed";
const SNOOZE_MS = 3 * 86400_000;

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Ajakan install PWA — muncul saat web dibuka (Android/Chrome & iPhone/Safari). */
export function InstallPrompt() {
  const [open, setOpen] = useState(false);
  const [iosMode, setIosMode] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    try {
      if (localStorage.getItem(INSTALLED_KEY) === "1") return;
      const dismissed = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      if (Date.now() - dismissed < SNOOZE_MS) return;
    } catch {
      /* localStorage bisa diblokir */
    }

    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      setOpen(true);
    };
    const onInstallable = () => show();
    const onInstalled = () => {
      try {
        localStorage.setItem(INSTALLED_KEY, "1");
      } catch {
        /* abaikan */
      }
      setOpen(false);
    };
    window.addEventListener("aigoogle:installable", onInstallable);
    window.addEventListener("aigoogle:installed", onInstalled);

    let timer: number | undefined;
    if (window.__installPrompt) {
      timer = window.setTimeout(show, 900);
    } else if (isIos()) {
      setIosMode(true);
      timer = window.setTimeout(show, 1200);
    }

    return () => {
      window.removeEventListener("aigoogle:installable", onInstallable);
      window.removeEventListener("aigoogle:installed", onInstalled);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* abaikan */
    }
    setOpen(false);
  }

  async function install() {
    const p = window.__installPrompt;
    if (!p) {
      setIosMode(true);
      return;
    }
    await p.prompt().catch(() => undefined);
    await p.userChoice.catch(() => null);
    window.__installPrompt = null;
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={dismiss}>
      <div
        className="modal install-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="install-card__head">
          <img src="/icon-192.png" alt="" className="install-card__icon" width={56} height={56} />
          <div>
            <strong id="install-title" className="install-card__title">
              Install AI Asisten
            </strong>
            <span className="install-card__sub">Akses lebih cepat dari layar utama</span>
          </div>
        </div>
        {iosMode ? (
          <p className="meta" style={{ margin: 0 }}>
            Di iPhone/iPad: ketuk tombol <strong>Bagikan</strong> di Safari, lalu pilih{" "}
            <strong>Tambah ke Layar Utama</strong>.
          </p>
        ) : (
          <p className="meta" style={{ margin: 0 }}>
            Pasang aplikasi di perangkat Anda — tanpa buka browser dan bisa diakses langsung.
          </p>
        )}
        <div className="modal__foot">
          <button type="button" className="btn btn--2" onClick={dismiss}>
            {iosMode ? "Mengerti" : "Nanti"}
          </button>
          {!iosMode && (
            <button type="button" className="btn" onClick={() => void install()}>
              Install
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
