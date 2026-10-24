import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import type { Me } from "@aigoogle/shared";
import { getAiWallet, getMe } from "./api";
import {
  IconActivity,
  IconChat,
  IconCompass,
  IconCpu,
  IconHome,
  IconLogout,
  IconScan,
  IconSettings,
  IconSliders,
  IconUsers,
} from "./icons";

interface NavLink {
  href: string;
  label: string;
  short: string;
  Icon: ComponentType<{ size?: number }>;
}

/**
 * Header ramping + bottom bar navigasi untuk semua halaman aplikasi (kecuali Landing).
 * Isi menu mengikuti tingkat peran — akun platform & akun perusahaan
 * adalah login yang terpisah (tanpa dropdown pindah konteks).
 */
export function AppHeader({ me }: { me?: Me | null }) {
  const [own, setOwn] = useState<Me | null | undefined>(undefined);
  const [tokens, setTokens] = useState<number | null>(null);
  useEffect(() => {
    if (me === undefined) void getMe().then(setOwn);
  }, [me]);
  const dataForBalance = me !== undefined ? me : own;
  useEffect(() => {
    if (!dataForBalance || dataForBalance.tenant.provider === "platform") return;
    const load = () => {
      void getAiWallet()
        .then((w) => setTokens(w.balanceTokens))
        .catch(() => null);
    };
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [dataForBalance]);

  const data = me !== undefined ? me : own;
  if (data === undefined || data === null) return null;

  const cur = window.location.pathname;
  const perms = data.permissions ?? [];
  // Aturan isolasi menu final:
  //  - Staf Accurate      : Dashboard, Explore Manager, WhatsApp, Scan
  //  - Admin Accurate     : + Aktivitas (perusahaannya), User & Peran (perusahaannya)
  //  - Admin Platform     : User & Peran (semua perusahaan) + Pengaturan saja
  const canAdmin = perms.includes("app:users.manage");
  const canPlatform = perms.includes("app:settings.manage");
  const sisiAccurate = !canPlatform; // Staf & Admin Accurate
  const links: NavLink[] = [
    ...(sisiAccurate ? [{ href: "/app", label: "Dashboard", short: "Beranda", Icon: IconHome }] : []),
    ...(canAdmin && !canPlatform
      ? [{ href: "/aktivitas", label: "Aktivitas", short: "Aktivitas", Icon: IconActivity }]
      : []),
    ...(sisiAccurate
      ? [{ href: "/explore", label: "Explore Manager", short: "Explore", Icon: IconCompass }]
      : []),
    ...(sisiAccurate ? [{ href: "/whatsapp", label: "WhatsApp", short: "WhatsApp", Icon: IconChat }] : []),
    ...(canAdmin ? [{ href: "/admin", label: "User & Peran", short: "User", Icon: IconUsers }] : []),
    ...(sisiAccurate ? [{ href: "/pelanggan", label: "Scan", short: "Scan", Icon: IconScan }] : []),
    ...(canPlatform ? [{ href: "/settings", label: "Pengaturan", short: "Setelan", Icon: IconSettings }] : []),
    ...(canPlatform ? [{ href: "/ai", label: "AI Provider", short: "AI", Icon: IconCpu }] : []),
    ...(canPlatform ? [{ href: "/ai-models", label: "Model per Modul", short: "Model", Icon: IconSliders }] : []),
  ];

  const isPlatform = data.tenant.provider === "platform";

  async function logout() {
    await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = isPlatform ? "/platform" : "/login";
  }

  return (
    <>
      <header className="app-header">
        <div className="app-header__bar">
          <a className="app-header__brand app-header__brand--logo" href="/app" aria-label="AI Asisten — beranda">
            <img src="/logo.png" alt="AI Asisten" className="app-header__logo" />
          </a>
          <span className="app-header__user">
            <span className="app-header__name">
              {data.name}
              <span className="app-header__role"> · {data.roleKey}</span>
            </span>
            {tokens !== null && data.tenant.provider !== "platform" && (
              <a className="app-header__balance" href="/saldo" title="Saldo token AI & pemakaian">
                <strong>{tokens.toLocaleString("id-ID")}</strong> token
              </a>
            )}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void logout()}
            aria-label="Keluar dari akun"
            title="Keluar"
          >
            <IconLogout size={18} />
          </button>
        </div>
      </header>
      <nav className="bottom-nav" aria-label="Menu utama">
        {links.map(({ href, label, short, Icon }) => (
          <a
            key={href}
            className="bottom-nav__item"
            href={href}
            title={label}
            aria-label={label}
            aria-current={cur === href ? "page" : undefined}
          >
            <span className="bottom-nav__chip">
              <Icon size={20} />
            </span>
            <span className="bottom-nav__label">{short}</span>
          </a>
        ))}
      </nav>
    </>
  );
}

/** Overlay memuat — menutup area konten (di bawah header, di atas bottom bar). */
export function PageLoader({ label = "Memuat…" }: { label?: string }) {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <span className="spinner spinner--lg" aria-hidden="true" />
      <span className="page-loader__label">{label}</span>
    </div>
  );
}
