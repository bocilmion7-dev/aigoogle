import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import type { Me } from "@aigoogle/shared";
import { getMe } from "./api";
import {
  IconActivity,
  IconChat,
  IconCompass,
  IconHome,
  IconLogout,
  IconScan,
  IconSettings,
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
  useEffect(() => {
    if (me === undefined) void getMe().then(setOwn);
  }, [me]);

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
          <a className="app-header__brand" href="/app">
            {data.tenant.name}
          </a>
          <span className="app-header__user">
            {data.name}
            <span className="app-header__role"> · {data.roleKey}</span>
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
