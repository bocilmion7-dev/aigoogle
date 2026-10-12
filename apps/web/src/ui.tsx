import { useEffect, useState } from "react";
import type { Me } from "@aigoogle/shared";
import { getMe } from "./api";

/**
 * Header bersama semua halaman aplikasi (kecuali Landing).
 * Isi menu mengikuti hak user: Admin hanya bila app:users.manage,
 * Pelanggan hanya bila accurate:customer.view.
 * Bila `me` tidak diberikan, komponen memuat /api/me sendiri.
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
  const isAdmin = perms.includes("app:users.manage");
  // Aturan menu:
  //  - Pelanggan Accurate : Dashboard, Explore Manager, Pelanggan, WhatsApp
  //  - Admin (platform)   : semua menu (4 di atas + Admin + Pengaturan)
  const links: Array<{ href: string; label: string }> = isAdmin
    ? [
        { href: "/app", label: "Dashboard" },
        { href: "/pelanggan", label: "Pelanggan" },
        { href: "/explore", label: "Explore Manager" },
        { href: "/whatsapp", label: "WhatsApp" },
        { href: "/admin", label: "Admin" },
        { href: "/settings", label: "Pengaturan" },
      ]
    : [
        { href: "/app", label: "Dashboard" },
        { href: "/pelanggan", label: "Pelanggan" },
        { href: "/explore", label: "Explore Manager" },
        { href: "/whatsapp", label: "WhatsApp" },
      ];

  return (
    <header className="app-header">
      <div className="app-header__bar">
        <a className="app-header__brand" href="/app">
          {data.tenant.name}
        </a>
        <span className="app-header__user">
          {data.name} · {data.roleKey}
        </span>
      </div>
      <nav className="app-header__nav" aria-label="Menu utama">
        {links.map((l) => (
          <a
            key={l.href}
            className="nav-link"
            href={l.href}
            aria-current={cur === l.href ? "page" : undefined}
          >
            {l.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
