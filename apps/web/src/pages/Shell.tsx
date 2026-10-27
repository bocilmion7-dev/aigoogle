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
  useEffect(() => {
    if (me === null) window.location.href = "/";
    else if (me?.needsPassword) window.location.href = "/set-password";
    else if (me?.permissions?.includes("app:settings.manage")) window.location.replace("/admin");
  }, [me]);
  if (me === undefined) {
    return (
      <div className="app">
        <main className="page page--narrow">
          <PageLoader />
        </main>
      </div>
    );
  }
  if (me === null || me.needsPassword || me.permissions?.includes("app:settings.manage")) return null;
  return (
    <div className="app app--chat">
      <AppHeader me={me} />
      <Chat />
    </div>
  );
}
