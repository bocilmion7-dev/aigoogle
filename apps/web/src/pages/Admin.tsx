import { useCallback, useEffect, useState } from "react";
import {
  getAdminUsers,
  getAuditLogs,
  getConnections,
  getMe,
  getPrivileges,
  getRoles,
  getSettings,
  getWaStatus,
  getWaWebhookEvents,
  putWaWebhookEvents,
  putRolePermissions,
  putSettings,
  putUserRole,
  putWaSettings,
  type AdminRole,
  type AdminUser,
  type AuditRow,
  type PrivilegesPayload,
} from "../api";
import type { AppSettings, ConnectionInfo } from "@aigoogle/shared";
import { AppHeader } from "../ui";
import { ACCURATE_OAUTH_CTA } from "../oauth";

type Tab = "users" | "roles" | "audit" | "settings";

export function Admin() {
  const [tab, setTab] = useState<Tab>("users");
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [priv, setPriv] = useState<PrivilegesPayload | null>(null);
  const [selRole, setSelRole] = useState<string>("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [aset, setAset] = useState<AppSettings | null>(null);
  const [conns, setConns] = useState<ConnectionInfo[]>([]);
  const [waAuto, setWaAuto] = useState(false);
  const [waDaily, setWaDaily] = useState(false);
  const [waPhone, setWaPhone] = useState("");
  const [waWh, setWaWh] = useState<{ events: string[]; rateMin: number; options: Array<{ key: string; label: string }> } | null>(null);
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const isAdmin = !!me?.permissions?.includes("app:users.manage");
  const canSettings = !!me?.permissions?.includes("app:settings.manage"); // Admin Platform saja

  useEffect(() => {
    void getMe().then(setMe);
  }, []);

  const loadRoles = useCallback(async () => {
    const r = await getRoles();
    setRoles(r);
    return r;
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void loadRoles()
      .then((r) => {
        if (r[0]) setSelRole(r[0].id);
      })
      .catch((e) => {
        if (e instanceof Error && e.message === "belum_login") window.location.href = "/login";
        else setErr("Gagal memuat role.");
      });
    void getPrivileges()
      .then(setPriv)
      .catch(() => undefined);
  }, [loadRoles, isAdmin]);

  const onFetchErr = (e: unknown) => {
    if (e instanceof Error && e.message === "belum_login") window.location.href = "/login";
    else setErr("Gagal memuat data.");
  };

  useEffect(() => {
    if (!isAdmin) return;
    if (tab === "users") {
      setErr(null);
      void getAdminUsers().then(setUsers).catch(onFetchErr);
    }
    if (tab === "audit") {
      setErr(null);
      void getAuditLogs(50).then(setAudit).catch(onFetchErr);
    }
    if (tab === "roles" && selRole) {
      const role = roles.find((x) => x.id === selRole);
      setChecked(new Set(role?.permissions ?? []));
    }
    if (tab === "settings" && !canSettings) {
      setTab("users");
      return;
    }
    if (tab === "settings") {
      setErr(null);
      void getSettings()
        .then(setAset)
        .catch(onFetchErr);
      void getConnections().then(setConns).catch(() => undefined);
      void getWaStatus()
        .then((w) => {
          setWaAuto(!!w.settings?.autoDueDate);
          setWaDaily(!!w.settings?.dailyReport);
          setWaPhone(w.settings?.ownerPhone ?? "");
        })
        .catch(() => undefined);
      void getWaWebhookEvents()
        .then((s) => setWaWh({ events: s.events ?? [], rateMin: s.rateMin ?? 10, options: s.options ?? [] }))
        .catch(() => undefined);
    }
  }, [tab, selRole, roles, isAdmin, canSettings]);

  const errText = (code?: string) =>
    code === "tidak_boleh_ubah_role_sendiri"
      ? "Anda tidak boleh mengubah role sendiri."
      : code === "tidak_punya_hak"
        ? "Anda tidak punya hak kelola admin."
        : "Terjadi gangguan — coba lagi.";

  async function saveRole() {
    setMsg(null);
    setErr(null);
    try {
      await putRolePermissions(selRole, [...checked]);
      await loadRoles();
      setMsg("Hak akses role disimpan.");
    } catch (e) {
      setErr(errText(e instanceof Error ? e.message : undefined));
    }
  }

  async function changeRole(userId: string, roleKey: string) {
    setMsg(null);
    setErr(null);
    try {
      await putUserRole(userId, roleKey);
      setUsers(await getAdminUsers());
      setMsg("Role user diperbarui.");
    } catch (e) {
      setErr(errText(e instanceof Error ? e.message : undefined));
      void getAdminUsers().then(setUsers);
    }
  }

  async function saveAppSettings() {
    if (!aset) return;
    setMsg(null);
    setErr(null);
    try {
      await putSettings({
        voiceEngine: aset.voiceEngine,
        ocrMode: aset.ocrMode ?? "vision",
        ...(aset.waPricePerCredit !== undefined ? { waPricePerCredit: aset.waPricePerCredit } : {}),
      });
      await putWaSettings({ autoDueDate: waAuto, dailyReport: waDaily, ownerPhone: waPhone });
      if (waWh) await putWaWebhookEvents({ events: waWh.events, rateMin: waWh.rateMin });
      setMsg("Pengaturan aplikasi disimpan.");
    } catch (e) {
      setErr(errText(e instanceof Error ? e.message : undefined));
    }
  }

  if (me === undefined) {
    return (
      <div className="app">
        <main className="page page--narrow">
          <p className="meta">Memuat…</p>
        </main>
      </div>
    );
  }
  if (me === null) {
    window.location.href = "/login";
    return null;
  }

  if (!isAdmin) {
    return (
      <div className="app">
        <AppHeader me={me} />
        <main className="page page--narrow">
          <h1>Admin</h1>
          <div className="card">
            <strong>Anda tidak punya akses menu Admin.</strong>
            <p className="meta" style={{ marginTop: 6, marginBottom: 0 }}>
              Menu ini hanya untuk pengelola platform (hak kelola user &amp; pengaturan).
              Hubungi administrator Anda jika Anda membutuhkannya.
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
      <main className="page">
        <h1>Admin</h1>
        <p className="page__sub">Kelola user, hak akses peran, jejak audit, dan pengaturan aplikasi.</p>

        <div className="tabs" role="group" aria-label="Bagian Admin">
          <button className="tab" aria-pressed={tab === "users"} onClick={() => setTab("users")}>
            User
          </button>
          <button className="tab" aria-pressed={tab === "roles"} onClick={() => setTab("roles")}>
            Peran
          </button>
          <button className="tab" aria-pressed={tab === "audit"} onClick={() => setTab("audit")}>
            Audit
          </button>
          {canSettings && (
            <button className="tab" aria-pressed={tab === "settings"} onClick={() => setTab("settings")}>
              Pengaturan
            </button>
          )}
        </div>

        {msg && <p className="banner banner--ok" role="status">{msg}</p>}
        {err && <p className="banner banner--err" role="alert">{err}</p>}

        {tab === "users" && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Email</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td className="muted">{u.email}</td>
                    <td>
                      <select
                        className="select"
                        style={{ maxWidth: 180 }}
                        value={u.roleKey}
                        onChange={(e) => void changeRole(u.id, e.target.value)}
                        aria-label={`Role ${u.name}`}
                      >
                        {roles.map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={3} className="empty">Belum ada user.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "roles" && (
          <div className="card">
            <label className="field" style={{ maxWidth: 320 }}>
              Role
              <select className="select" value={selRole} onChange={(e) => setSelRole(e.target.value)}>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>

            <h3 className="section-title" style={{ marginTop: "var(--space-m)" }}>Modul Accurate</h3>
            <div className="stack" style={{ gap: 0 }}>
              {priv?.modules.map((m) => (
                <label key={m.key} className="check">
                  <input
                    type="checkbox"
                    checked={checked.has(m.key)}
                    onChange={(e) => {
                      const next = new Set(checked);
                      e.target.checked ? next.add(m.key) : next.delete(m.key);
                      setChecked(next);
                    }}
                  />
                  <span>
                    {m.label} <span className="meta">({m.key})</span>
                    {m.mirrorChecked && !checked.has(m.key) && (
                      <span className="check__hint">— default Accurate: aktif</span>
                    )}
                  </span>
                </label>
              ))}
            </div>

            <h3 className="section-title">Fitur Aplikasi</h3>
            <div className="stack" style={{ gap: 0 }}>
              {priv?.appFeatures.map((f) => (
                <label key={f.key} className="check">
                  <input
                    type="checkbox"
                    checked={checked.has(f.key)}
                    onChange={(e) => {
                      const next = new Set(checked);
                      e.target.checked ? next.add(f.key) : next.delete(f.key);
                      setChecked(next);
                    }}
                  />
                  <span>
                    {f.label} <span className="meta">({f.key})</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="btn-row" style={{ marginTop: "var(--space-s)" }}>
              <button className="btn" onClick={() => void saveRole()}>
                Simpan Hak Akses
              </button>
            </div>
          </div>
        )}

        {tab === "audit" && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>User</th>
                  <th>Aksi</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="meta" style={{ whiteSpace: "nowrap" }}>
                      {new Date(a.createdAt).toLocaleString("id-ID")}
                    </td>
                    <td>{a.userEmail}</td>
                    <td>{a.action}</td>
                    <td className="muted" style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {a.detail}
                    </td>
                  </tr>
                ))}
                {audit.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty">Belum ada aktivitas tercatat.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "settings" && (
          <>
            <div className="card">
              <strong className="card__title">Mode baca dokumen</strong>
              <div className="stack" style={{ gap: 0 }}>
                <label className="check">
                  <input
                    type="radio" name="ocr" checked={(aset?.ocrMode ?? "vision") === "vision"}
                    onChange={() => aset && setAset({ ...aset, ocrMode: "vision" })}
                  />
                  <span>
                    Vision &amp; OCR — gambar/PDF dibaca AI (nota, bukti transfer, faktur, screenshot)
                  </span>
                </label>
                <label className="check">
                  <input
                    type="radio" name="ocr" checked={aset?.ocrMode === "text"}
                    onChange={() => aset && setAset({ ...aset, ocrMode: "text" })}
                  />
                  <span>Teks saja — hanya file teks (MD, TXT, DOCX, PPTX)</span>
                </label>
              </div>

              <strong className="card__title" style={{ marginTop: "var(--space-s)" }}>
                Mesin suara (chat &amp; panggilan suara)
              </strong>
              <div className="stack" style={{ gap: 0 }}>
                <label className="check">
                  <input
                    type="radio" name="voice" checked={aset?.voiceEngine === "web-speech"}
                    onChange={() => aset && setAset({ ...aset, voiceEngine: "web-speech" })}
                  />
                  <span>Browser (Web Speech) — ringan</span>
                </label>
                <label className="check">
                  <input
                    type="radio" name="voice" checked={aset?.voiceEngine === "edge"}
                    onChange={() => aset && setAset({ ...aset, voiceEngine: "edge" })}
                  />
                  <span>Edge — STT di browser, TTS neural (gratis)</span>
                </label>
                <label className="check">
                  <input
                    type="radio" name="voice" checked={aset?.voiceEngine === "gemini-native"}
                    onChange={() => aset && setAset({ ...aset, voiceEngine: "gemini-native" })}
                  />
                  <span>Gemini native audio — kualitas terbaik</span>
                </label>
              </div>

              <strong className="card__title" style={{ marginTop: "var(--space-s)" }}>Biaya WhatsApp</strong>
              <label className="field" style={{ maxWidth: 260 }}>
                Harga per kredit (Rp, biaya 1 pesan)
                <input
                  className="input num"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1000000}
                  value={aset?.waPricePerCredit ?? 200}
                  onChange={(e) => aset && setAset({ ...aset, waPricePerCredit: Number(e.target.value) })}
                />
              </label>
            </div>

            <div className="card">
              <strong className="card__title">Otomasi WhatsApp</strong>
              <div className="stack" style={{ gap: 0 }}>
                <label className="check">
                  <input type="checkbox" checked={waAuto} onChange={(e) => setWaAuto(e.target.checked)} />
                  <span>Ingatkan tagihan jatuh tempo ke pelanggan</span>
                </label>
                <label className="check">
                  <input type="checkbox" checked={waDaily} onChange={(e) => setWaDaily(e.target.checked)} />
                  <span>Laporan harian ke pemilik usaha (jam 08.00)</span>
                </label>
              </div>
              <label className="field" style={{ maxWidth: 300, marginTop: "var(--space-xs)" }}>
                Nomor WhatsApp pemilik (format 62…)
                <input
                  className="input num"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={waPhone}
                  onChange={(e) => setWaPhone(e.target.value)}
                  placeholder="628123456789"
                />
              </label>
            </div>

            <div className="card">
              <strong className="card__title">Notifikasi perubahan data Accurate</strong>
              <p className="small muted" style={{ margin: "0 0 var(--space-xs)" }}>
                Kirim WhatsApp otomatis ke nomor pemilik di atas setiap ada perubahan data yang dipilih (webhook Accurate).
                Notifikasi per jenis data dibatasi sekali per jeda yang ditentukan agar tidak spam.
              </p>
              <div className="stack" style={{ gap: 0 }}>
                {(waWh?.options ?? []).map((o) => (
                  <label className="check" key={o.key}>
                    <input
                      type="checkbox"
                      checked={waWh?.events.includes(o.key) ?? false}
                      onChange={(e) =>
                        setWaWh((s) =>
                          s
                            ? {
                                ...s,
                                events: e.target.checked ? [...s.events, o.key] : s.events.filter((x) => x !== o.key),
                              }
                            : s
                        )
                      }
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
              <label className="field" style={{ maxWidth: 220, marginTop: "var(--space-xs)" }}>
                Jeda antar-notifikasi per jenis data (menit)
                <input
                  className="input num"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1440}
                  value={waWh?.rateMin ?? 10}
                  onChange={(e) => setWaWh((s) => (s ? { ...s, rateMin: Number(e.target.value) } : s))}
                />
              </label>
            </div>

            <div className="card">
              <strong className="card__title">Koneksi</strong>
              <p className="small muted" style={{ margin: "0 0 var(--space-xs)" }}>
                Accurate Online:{" "}
                {(conns.find((c) => c.provider === "accurate")?.status ?? "none") === "connected"
                  ? `terhubung (${conns.find((c) => c.provider === "accurate")?.accountLabel})`
                  : conns.find((c) => c.provider === "accurate")?.status ?? "none"}
              </p>
              {conns.find((c) => c.provider === "accurate")?.status !== "connected" && (
                <a className="btn" href={ACCURATE_OAUTH_CTA} style={{ marginBottom: "var(--space-xs)" }}>
                  Hubungkan Accurate
                </a>
              )}
              <p className="small muted" style={{ margin: 0 }}>
                Google Drive: {conns.find((c) => c.provider === "google")?.status ?? "none"} — menyusul
              </p>
            </div>

            <div className="btn-row">
              <button className="btn" disabled={!aset} onClick={() => void saveAppSettings()}>
                Simpan pengaturan
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
