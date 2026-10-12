import { Landing } from "./pages/Landing";
import { Shell } from "./pages/Shell";
import { Settings } from "./pages/Settings";
import { Explore } from "./pages/Explore";
import { Admin } from "./pages/Admin";
import { Login } from "./pages/Login";
import { SetPassword } from "./pages/SetPassword";
import { WhatsApp } from "./pages/WhatsApp";
import { Pelanggan } from "./pages/Pelanggan";
import { Aktivitas } from "./pages/Aktivitas";

export function App() {
  const path = window.location.pathname;
  if (path === "/settings") return <Settings />;
  if (path === "/explore") return <Explore />;
  if (path === "/admin") return <Admin />;
  if (path === "/app") return <Shell />;
  if (path === "/login") return <Login />;
  if (path === "/set-password") return <SetPassword />;
  if (path === "/whatsapp") return <WhatsApp />;
  if (path === "/pelanggan") return <Pelanggan />;
  if (path === "/aktivitas") return <Aktivitas />;
  return <Landing />;
}
