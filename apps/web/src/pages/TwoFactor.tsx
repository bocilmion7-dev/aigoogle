import { useState } from "react";
import { verify2fa } from "../api";

export function TwoFactor() {
  const challenge = new URLSearchParams(window.location.search).get("challenge") ?? "";
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await verify2fa(challenge, code.replace(/\D/g, ""));
      window.location.href = r.platform ? "/admin" : r.needsPassword ? "/set-password" : "/app";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kode tidak valid.");
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
            <h1>Kode 2FA</h1>
            <p className="auth2__hint">Masukkan 6 digit dari aplikasi autentikator Anda.</p>
            {!challenge ? (
              <p className="banner banner--err" role="alert">Sesi verifikasi tidak valid. Silakan login ulang.</p>
            ) : (
              <form onSubmit={(e) => void submit(e)} className="auth2__form">
                <label className="auth2__field">
                  <span>Kode 6 digit</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                  />
                </label>
                {error && <p className="banner banner--err" role="alert" style={{ margin: 0 }}>{error}</p>}
                <button className="btn btn--primary auth2__submit" type="submit" disabled={busy} aria-busy={busy}>
                  {busy ? "Memverifikasi…" : "Verifikasi"}
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
