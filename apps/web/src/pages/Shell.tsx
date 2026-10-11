import { useEffect, useState } from "react";
import type { Me } from "@aigoogle/shared";
import { getMe } from "../api";
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
  return (
    <div style={{ fontFamily: "system-ui" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 16px",
          borderBottom: "1px solid #e3ddd4",
          background: "#faf8f5",
        }}
      >
        <strong style={{ color: "#3d6b54" }}>{me.tenant.name}</strong>
        <span style={{ fontSize: 13, color: "#666" }}>
          {me.name} · {me.roleKey} ·{" "}
          <a href="/explore" style={{ color: "#3d6b54" }}>
            Explore Manager
          </a>{" "}
          ·{" "}
          {me.permissions?.includes("app:users.manage") && (
            <>
              <a href="/admin" style={{ color: "#3d6b54" }}>
                Admin
              </a>{" "}
              ·{" "}
            </>
          )}
          <a href="/settings" style={{ color: "#3d6b54" }}>
            Pengaturan
          </a>
        </span>
      </header>
      <Chat />
    </div>
  );
}
