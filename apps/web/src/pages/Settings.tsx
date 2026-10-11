import { useEffect, useState } from "react";
import type { AppSettings, ConnectionInfo } from "@aigoogle/shared";
import { getConnections, getMe, getSettings, putSettings } from "../api";

const card: React.CSSProperties = {
  border: "1px solid #e3ddd4", borderRadius: 6, padding: 16, marginBottom: 12,
  background: "#faf8f5", fontFamily: "system-ui",
};
const btn: React.CSSProperties = {
  border: "none", borderRadius: 4, padding: "8px 14px", cursor: "pointer",
  background: "#3d6b54", color: "white", fontSize: 14,
};

export function Settings() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>>>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [conns, setConns] = useState<ConnectionInfo[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getMe().then(setMe);
    void getSettings().then(setSettings);
    void getConnections().then(setConns);
  }, []);

  if (!me || !settings) return <p style={{ padding: 24, fontFamily: "system-ui" }}>Memuat…</p>;

  const accurate = conns.find((c) => c.provider === "accurate");
  const google = conns.find((c) => c.provider === "google");

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 560, margin: "40px auto", padding: 24 }}>
      <h1 style={{ fontSize: 24 }}>Pengaturan</h1>
      <p style={{ color: "#666" }}>{me.tenant.name} · {me.email}</p>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Koneksi</h2>
      <div style={card}>
        <strong>Accurate Online</strong>
        <p style={{ color: "#666", fontSize: 14 }}>
          Status: {accurate?.status === "connected" ? `terhubung (${accurate.accountLabel})` : accurate?.status === "expired" ? "token expired — buka ulang dari Accurate" : accurate?.status ?? "none"}
        </p>
        {accurate?.status !== "connected" && (
          <a href="/api/launch"><button style={btn}>{accurate?.status === "expired" ? "Hubungkan ulang Accurate" : "Hubungkan Accurate"}</button></a>
        )}
      </div>
      <div style={card}>
        <strong>Google Drive</strong>
        <p style={{ color: "#666", fontSize: 14 }}>
          Status: {google?.status ?? "none"} — menyusul (butuh client secret Google)
        </p>
        <button style={{ ...btn, background: "#9a9a9a" }} disabled>Hubungkan Google (segera)</button>
      </div>

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

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Suara</h2>
      <div style={card}>
        <label style={{ display: "block", marginBottom: 8 }}>
          <input
            type="radio" name="voice" checked={settings.voiceEngine === "web-speech"}
            onChange={() => setSettings({ ...settings, voiceEngine: "web-speech" })}
          />{" "}
          Browser (Web Speech) — ringan
        </label>
        <label style={{ display: "block", marginBottom: 8 }}>
          <input
            type="radio" name="voice" checked={settings.voiceEngine === "edge"}
            onChange={() => setSettings({ ...settings, voiceEngine: "edge" })}
          />{" "}
          Edge — STT di browser (Microsoft), TTS neural Edge (gratis, tanpa Gemini)
        </label>
        <label style={{ display: "block", marginBottom: 12 }}>
          <input
            type="radio" name="voice" checked={settings.voiceEngine === "gemini-native"}
            onChange={() => setSettings({ ...settings, voiceEngine: "gemini-native" })}
          />{" "}
          Gemini native audio — kualitas terbaik
        </label>
        <button
          style={btn}
          onClick={() => { void putSettings(settings).then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); }); }}
        >
          {saved ? "Tersimpan ✓" : "Simpan"}
        </button>
      </div>
      <a href="/app" style={{ color: "#3d6b54", fontSize: 14 }}>← Kembali</a>
    </main>
  );
}
