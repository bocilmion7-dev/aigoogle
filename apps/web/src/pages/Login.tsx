import { useState } from "react";

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

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error === "email_atau_password_salah" ? "Email atau password salah." : "Gagal masuk.");
        return;
      }
      window.location.href = "/app";
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 400, margin: "60px auto", padding: 24 }}>
      <h1 style={{ fontSize: 22, color: "#3d6b54" }}>Masuk</h1>
      <p style={{ color: "#666", fontSize: 14 }}>Gunakan email & password yang sudah Anda buat.</p>
      <form onSubmit={(e) => void submit(e)} style={card}>
        <label style={{ fontSize: 13, color: "#555" }}>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={input} />
        </label>
        <label style={{ fontSize: 13, color: "#555" }}>
          Password
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} style={input} />
        </label>
        {error && <p style={{ color: "#a33", fontSize: 13 }} role="alert">{error}</p>}
        <button type="submit" style={btn} disabled={busy} aria-label="Masuk">
          {busy ? "Memproses…" : "Masuk"}
        </button>
      </form>
      <p style={{ fontSize: 13, color: "#666" }}>
        Belum punya password?{" "}
        <a href="/api/launch" style={{ color: "#3d6b54" }}>Masuk lewat Accurate →</a>
      </p>
      <a href="/" style={{ color: "#3d6b54", fontSize: 14 }}>← Kembali</a>
    </main>
  );
}
