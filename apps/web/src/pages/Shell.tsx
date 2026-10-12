import { useEffect, useState } from "react";
import type { Me } from "@aigoogle/shared";
import { getMe } from "../api";
import { AppHeader } from "../ui";
import { Chat } from "./Chat";

export function Shell() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    void getMe().then(setMe);
  }, []);
  if (me === undefined) return <p style={{ padding: 24 }}>Memuat…</p>;
  if (me === null) {
    window.location.href = "/";
    return null;
  }
  if (me.needsPassword) {
    window.location.href = "/set-password";
    return null;
  }
  return (
    <div className="app">
      <AppHeader me={me} />
      <Chat />
    </div>
  );
}
