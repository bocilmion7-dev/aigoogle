import { Landing } from "./pages/Landing";
import { Shell } from "./pages/Shell";
import { Settings } from "./pages/Settings";
import { Explore } from "./pages/Explore";
import { Admin } from "./pages/Admin";

export function App() {
  const path = window.location.pathname;
  if (path === "/settings") return <Settings />;
  if (path === "/explore") return <Explore />;
  if (path === "/admin") return <Admin />;
  if (path === "/app") return <Shell />;
  return <Landing />;
}
