import "./app.css";
import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import type { Me } from "@aigoogle/shared";
import {
  AI_WALLET_EVENT,
  endImpersonation,
  getAiWallet,
  getCompanies,
  getMe,
  resetSessionCache,
  switchCompany,
  type CompanyRow,
} from "./api";
import {
  IconActivity,
  IconChat,
  IconCoin,
  IconCompass,
  IconCpu,
  IconFileText,
  IconLayout,
  IconLogout,
  IconMore,
  IconNews,
  IconPackage,
  IconScan,
  IconSettings,
  IconSliders,
  IconUsers,
  IconWallet,
  IconWalletBlock,
} from "./icons";

interface NavLink {
  href: string;
  label: string;
  short: string;
  hidden?: boolean;
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [switching, setSwitching] = useState(false);
  const [companyErr, setCompanyErr] = useState("");
  const [pendingCompany, setPendingCompany] = useState<CompanyRow | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (me === undefined) void getMe().then(setOwn);
  }, [me]);
  const dataForBalance = me !== undefined ? me : own;
  useEffect(() => {
    if (!dataForBalance || dataForBalance.tenant.provider === "platform") return;
    const load = (force = false) => {
      void getAiWallet(force)
        .then((w) => setTokens(w.balanceTokens))
        .catch(() => null);
    };
    // Debounce: focus + visibilitychange sering berpasangan saat user pindah tab.
    let lastRefresh = 0;
    const onRefresh = () => {
      const now = Date.now();
      if (now - lastRefresh < 2_000) return;
      lastRefresh = now;
      load(true);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onRefresh();
    };
    load();
    window.addEventListener("focus", onRefresh);
    window.addEventListener(AI_WALLET_EVENT, onRefresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(AI_WALLET_EVENT, onRefresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [dataForBalance]);

  // Multi-company: daftar DB Accurate milik akun ini.
  useEffect(() => {
    if (!dataForBalance || dataForBalance.tenant.provider === "platform") return;
    void getCompanies()
      .then(setCompanies)
      .catch(() => setCompanies([]));
  }, [dataForBalance]);

  // Drawer: kunci scroll body + tutup dengan Escape selama terbuka.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    drawerRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

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
    ...(sisiAccurate ? [{ href: "/insight", label: "Insight", short: "Insight", Icon: IconNews }] : []),
    ...(sisiAccurate ? [{ href: "/app", label: "AI Asisten", short: "AI", Icon: IconCpu }] : []),
    ...(sisiAccurate ? [{ href: "/whatsapp", label: "WhatsApp", short: "WhatsApp", Icon: IconChat }] : []),
    ...(sisiAccurate ? [{ href: "/pesanan", label: "Kelola Pesanan", short: "Pesanan", Icon: IconPackage }] : []),
    ...(canAdmin && !canPlatform
      ? [{ href: "/template", label: "Template Storefront", short: "Template", Icon: IconLayout }]
      : []),
    ...(canAdmin && !canPlatform
      ? [{ href: "/produk", label: "Produk Storefront", short: "Produk", Icon: IconPackage }]
      : []),
    ...(canAdmin && !canPlatform
      ? [{ href: "/aktivitas", label: "Aktivitas", short: "Aktivitas", hidden: true, Icon: IconActivity }]
      : []),
    // Scan tetap ada (tidak dihapus) — hanya disembunyikan dari bottom bar
    ...(sisiAccurate ? [{ href: "/pelanggan", label: "Scan", short: "Scan", hidden: true, Icon: IconScan }] : []),
    ...(canPlatform ? [{ href: "/settings", label: "Pengaturan", short: "Setelan", Icon: IconSettings }] : []),
    ...(canPlatform ? [{ href: "/ai", label: "AI Provider", short: "AI", Icon: IconCpu }] : []),
    ...(canPlatform ? [{ href: "/ai-models", label: "Model per Modul", short: "Model", Icon: IconSliders }] : []),
  ];

  // Item yang dipindah dari bottom bar ke drawer "Lainnya"
  const drawerLinks: NavLink[] = [
    { href: "/akun", label: "Akun & Keamanan", short: "Akun", Icon: IconUsers },
    ...(sisiAccurate ? [{ href: "/analisa", label: "Analisis Bisnis", short: "Analisa", Icon: IconActivity }] : []),
    ...(sisiAccurate ? [{ href: "/toko", label: "Akun Toko", short: "Akun Toko", Icon: IconPackage }] : []),
    ...(sisiAccurate ? [{ href: "/explore", label: "Explore Manager", short: "Explore", Icon: IconCompass }] : []),
    ...(canAdmin && !canPlatform
      ? [{ href: "/admin", label: "User & Peran", short: "Role Akses", Icon: IconUsers }]
      : []),
    ...(sisiAccurate ? [{ href: "/penjualan", label: "Penjualan", short: "Penjualan", Icon: IconCoin }] : []),
    ...(sisiAccurate
      ? [{ href: "/panduan", label: "Panduan Penggunaan", short: "Panduan", Icon: IconFileText }]
      : []),
  ];

  const isPlatform = data.tenant.provider === "platform";
  const currentCompany = companies.find((c) => c.current) ?? companies[0];

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 8_000);
    try {
      await fetch("/api/logout", { method: "POST", signal: ctrl.signal });
    } catch {
      /* tetap lanjut ke halaman login meski jaringan lambat */
    } finally {
      window.clearTimeout(timer);
    }
    resetSessionCache();
    window.location.href = isPlatform ? "/platform" : "/login";
  }

  async function stopImpersonation() {
    await endImpersonation().catch(() => null);
    resetSessionCache();
    window.location.href = "/admin";
  }

  function requestCompanyChange(providerDbId: string) {
    const target = companies.find((c) => c.providerDbId === providerDbId);
    if (!target || target.current) return;
    setCompanyErr("");
    setPendingCompany(target);
  }

  async function confirmCompanyChange() {
    if (!pendingCompany || switching) return;
    setSwitching(true);
    setCompanyErr("");
    try {
      await switchCompany(pendingCompany.providerDbId);
      window.location.href = "/app";
    } catch (e) {
      setCompanyErr(e instanceof Error ? e.message : "Gagal ganti perusahaan.");
      setSwitching(false);
      setPendingCompany(null);
    }
  }

  return (
    <>
      {data.impersonated && (
        <div className="banner banner--err" role="status" style={{ margin: 0, borderRadius: 0 }}>
          Mode impersonasi sebagai <strong>{data.name}</strong>.{" "}
          <button className="btn btn--ghost btn--sm" onClick={() => void stopImpersonation()}>
            Keluar
          </button>
        </div>
      )}
      <header className="app-header">
        <div className="app-header__bar">
          <a className="app-header__brand app-header__brand--logo" href="/app" aria-label="AI Asisten — beranda">
            <img src="/logo-ai-asisten.webp" alt="AI Asisten" className="app-header__logo" width={126} height={42} />
          </a>
          <span className="app-header__user">
            <span className="app-header__name">
              {data.name}
              <span className="app-header__role"> · {data.roleKey}</span>
              {!isPlatform && <span className="app-header__company">{data.tenant.name}</span>}
            </span>
            {tokens !== null && data.tenant.provider !== "platform" && (
              <a className="app-header__balance" href="/saldo" title="Saldo token AI & pemakaian">
                <IconCoin size={13} /> <strong>{tokens.toLocaleString("id-ID")}</strong>
              </a>
            )}
          </span>
          <a className="header-wallet" href="/penjualan" aria-label="Wallet penjualan" title="Wallet Penjualan">
            <IconWalletBlock size={30} />
          </a>
        </div>
      </header>
      <nav className="bottom-nav" aria-label="Menu utama">
        {links.map(({ href, label, short, hidden, Icon }) => (
          <a
            key={href}
            className={`bottom-nav__item${hidden ? " bottom-nav__item--hidden" : ""}`}
            href={href}
            title={label}
            aria-label={label}
            aria-current={cur === href || (href === "/produk" && cur.startsWith("/produk/")) ? "page" : undefined}
          >
            <span className="bottom-nav__chip">
              <Icon size={20} />
            </span>
            <span className="bottom-nav__label">{short}</span>
          </a>
        ))}
        {drawerLinks.length > 0 && (
          <button
            type="button"
            className="bottom-nav__item bottom-nav__item--more"
            onClick={() => setDrawerOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            title="Lainnya"
          >
            <span className="bottom-nav__chip">
              <IconMore size={20} />
            </span>
            <span className="bottom-nav__label">Lainnya</span>
          </button>
        )}
      </nav>

      {drawerOpen && (
        <div className="nav-drawer" ref={drawerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Menu Lainnya">
          <div className="nav-drawer__backdrop" onClick={() => setDrawerOpen(false)} />
          <aside className="nav-drawer__panel" aria-label="Navigasi Lainnya">
            <div className="nav-drawer__head">
              <strong>Lainnya</strong>
              <button type="button" className="modal__x" onClick={() => setDrawerOpen(false)} aria-label="Tutup">
                ×
              </button>
            </div>
            {!isPlatform && companies.length > 1 && (
              <label className="nav-drawer__company">
                <span>Perusahaan</span>
                <select
                  className="select"
                  value={currentCompany?.providerDbId ?? ""}
                  onChange={(e) => requestCompanyChange(e.target.value)}
                  disabled={switching}
                  aria-label="Pilih perusahaan Accurate"
                >
                  {companies.map((c) => (
                    <option key={c.providerDbId} value={c.providerDbId}>
                      {c.name}{c.alias ? ` (${c.alias})` : ""}
                    </option>
                  ))}
                </select>
                {companyErr && <span className="nav-drawer__company-err">{companyErr}</span>}
              </label>
            )}
            {!isPlatform && companies.length === 1 && (
              <div className="nav-drawer__company-single">
                Perusahaan: <strong>{companies[0]!.name}</strong>
              </div>
            )}
            <div className="nav-drawer__list">
              {drawerLinks.map(({ href, label, short, Icon }) => (
                <a key={href} className="nav-drawer__item" href={href} onClick={() => setDrawerOpen(false)} aria-current={cur === href ? "page" : undefined}>
                  <span className="nav-drawer__chip">
                    <Icon size={20} />
                  </span>
                  <span className="nav-drawer__label">{short}</span>
                </a>
              ))}
            </div>
            <div className="nav-drawer__foot">
              <button
                type="button"
                className="nav-drawer__logout"
                onClick={() => void logout()}
                disabled={loggingOut}
                aria-busy={loggingOut}
              >
                <span className="nav-drawer__chip">
                  {loggingOut ? <span className="spinner" aria-hidden="true" /> : <IconLogout size={20} />}
                </span>
                <span className="nav-drawer__label">{loggingOut ? "Keluar…" : "Keluar"}</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {pendingCompany && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => {
            if (!switching) setPendingCompany(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="switch-company-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__head">
              <strong className="card__title" id="switch-company-title">Ganti perusahaan?</strong>
              <button
                type="button"
                className="modal__x"
                aria-label="Tutup"
                onClick={() => { if (!switching) setPendingCompany(null); }}
              >
                ×
              </button>
            </div>
            <p style={{ margin: 0 }}>
              Anda akan beralih ke <strong>{pendingCompany.name}</strong>
              {pendingCompany.alias ? ` (${pendingCompany.alias})` : ""}.
            </p>
            <ul className="meta" style={{ margin: "10px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
              <li>Data Accurate, chat, Drive, WhatsApp, pesanan, saldo, dan langganan akan berganti.</li>
              <li>Data perusahaan lama tidak dihapus dan tetap terisolasi.</li>
              <li>Role & izin bisa berbeda di perusahaan tujuan.</li>
            </ul>
            {companyErr && <p className="banner banner--err" role="alert" style={{ marginBottom: 0 }}>{companyErr}</p>}
            <div className="modal__foot">
              <button className="btn btn--ghost" type="button" onClick={() => setPendingCompany(null)} disabled={switching}>
                Batal
              </button>
              <button className="btn" type="button" onClick={() => void confirmCompanyChange()} disabled={switching}>
                {switching ? "Memproses…" : "Ganti perusahaan"}
              </button>
            </div>
          </div>
        </div>
      )}
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
