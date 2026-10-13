import { useCallback, useEffect, useState } from "react";
import {
  getAdminTenants,
  getAdminUsers,
  getAuditLogs,
  getConnections,
  getMe,
  getPrivileges,
  getRoles,
  putRolePermissions,
  putUserRole,
  type AdminRole,
  type AdminUser,
  type AuditRow,
  type PrivilegesPayload,
} from "../api";
import type { ConnectionInfo } from "@aigoogle/shared";
import { AppHeader, PageLoader } from "../ui";
import { ACCURATE_OAUTH_CTA } from "../oauth";

type Tab = "users" | "roles" | "audit";

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
  const [conns, setConns] = useState<ConnectionInfo[]>([]);
  const [tenants, setTenants] = useState<Array<{ id: string; name: string; alias: string }>>([]);
  const [selTenant, setSelTenant] = useState<string>(""); // Admin Platform: perusahaan yang sedang dikelola
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const isAdmin = !!me?.permissions?.includes("app:users.manage");
  const canSettings = !!me?.permissions?.includes("app:settings.manage"); // Admin Platform saja

  useEffect(() => {
    void getMe().then(setMe);
  }, []);

  const loadRoles = useCallback(async (tenantId?: string) => {
    const r = await getRoles(tenantId || undefined);
    setRoles(r);
    return r;
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void loadRoles(selTenant || undefined)
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
  }, [loadRoles, isAdmin, selTenant]);

  useEffect(() => {
    if (me && !me.permissions?.includes("app:settings.manage")) {
      void getConnections().then(setConns).catch(() => undefined);
    }
  }, [me]);

  useEffect(() => {
    if (!canSettings) return;
    void getAdminTenants()
      .then((ts) => {
        setTenants(ts);
        setSelTenant((cur) => cur || ts[0]?.id || "");
      })
      .catch(() => undefined);
  }, [canSettings, me]);

  const onFetchErr = (e: unknown) => {
    if (e instanceof Error && e.message === "belum_login") window.location.href = "/login";
    else setErr("Gagal memuat data.");
  };

  useEffect(() => {
    if (!isAdmin) return;
    if (tab === "users") {
      setErr(null);
      void getAdminUsers(selTenant || undefined).then(setUsers).catch(onFetchErr);
    }
    if (tab === "audit") {
      setErr(null);
      void getAuditLogs(50, selTenant || undefined).then(setAudit).catch(onFetchErr);
    }
    if (tab === "roles" && selRole) {
      const role = roles.find((x) => x.id === selRole);
      setChecked(new Set(role?.permissions ?? []));
    }
  }, [tab, selRole, roles, isAdmin, canSettings, selTenant]);

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
      await loadRoles(selTenant || undefined);
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
      setUsers(await getAdminUsers(selTenant || undefined));
      setMsg("Role user diperbarui.");
    } catch (e) {
      setErr(errText(e instanceof Error ? e.message : undefined));
      void getAdminUsers(selTenant || undefined).then(setUsers);
    }
  }

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
        <p className="page__sub">Kelola user dan hak akses peran perusahaan, serta jejak audit.</p>

        {/* Koneksi Accurate milik perusahaan — hanya sisi perusahaan (Admin Platform tidak punya koneksi) */}
        {!canSettings && (
          <div className="card" style={{ marginBottom: "var(--space-s)", maxWidth: 560 }}>
            <strong className="card__title">Koneksi Accurate</strong>
            <p className="small muted" style={{ margin: "0 0 var(--space-xs)" }}>
              Accurate Online:{" "}
              {(conns.find((c) => c.provider === "accurate")?.status ?? "none") === "connected"
                ? `terhubung (${conns.find((c) => c.provider === "accurate")?.accountLabel})`
                : conns.find((c) => c.provider === "accurate")?.status ?? "none"}
            </p>
            {conns.find((c) => c.provider === "accurate")?.status !== "connected" && (
              <a className="btn" href={ACCURATE_OAUTH_CTA}>
                Hubungkan Accurate
              </a>
            )}
          </div>
        )}

        {canSettings && tenants.length > 0 && (
          <div className="card" style={{ marginBottom: "var(--space-s)", maxWidth: 420 }}>
            <label className="field" style={{ marginBottom: 0 }}>
              Perusahaan yang dikelola
              <select
                className="input"
                value={selTenant}
                onChange={(e) => setSelTenant(e.target.value)}
                aria-label="Pilih perusahaan"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.alias ? ` (${t.alias})` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

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

      </main>
    </div>
  );
}
