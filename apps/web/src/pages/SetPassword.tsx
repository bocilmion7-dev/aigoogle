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

  if (me === undefined) {
    return (
      <div className="app">
        <main className="page page--narrow">
          <PageLoader />
        </main>
      </div>
    );
  }
  if (me === null) {
    window.location.href = "/";
    return null;
  }
  if (!me.needsPassword) {
    window.location.href = "/app";
    return null;
  }

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
          j.error === "minimal_8"
            ? "Password minimal 8 karakter."
            : j.error === "butuh_angka"
              ? "Password harus mengandung minimal satu angka."
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
    <main className="auth">
      <span className="auth__brand">Accurate Accelerator</span>
      <h1>Buat Password</h1>
      <p className="page__sub">
        Selamat datang, <strong>{me.name}</strong>. Buat password untuk masuk tanpa Accurate.
      </p>
      <form onSubmit={(e) => void submit(e)} className="card">
        <div className="stack">
          <label className="field">
            Password baru (min. 8 karakter, ada angka)
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="field">
            Ulangi password
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          {error && (
            <p className="banner banner--err" role="alert" style={{ marginBottom: 0 }}>
              {error}
            </p>
          )}
          <button className="btn" type="submit" disabled={busy} aria-label="Simpan password">
            {busy ? "Menyimpan…" : "Simpan & masuk"}
          </button>
        </div>
      </form>
    </main>
  );
}
