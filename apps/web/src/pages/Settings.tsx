import { useEffect, useState } from "react";
import { getMe } from "../api";
import { AppHeader } from "../ui";

export function Settings() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);

  useEffect(() => {
    void getMe().then(setMe);
  }, []);

  const canSettings = !!me?.permissions?.includes("app:settings.manage");

  if (me === undefined) return <p style={{ padding: 24 }}>Memuat…</p>;
  if (me === null) {
    window.location.href = "/login";
    return null;
  }

  if (!canSettings) {
    return (
      <div className="app">
        <AppHeader me={me} />
        <main className="page page--narrow">
          <h1>Pengaturan</h1>
          <div className="card">
            <strong>Anda tidak punya akses menu Pengaturan.</strong>
            <p className="meta" style={{ marginTop: 6, marginBottom: 0 }}>
              Menu ini hanya untuk Admin platform. Hubungi administrator Anda jika Anda membutuhkannya.
            </p>
          </div>
          <a className="btn btn--ghost btn--sm" href="/app">
            ← Kembali ke dashboard
          </a>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <AppHeader me={me} />
      <main className="page page--narrow">
        <h1>Pengaturan</h1>
        <p className="page__sub">
          {me.tenant.name} · {me.email}
        </p>

        <h2 className="section-title">Akun</h2>
        <section className="card">
          <strong className="card__title">Login password</strong>
          <p className="small muted" style={{ margin: 0 }}>
            Email: {me.email}
            {me.needsPassword ? " · belum diset" : " · sudah aktif"}
          </p>
          <p className="meta" style={{ marginBottom: 0 }}>
            Lupa password? Reset via WhatsApp menyusul. Untuk sekarang, hubungi administrator sistem Anda.
          </p>
        </section>

        <section className="card">
          <strong className="card__title">Pengaturan aplikasi</strong>
          <p className="meta" style={{ marginBottom: 0 }}>
            Vision &amp; OCR, mesin suara, biaya WhatsApp, otomasi, dan koneksi diatur oleh Admin
            di menu <b>Admin</b> → tab <b>Pengaturan</b>.
          </p>
        </section>
        <a className="btn btn--ghost btn--sm" href="/app">
          ← Kembali
        </a>
      </main>
    </div>
  );
}
