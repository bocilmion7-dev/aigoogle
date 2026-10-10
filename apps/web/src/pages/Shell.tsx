import { useEffect, useState } from "react";
import type { Me } from "@aigoogle/shared";
import { getMe } from "../api";

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
    <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "48px auto", padding: 24 }}>
      <h1 style={{ fontSize: 24 }}>{me.tenant.name}</h1>
      <p style={{ color: "#555" }}>
        Halo, {me.name} ({me.roleKey}). Chat AI &amp; Explore Manager menyusul di fase berikutnya.
      </p>
      <a href="/settings" style={{ color: "#3d6b54" }}>Pengaturan →</a>
    </main>
  );
}
