import { useState } from "react";
import { ACCURATE_OAUTH_CTA } from "../oauth";

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
    <main className="auth">
      <span className="auth__brand">Accurate Accelerator</span>
      <h1>Masuk</h1>
      <p className="page__sub">Gunakan email & password yang sudah Anda buat.</p>
      <form onSubmit={(e) => void submit(e)} className="card">
        <div className="stack">
          <label className="field">
            Email
            <input
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            Password
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="banner banner--err" role="alert" style={{ marginBottom: 0 }}>
              {error}
            </p>
          )}
          <button className="btn" type="submit" disabled={busy} aria-label="Masuk">
            {busy ? "Memproses…" : "Masuk"}
          </button>
        </div>
      </form>
      <p className="meta" style={{ textAlign: "center" }}>
        Pengurus sistem? <a href="/platform">Masuk sebagai Admin Platform</a>
      </p>
      <p className="meta">
        Belum punya password?{" "}
        <a href={ACCURATE_OAUTH_CTA}>Masuk lewat Accurate →</a>
      </p>
      <a className="btn btn--ghost btn--sm" href="/" style={{ marginTop: 8 }}>
        ← Kembali
      </a>
    </main>
  );
}
