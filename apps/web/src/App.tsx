import { lazy, Suspense, useEffect, useState } from "react";
import { getLastSessionError, getMe, type SessionError } from "./session-api";
import { track } from "./telemetry";

/* Halaman aplikasi dimuat belakangan (code-split): klien hanya mengunduh JS
 * untuk halaman yang dibuka. Sebelumnya seluruh 24 halaman ikut dalam satu
 * bundel 451 KB (~70% tidak terpakai di landing) sehingga LCP mobile lambat. */
const Landing = lazy(() => import("./pages/Landing").then((m) => ({ default: m.Landing })));
const Shell = lazy(() => import("./pages/Shell").then((m) => ({ default: m.Shell })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const Account = lazy(() => import("./pages/Account").then((m) => ({ default: m.Account })));
const Explore = lazy(() => import("./pages/Explore").then((m) => ({ default: m.Explore })));
const Admin = lazy(() => import("./pages/Admin").then((m) => ({ default: m.Admin })));
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword").then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import("./pages/ResetPassword").then((m) => ({ default: m.ResetPassword })));
const TwoFactor = lazy(() => import("./pages/TwoFactor").then((m) => ({ default: m.TwoFactor })));
const Otp = lazy(() => import("./pages/Otp").then((m) => ({ default: m.Otp })));
const SetPassword = lazy(() => import("./pages/SetPassword").then((m) => ({ default: m.SetPassword })));
const WhatsApp = lazy(() => import("./pages/WhatsApp").then((m) => ({ default: m.WhatsApp })));
const WaChats = lazy(() => import("./pages/WaChats").then((m) => ({ default: m.WaChats })));
const Orders = lazy(() => import("./pages/Orders").then((m) => ({ default: m.Orders })));
const Lacak = lazy(() => import("./pages/Lacak").then((m) => ({ default: m.Lacak })));
const Insight = lazy(() => import("./pages/Insight").then((m) => ({ default: m.Insight })));
const Penjualan = lazy(() => import("./pages/Penjualan").then((m) => ({ default: m.Penjualan })));
const Toko = lazy(() => import("./pages/Toko").then((m) => ({ default: m.Toko })));
const Template = lazy(() => import("./pages/Template").then((m) => ({ default: m.Template })));
const Produk = lazy(() => import("./pages/Produk").then((m) => ({ default: m.Produk })));
const ProdukEdit = lazy(() => import("./pages/ProdukEdit").then((m) => ({ default: m.ProdukEdit })));
const Analisa = lazy(() => import("./pages/Analisa").then((m) => ({ default: m.Analisa })));
const Panduan = lazy(() => import("./pages/Panduan").then((m) => ({ default: m.Panduan })));
const Dokumentasi = lazy(() => import("./pages/Dokumentasi").then((m) => ({ default: m.Dokumentasi })));
const Sandbox = lazy(() => import("./pages/Sandbox").then((m) => ({ default: m.Sandbox })));
const Pelanggan = lazy(() => import("./pages/Pelanggan").then((m) => ({ default: m.Pelanggan })));
const Aktivitas = lazy(() => import("./pages/Aktivitas").then((m) => ({ default: m.Aktivitas })));
const PlatformLogin = lazy(() => import("./pages/PlatformLogin").then((m) => ({ default: m.PlatformLogin })));
const AiProviders = lazy(() => import("./pages/AiProviders").then((m) => ({ default: m.AiProviders })));
const AiModels = lazy(() => import("./pages/AiModels").then((m) => ({ default: m.AiModels })));
const Saldo = lazy(() => import("./pages/Saldo").then((m) => ({ default: m.Saldo })));
const Subscription = lazy(() => import("./pages/Subscription").then((m) => ({ default: m.Subscription })));
const RefundPolicy = lazy(() => import("./pages/RefundPolicy").then((m) => ({ default: m.RefundPolicy })));
const Storefront = lazy(() => import("./pages/Storefront").then((m) => ({ default: m.Storefront })));

import { InstallPrompt } from "./install-prompt";
import { AiGate } from "./ai-gate";
import { AiAccessGuard } from "./ai-access-guard";
import { PageBoundary } from "./page-boundary";
import { ChatReplyToast } from "./chat-reply-toast";

/** Fallback saat chunk halaman sedang diunduh (biasanya < 300 ms). */
function PageFallback() {
  return (
    <div className="app">
      <main className="page page--narrow">
        <div className="page-loader" role="status" aria-live="polite">
          <span className="spinner spinner--lg" aria-hidden="true" />
          <span className="page-loader__label">Memuat…</span>
        </div>
      </main>
    </div>
  );
}

function pageFor(path: string) {
  if (path === "/insight") return <Insight />;
  if (path === "/penjualan") return <Penjualan />;
  if (path === "/toko") return <Toko />;
  if (path === "/template") return <Template />;
  if (path === "/produk") return <Produk />;
  if (path.startsWith("/produk/")) return <ProdukEdit id={decodeURIComponent(path.slice("/produk/".length))} />;
  if (path === "/analisa") return <Analisa />;
  if (path === "/panduan") return <Panduan />;
  if (path === "/dokumentasi") return <Dokumentasi />;
  if (path === "/settings") return <Settings />;
  if (path === "/akun") return <Account />;
  if (path === "/ai") return <AiProviders />;
  if (path === "/ai-models") return <AiModels />;
  if (path === "/explore") return <Explore />;
  if (path === "/admin") return <Admin />;
  if (path === "/app") return <Shell />;
  if (path === "/saldo") return <Saldo />;
  if (path === "/subscription") return <Subscription />;
  if (path === "/login") return <Login />;
  if (path === "/forgot-password") return <ForgotPassword />;
  if (path === "/reset-password") return <ResetPassword />;
  if (path === "/2fa") return <TwoFactor />;
  if (path === "/otp") return <Otp />;
  if (path === "/platform") return <PlatformLogin />;
  if (path === "/set-password") return <SetPassword />;
  if (path === "/whatsapp") return <WhatsApp />;
  if (path === "/wa-chats") return <WaChats />;
  if (path === "/pesanan") return <Orders />;
  if (path === "/refund") return <RefundPolicy />;
  if (path.startsWith("/t/")) {
    const rest = path.slice(3).split("/");
    return <Storefront slug={decodeURIComponent(rest[0] ?? "")} subpath={rest.slice(1).join("/")} />;
  }
  if (path.startsWith("/lacak/")) return <Lacak orderId={decodeURIComponent(path.slice("/lacak/".length))} />;
  if (path === "/sandbox") return <Sandbox />;
  if (path === "/pelanggan") return <Pelanggan />;
  if (path === "/aktivitas") return <Aktivitas />;
  return <Landing />;
}

const PUBLIC_PREFIXES = [
  "/login",
  "/platform",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/2fa",
  "/otp",
  "/lacak/",
  "/dokumentasi",
  "/panduan",
  "/refund",
  "/t/",
];

function isPublicPath(path: string): boolean {
  if (path === "/") return true;
  return PUBLIC_PREFIXES.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p));
}

/** Muat ulang paksa: lepaskan service worker lama + buang cache HTML/aset. */
async function hardReload(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("aigoogle-shell-")).map((k) => caches.delete(k)));
    }
  } catch {
    /* tetap reload */
  }
  const u = new URL(window.location.href);
  u.searchParams.set("_r", Date.now().toString(36));
  window.location.replace(u.toString());
}

export function App() {
  const [route, setRoute] = useState(() => window.location.pathname + window.location.search);
  const path = route.split("?")[0] ?? "/";
  const publicPage = isPublicPath(path);
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [sessionError, setSessionError] = useState<SessionError>(null);
  const [sessionAttempt, setSessionAttempt] = useState(0);

  useEffect(() => {
    const sync = () => setRoute(window.location.pathname + window.location.search);
    window.addEventListener("popstate", sync);
    window.addEventListener("aigoogle:navigate", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("aigoogle:navigate", sync);
    };
  }, []);

  useEffect(() => {
    const robot = path === "/" || path === "/dokumentasi" || path === "/insight";
    document.documentElement.classList.toggle("font-robot", robot);
  }, [path]);

  useEffect(() => {
    track("page_view", { path, public: publicPage });
  }, [publicPage, path, route]);

  // Cukup cek sesi sekali per mount; navigasi antar halaman tidak perlu /api/me lagi.
  useEffect(() => {
    if (publicPage || me !== undefined) return;
    void getMe(sessionAttempt > 0).then((m) => {
      setMe(m);
      setSessionError(m ? null : getLastSessionError());
    });
  }, [publicPage, me, sessionAttempt]);

  useEffect(() => {
    if (!publicPage && me === null && sessionError === "auth") window.location.replace("/login");
  }, [publicPage, me, sessionError]);

  if (!publicPage && me === undefined) return <PageFallback />;
  if (!publicPage && me === null && sessionError === "network") {
    return (
      <div className="app">
        <main className="page page--narrow">
          <div className="card" role="alert">
            <strong className="card__title">Koneksi ke server bermasalah</strong>
            <p style={{ margin: "var(--space-2xs) 0 0", color: "var(--ink-2)" }}>
              Sesi Anda belum bisa diverifikasi karena jaringan atau server lambat. Data Anda tidak dihapus.
            </p>
            <div className="btn-row" style={{ marginTop: "var(--space-s)" }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setSessionError(null);
                  setMe(undefined);
                  setSessionAttempt((n) => n + 1);
                }}
              >
                Coba lagi
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void hardReload()}
              >
                Muat ulang
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }
  if (!publicPage && me === null) return null;

  return (
    <>
      <InstallPrompt />
      {!publicPage && <AiAccessGuard />}
      {!publicPage && <ChatReplyToast />}
      <AiGate />
      <PageBoundary>
        <Suspense key={route} fallback={<PageFallback />}>
          {pageFor(path)}
        </Suspense>
      </PageBoundary>
    </>
  );
}
