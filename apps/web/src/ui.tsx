import { useEffect, useState } from "react";
import type { Me } from "@aigoogle/shared";
import { getMe } from "./api";

/**
 * Header bersama semua halaman aplikasi (kecuali Landing).
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
  const links: Array<{ href: string; label: string }> = [
    ...(sisiAccurate ? [{ href: "/app", label: "Dashboard" }] : []),
    ...(canAdmin && !canPlatform ? [{ href: "/aktivitas", label: "Aktivitas" }] : []),
    ...(sisiAccurate ? [{ href: "/explore", label: "Explore Manager" }] : []),
    ...(sisiAccurate ? [{ href: "/whatsapp", label: "WhatsApp" }] : []),
    ...(canAdmin ? [{ href: "/admin", label: "User & Peran" }] : []),
    ...(sisiAccurate ? [{ href: "/pelanggan", label: "Scan" }] : []),
    ...(canPlatform ? [{ href: "/settings", label: "Pengaturan" }] : []),
  ];

  const isPlatform = data.tenant.provider === "platform";

  async function logout() {
    await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = isPlatform ? "/platform" : "/login";
  }

  return (
    <header className="app-header">
      <div className="app-header__bar">
        <a className="app-header__brand" href="/app">
          {data.tenant.name}
        </a>
        <span className="app-header__user">
          {data.name} · {data.roleKey}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          style={{ marginLeft: "auto" }}
          onClick={() => void logout()}
          aria-label="Keluar dari akun"
        >
          Keluar
        </button>
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
