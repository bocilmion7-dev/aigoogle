import { useState } from "react";
import { platformLogin } from "../api";

/** Login khusus Admin Platform — akun tersimpan di tabel terpisah (bukan akun Accurate). */
export function PlatformLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await platformLogin(email, password);
      window.location.href = "/admin";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal masuk.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <span className="auth__brand">Accurate Accelerator</span>
      <h1>Masuk — Admin Platform</h1>
      <p className="page__sub">Khusus pengurus sistem. Akun perusahaan masuk lewat halaman login biasa.</p>
      <form onSubmit={(e) => void submit(e)} className="card">
        <div className="stack">
          <label className="field">
            Email
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="field">
            Password
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <p className="banner banner--err" role="alert" style={{ margin: 0 }}>
              {error}
            </p>
          )}
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Memproses…" : "Masuk sebagai Admin Platform"}
          </button>
          <a className="meta" href="/login" style={{ textAlign: "center" }}>
            ← Masuk sebagai akun perusahaan (Accurate)
          </a>
        </div>
      </form>
    </main>
  );
}
