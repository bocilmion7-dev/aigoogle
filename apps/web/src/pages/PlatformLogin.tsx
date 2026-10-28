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
      const r = await platformLogin(email, password);
      if (r.twoFactorRequired && r.challenge) {
        window.location.href = `/2fa?challenge=${encodeURIComponent(r.challenge)}`;
        return;
      }
      if (r.emailOtpRequired && r.challenge) {
        window.location.href = `/otp?challenge=${encodeURIComponent(r.challenge)}`;
        return;
      }
      window.location.href = "/admin";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal masuk.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth2 auth2--centered">
      <div className="auth2__grid">
        <main className="auth2__main">
          <div className="auth2__card">
            <img src="/logo-ai-asisten.webp" alt="AI Asisten" className="auth2__logo" width={132} height={44} />
            <h1>Masuk — Admin</h1>
            <p className="auth2__hint">Khusus pengurus sistem. Akun perusahaan masuk lewat login biasa.</p>
            <form onSubmit={(e) => void submit(e)} className="auth2__form">
              <label className="auth2__field">
                <span>Email</span>
                <input
                  className="input"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@perusahaan.co.id"
                  required
                />
              </label>
              <label className="auth2__field">
                <span>Password</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </label>
              {error && (
                <p className="banner banner--err" role="alert" style={{ margin: 0 }}>
                  {error}
                </p>
              )}
              <button className="btn btn--primary auth2__submit" type="submit" disabled={busy} aria-busy={busy}>
                {busy ? "Memproses…" : "Masuk sebagai Admin Platform"}
              </button>
              <a className="auth2__back" href="/login">← Masuk sebagai akun perusahaan</a>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
