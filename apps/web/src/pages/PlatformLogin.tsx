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
    <div className="auth2">
      <div className="auth2__grid">
        <aside className="auth2__aside">
          <a className="auth2__brand" href="/">
            <span className="auth2__mark" aria-hidden="true">AI</span>
            <span>AI Asisten</span>
          </a>
          <h2 className="auth2__headline">Panel Admin Platform.</h2>
          <p className="auth2__sub">
            Khusus pengurus sistem. Akun perusahaan masuk lewat halaman login biasa.
          </p>
          <ul className="auth2__points">
            <li>Kelola akun &amp; peran seluruh perusahaan</li>
            <li>Atur provider dan model AI</li>
            <li>Semua aksi tercatat di jejak audit</li>
          </ul>
          <span className="auth2__foot">© {new Date().getFullYear()} AI Asisten</span>
        </aside>

        <main className="auth2__main">
          <div className="auth2__card">
            <h1>Masuk — Admin</h1>
            <p className="auth2__hint">Gunakan kredensial pengurus sistem.</p>
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
            </form>
            <a className="auth2__back" href="/login">← Masuk sebagai akun perusahaan</a>
          </div>
        </main>
      </div>
    </div>
  );
}
