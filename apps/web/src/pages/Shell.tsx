import { useEffect, useState } from "react";
import type { Me } from "@aigoogle/shared";
import { getMe } from "../api";
import { AppHeader, PageLoader } from "../ui";
import { Chat } from "./Chat";

export function Shell() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    void getMe().then(setMe);
  }, []);
  if (me === undefined) {
    return (
      <div className="app">
        <main className="page page--narrow">
          <PageLoader />
        </main>
      </div>
    );
  }
  if (me === null) {
    window.location.href = "/";
    return null;
  }
  if (me.needsPassword) {
    window.location.href = "/set-password";
    return null;
  }
  // Admin Platform tidak punya Dashboard — langsung ke kelola User & Peran
  if (me.permissions?.includes("app:settings.manage")) {
    window.location.replace("/admin");
    return null;
  }
  return (
    <div className="app">
      <AppHeader me={me} />
      <Chat />
    </div>
  );
}
