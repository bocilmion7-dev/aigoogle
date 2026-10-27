import { useState } from "react";
import { forgotPassword } from "../api";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim email reset.");
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
          <h2 className="auth2__headline">Pulihkan akses akun.</h2>
          <p className="auth2__sub">
            Masukkan email yang terdaftar. Kami kirim tautan aman untuk membuat password baru.
          </p>
          <span className="auth2__foot">© {new Date().getFullYear()} AI Asisten</span>
        </aside>
        <main className="auth2__main">
          <div className="auth2__card">
            <h1>Lupa Password</h1>
            {sent ? (
              <>
                <p className="auth2__hint">
                  Jika email <strong>{email}</strong> terdaftar, tautan reset sudah dikirim. Periksa inbox
                  dan folder spam.
                </p>
                <a className="auth2__back" href="/login">← Kembali ke login</a>
              </>
            ) : (
              <form onSubmit={(e) => void submit(e)} className="auth2__form" noValidate>
                <label className="auth2__field">
                  <span>Email</span>
                  <input
                    className="input"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nama@perusahaan.co.id"
                  />
                </label>
                {error && <p className="banner banner--err" role="alert" style={{ margin: 0 }}>{error}</p>}
                <button className="btn btn--primary auth2__submit" type="submit" disabled={busy} aria-busy={busy}>
                  {busy ? "Mengirim…" : "Kirim tautan reset"}
                </button>
              </form>
            )}
            <a className="auth2__back" href="/login">← Kembali ke login</a>
          </div>
        </main>
      </div>
    </div>
  );
}
