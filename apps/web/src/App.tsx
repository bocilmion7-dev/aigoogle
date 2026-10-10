import { Landing } from "./pages/Landing";
import { Shell } from "./pages/Shell";
import { Settings } from "./pages/Settings";
import { Explore } from "./pages/Explore";

export function App() {
  const path = window.location.pathname;
  if (path === "/settings") return <Settings />;
  if (path === "/explore") return <Explore />;
  if (path === "/app") return <Shell />;
  return <Landing />;
}
