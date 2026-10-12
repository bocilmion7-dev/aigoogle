import { useEffect, useState } from "react";
import type { Me } from "@aigoogle/shared";
import { getMe, getMemberships, switchTenant, type Membership } from "./api";

/**
 * Header bersama semua halaman aplikasi (kecuali Landing).
 * Isi menu mengikuti tingkat peran. Bila user punya >1 identitas
 * (operator platform ⇄ perusahaannya; pemilik beberapa perusahaan),
 * tampil pemilih konteks yang menukar sesi ke identitas terpilih.
 */
export function AppHeader({ me }: { me?: Me | null }) {
  const [own, setOwn] = useState<Me | null | undefined>(undefined);
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  useEffect(() => {
    if (me === undefined) void getMe().then(setOwn);
  }, [me]);
  useEffect(() => {
    const data = me !== undefined ? me : own;
    if (!data) return;
    void getMemberships().then((m) => setMemberships(m.length > 1 ? m : null)).catch(() => undefined);
  }, [me, own]);

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

  return (
    <header className="app-header">
      <div className="app-header__bar">
        <a className="app-header__brand" href="/app">
          {data.tenant.name}
        </a>
        {memberships && (
          <select
            className="input"
            style={{ maxWidth: 260, padding: "4px 8px", fontSize: "0.85rem" }}
            value={data.tenant.id}
            onChange={(e) => {
              const target = e.target.value;
              if (target === data.tenant.id) return;
              void switchTenant(target).then(() => window.location.reload()).catch(() => window.location.reload());
            }}
            aria-label="Pindah konteks"
          >
            {memberships.map((m) => (
              <option key={m.tenantId} value={m.tenantId}>
                {m.provider === "platform" ? "⚙ AIGoogle Platform (sistem)" : m.name}
                {" — "}
                {m.roleKey === "platform-admin" ? "Admin Platform" : m.roleKey === "accurate-admin" ? "Admin" : "Staff"}
              </option>
            ))}
          </select>
        )}
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
