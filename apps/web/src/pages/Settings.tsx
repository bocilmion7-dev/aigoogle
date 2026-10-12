import { useEffect, useState } from "react";
import { getMe } from "../api";

const card: React.CSSProperties = {
  border: "1px solid #e3ddd4", borderRadius: 6, padding: 16, marginBottom: 12,
  background: "#faf8f5", fontFamily: "system-ui",
};

export function Settings() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);

  useEffect(() => {
    void getMe().then(setMe);
  }, []);

  if (me === undefined) return <p style={{ padding: 24, fontFamily: "system-ui" }}>Memuat…</p>;
  if (me === null) {
    window.location.href = "/login";
    return null;
  }

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 560, margin: "40px auto", padding: 24 }}>
      <h1 style={{ fontSize: 24 }}>Pengaturan</h1>
      <p style={{ color: "#666" }}>{me.tenant.name} · {me.email}</p>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Akun</h2>
      <div style={card}>
        <strong>Login password</strong>
        <p style={{ color: "#666", fontSize: 14 }}>
          Email: {me.email}
          {me.needsPassword ? " · belum diset" : " · sudah aktif"}
        </p>
        <p style={{ color: "#666", fontSize: 13 }}>
          Lupa password? Reset via WhatsApp menyusul. Untuk sekarang, hubungi administrator sistem Anda.
        </p>
      </div>

      <div style={card}>
        <strong>Pengaturan aplikasi</strong>
        <p style={{ color: "#666", fontSize: 13 }}>
          Vision &amp; OCR, mesin suara, biaya WhatsApp, otomasi, dan koneksi diatur oleh Admin
          di menu <b>Admin</b> → tab <b>Pengaturan</b>.
        </p>
      </div>
      <a href="/app" style={{ color: "#3d6b54", fontSize: 14 }}>← Kembali</a>
    </main>
  );
}
