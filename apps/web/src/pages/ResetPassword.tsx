import { useState } from "react";
import { resetPassword } from "../api";

const strengthError = (password: string): string | null => {
  if (password.length < 12) return "Password minimal 12 karakter.";
  if (!/[a-z]/.test(password)) return "Tambahkan huruf kecil.";
  if (!/[A-Z]/.test(password)) return "Tambahkan huruf besar.";
  if (!/\d/.test(password)) return "Tambahkan angka.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Tambahkan simbol.";
  return null;
};

export function ResetPassword() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Password tidak sama.");
      return;
    }
    const weak = strengthError(password);
    if (weak) {
      setError(weak);
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      window.location.href = "/login?reset=1";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mereset password.");
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
          <h2 className="auth2__headline">Buat password baru.</h2>
          <p className="auth2__sub">
            Gunakan minimal 12 karakter dengan huruf besar, huruf kecil, angka, dan simbol.
          </p>
          <span className="auth2__foot">© {new Date().getFullYear()} AI Asisten</span>
        </aside>
        <main className="auth2__main">
          <div className="auth2__card">
            <h1>Reset Password</h1>
            {!token ? (
              <>
                <p className="banner banner--err" role="alert">Tautan reset tidak valid atau sudah kedaluwarsa.</p>
                <a className="auth2__back" href="/forgot-password">Minta tautan baru</a>
              </>
            ) : (
              <form onSubmit={(e) => void submit(e)} className="auth2__form">
                <label className="auth2__field">
                  <span>Password baru</span>
                  <input
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 12 karakter"
                  />
                </label>
                <label className="auth2__field">
                  <span>Ulangi password</span>
                  <input
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Ketik ulang password"
                  />
                </label>
                {error && <p className="banner banner--err" role="alert" style={{ margin: 0 }}>{error}</p>}
                <button className="btn btn--primary auth2__submit" type="submit" disabled={busy} aria-busy={busy}>
                  {busy ? "Menyimpan…" : "Simpan password"}
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
