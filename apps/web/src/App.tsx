import { Landing } from "./pages/Landing";
import { Shell } from "./pages/Shell";
import { Settings } from "./pages/Settings";
import { Explore } from "./pages/Explore";
import { Admin } from "./pages/Admin";
import { Login } from "./pages/Login";
import { SetPassword } from "./pages/SetPassword";
import { WhatsApp } from "./pages/WhatsApp";
import { WaChats } from "./pages/WaChats";
import { Orders } from "./pages/Orders";
import { Lacak } from "./pages/Lacak";
import { Insight } from "./pages/Insight";
import { Sandbox } from "./pages/Sandbox";
import { Pelanggan } from "./pages/Pelanggan";
import { Aktivitas } from "./pages/Aktivitas";
import { PlatformLogin } from "./pages/PlatformLogin";
import { AiProviders } from "./pages/AiProviders";
import { AiModels } from "./pages/AiModels";
import { Saldo } from "./pages/Saldo";
import { Subscription } from "./pages/Subscription";
import { InstallPrompt } from "./install-prompt";
import { AiGate } from "./ai-gate";
import { AiAccessGuard } from "./ai-access-guard";

function pageFor(path: string) {
  if (path === "/insight") return <Insight />;
  if (path === "/settings") return <Settings />;
  if (path === "/ai") return <AiProviders />;
  if (path === "/ai-models") return <AiModels />;
  if (path === "/explore") return <Explore />;
  if (path === "/admin") return <Admin />;
  if (path === "/app") return <Shell />;
  if (path === "/saldo") return <Saldo />;
  if (path === "/subscription") return <Subscription />;
  if (path === "/login") return <Login />;
  if (path === "/platform") return <PlatformLogin />;
  if (path === "/set-password") return <SetPassword />;
  if (path === "/whatsapp") return <WhatsApp />;
  if (path === "/wa-chats") return <WaChats />;
  if (path === "/pesanan") return <Orders />;
  if (path.startsWith("/lacak/")) return <Lacak orderId={decodeURIComponent(path.slice("/lacak/".length))} />;
  if (path === "/sandbox") return <Sandbox />;
  if (path === "/pelanggan") return <Pelanggan />;
  if (path === "/aktivitas") return <Aktivitas />;
  return <Landing />;
}

export function App() {
  return (
    <>
      <InstallPrompt />
      <AiAccessGuard />
      <AiGate />
      {pageFor(window.location.pathname)}
    </>
  );
}
