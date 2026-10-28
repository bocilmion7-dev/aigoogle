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
    <div className="auth2 auth2--centered">
      <div className="auth2__grid">
        <main className="auth2__main">
          <div className="auth2__card">
            <img src="/logo-ai-asisten.webp" alt="AI Asisten" className="auth2__logo" width={132} height={44} />
            <h1>Lupa Password</h1>
            <p className="auth2__hint">
              Masukkan email terdaftar. Kami kirim tautan aman untuk membuat password baru.
            </p>
            {sent ? (
              <>
                <p className="banner banner--ok" role="status">
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
                <a className="auth2__back" href="/login">← Kembali ke login</a>
              </form>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
