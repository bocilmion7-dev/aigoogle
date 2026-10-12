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
  const links: Array<{ href: string; label: string }> = [
    { href: "/app", label: "Dashboard" },
    ...(perms.includes("accurate:customer.view") ? [{ href: "/pelanggan", label: "Pelanggan" }] : []),
    { href: "/explore", label: "Explore Manager" },
    { href: "/whatsapp", label: "WhatsApp" },
    ...(perms.includes("app:users.manage") ? [{ href: "/admin", label: "Admin" }] : []),
    { href: "/settings", label: "Pengaturan" },
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
