import { useEffect, useState } from "react";
import type { Me } from "@aigoogle/shared";
import { getMe } from "../api";
import { PageLoader } from "../ui";

export function SetPassword() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getMe().then(setMe);
  }, []);
  useEffect(() => {
    if (me === null) window.location.href = "/";
    else if (me && !me.needsPassword) window.location.href = "/app";
  }, [me]);

  if (me === undefined) {
    return (
      <div className="app">
        <main className="page page--narrow">
          <PageLoader />
        </main>
      </div>
    );
  }
  if (me === null || !me.needsPassword) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Password tidak sama.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          j.error === "minimal_12"
            ? "Password minimal 12 karakter."
            : j.error === "butuh_huruf_kecil"
              ? "Password harus mengandung huruf kecil."
              : j.error === "butuh_huruf_besar"
                ? "Password harus mengandung huruf besar."
                : j.error === "butuh_angka"
                  ? "Password harus mengandung minimal satu angka."
                  : j.error === "butuh_simbol"
                    ? "Password harus mengandung minimal satu simbol."
                    : j.error === "sudah_diset"
                      ? "Password sudah pernah diset."
                      : "Gagal menyimpan password."
        );
        return;
      }
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
            <h1>Buat Password</h1>
            <p className="auth2__hint">
              Selamat datang, <strong>{me.name}</strong>. Buat password agar bisa masuk tanpa membuka Accurate.
            </p>
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
                  placeholder="Min. 12 karakter, ada angka & simbol"
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
              {error && (
                <p className="banner banner--err" role="alert" style={{ margin: 0 }}>
                  {error}
                </p>
              )}
              <button className="btn btn--primary auth2__submit" type="submit" disabled={busy} aria-busy={busy}>
                {busy ? "Menyimpan…" : "Simpan & masuk"}
              </button>
              <a className="auth2__back" href="/">← Kembali ke beranda</a>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
