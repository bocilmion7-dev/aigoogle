import { useEffect, useState } from "react";
import type { Me } from "@aigoogle/shared";
import { getMe } from "../api";

const card: React.CSSProperties = {
  border: "1px solid #e3ddd4", borderRadius: 6, padding: 16, marginBottom: 12,
  background: "#faf8f5", fontFamily: "system-ui",
};
const btn: React.CSSProperties = {
  border: "none", borderRadius: 4, padding: "8px 14px", cursor: "pointer",
  background: "#3d6b54", color: "white", fontSize: 14,
};
const input: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 4, border: "1px solid #ccc",
  fontSize: 14, marginBottom: 8, boxSizing: "border-box", fontFamily: "inherit",
};

export function SetPassword() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getMe().then(setMe);
  }, []);

  if (me === undefined) return <p style={{ padding: 24, fontFamily: "system-ui" }}>Memuat…</p>;
  if (me === null) {
    window.location.href = "/";
    return null;
  }
  if (!me.needsPassword) {
    window.location.href = "/app";
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Password tidak sama.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          j.error === "minimal_8"
            ? "Password minimal 8 karakter."
            : j.error === "butuh_angka"
              ? "Password harus mengandung minimal satu angka."
              : j.error === "sudah_diset"
                ? "Password sudah pernah diset."
                : "Gagal menyimpan password."
        );
        return;
      }
      window.location.href = "/app";
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 400, margin: "60px auto", padding: 24 }}>
      <h1 style={{ fontSize: 22, color: "#3d6b54" }}>Buat Password</h1>
      <p style={{ color: "#666", fontSize: 14 }}>
        Selamat datang, <strong>{me.name}</strong>. Buat password untuk masuk tanpa Accurate.
      </p>
      <form onSubmit={(e) => void submit(e)} style={card}>
        <label style={{ fontSize: 13, color: "#555" }}>
          Password baru (min. 8 karakter, ada angka)
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} style={input} />
        </label>
        <label style={{ fontSize: 13, color: "#555" }}>
          Ulangi password
          <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} style={input} />
        </label>
        {error && <p style={{ color: "#a33", fontSize: 13 }} role="alert">{error}</p>}
        <button type="submit" style={btn} disabled={busy} aria-label="Simpan password">
          {busy ? "Menyimpan…" : "Simpan & masuk"}
        </button>
      </form>
    </main>
  );
}
