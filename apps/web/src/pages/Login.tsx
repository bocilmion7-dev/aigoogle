import { useState } from "react";
import { ACCURATE_OAUTH_CTA } from "../oauth";
import { resetSessionCache } from "../api";
import { track } from "../telemetry";

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
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        twoFactorRequired?: boolean;
        emailOtpRequired?: boolean;
        challenge?: string;
      };
      if (!res.ok) {
        setError(j.error === "email_atau_password_salah" ? "Email atau password salah." : "Gagal masuk.");
        return;
      }
      if (j.twoFactorRequired && j.challenge) {
        window.location.href = `/2fa?challenge=${encodeURIComponent(j.challenge)}`;
        return;
      }
      if (j.emailOtpRequired && j.challenge) {
        window.location.href = `/otp?challenge=${encodeURIComponent(j.challenge)}`;
        return;
      }
      resetSessionCache();
      track("login", { via: "password" });
      window.location.href = "/app";
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
            <h1>Masuk</h1>
            <p className="auth2__hint">Gunakan email &amp; password akun Anda.</p>

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
              <label className="auth2__field">
                <span>Password</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </label>
              <a className="auth2__forgot" href="/forgot-password">Lupa password?</a>

              {error && (
                <p className="banner banner--err" role="alert" style={{ margin: 0 }}>
                  {error}
                </p>
              )}

              <button className="btn btn--primary auth2__submit" type="submit" disabled={busy} aria-busy={busy}>
                {busy ? "Memproses…" : "Masuk"}
              </button>
            </form>

            <div className="auth2__or"><span>atau</span></div>

            <a className="auth2__oauth" href={ACCURATE_OAUTH_CTA}>
              Masuk lewat Accurate →
            </a>

            <p className="auth2__alt">
              Belum punya password? Pakai <strong>Masuk lewat Accurate</strong> — Anda akan diminta
              membuat password sekali.
            </p>
            <a className="auth2__back" href="/">← Kembali ke beranda</a>
          </div>
        </main>
      </div>
    </div>
  );
}
