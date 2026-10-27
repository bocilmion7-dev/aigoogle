import { Fragment, useCallback, useEffect, useState } from "react";
import {
  getAdminTenants,
  getAdminUsers,
  getPlatformAnalytics,
  getUsage,
  getConnections,
  getMe,
  getPrivileges,
  getRoles,
  putRolePermissions,
  putUserRole,
  inviteUser,
  impersonateUser,
  suspendTenant,
  getAdminFeatures,
  putAdminFeatures,
  getAuditLogs,
  getHealthDeep,
  getMetrics,
  getAccurateStatus,
  reconcileAccurate,
  type AccurateStatus,
  type AdminRole,
  type AdminUser,
  type AuditRow,
  type FeatureFlags,
  type HealthPayload,
  type MetricsPayload,
  type PrivilegesPayload,
  type PlatformAnalytics,
  type UsagePayload,
} from "../api";
import type { ConnectionInfo } from "@aigoogle/shared";
import { AppHeader, PageLoader } from "../ui";
import { ACCURATE_OAUTH_CTA } from "../oauth";

type Tab = "users" | "roles" | "usage" | "features" | "audit" | "system";

export function Admin() {
  const [tab, setTab] = useState<Tab>("users");
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [priv, setPriv] = useState<PrivilegesPayload | null>(null);
  const [selRole, setSelRole] = useState<string>("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [conns, setConns] = useState<ConnectionInfo[]>([]);
  const [tenants, setTenants] = useState<Array<{ id: string; name: string; alias: string }>>([]);
  const [selTenant, setSelTenant] = useState<string>(""); // Admin Platform: perusahaan yang sedang dikelola
  const [openUser, setOpenUser] = useState<string | null>(null); // baris detail mobile
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [platformUsage, setPlatformUsage] = useState<PlatformAnalytics | null>(null);
  const [features, setFeatures] = useState<FeatureFlags | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditAction, setAuditAction] = useState("");
  const [auditDraft, setAuditDraft] = useState("");
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);
  const [accStatus, setAccStatus] = useState<AccurateStatus | null>(null);
  const [sysBusy, setSysBusy] = useState(false);
  const [sysMsg, setSysMsg] = useState("");
  const isAdmin = !!me?.permissions?.includes("app:users.manage");
  const canSettings = !!me?.permissions?.includes("app:settings.manage"); // Admin Platform saja

  useEffect(() => {
    void getMe().then(setMe);
  }, []);
  useEffect(() => {
    if (me === null) window.location.href = "/login";
  }, [me]);

  const loadRoles = useCallback(async (tenantId?: string) => {
    const r = await getRoles(tenantId || undefined);
    setRoles(r);
    return r;
  }, []);

  const loadSystem = useCallback(async () => {
    setSysBusy(true);
    setSysMsg("");
    try {
      const statusPromise =
        canSettings && !selTenant
          ? Promise.resolve(null)
          : getAccurateStatus(selTenant || undefined).catch(() => null);
      const [h, m, s] = await Promise.all([
        getHealthDeep(),
        getMetrics().catch(() => null),
        statusPromise,
      ]);
      setHealth(h);
      setMetrics(m);
      setAccStatus(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal memuat status sistem.");
    } finally {
      setSysBusy(false);
    }
  }, [canSettings, selTenant]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadRoles(selTenant || undefined)
      .then((r) => {
        if (r[0]) {
          setSelRole(r[0].id);
          setInviteRole((cur) => cur || r[0]!.key);
        }
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
    if (tab === "usage") {
      setErr(null);
      void getUsage().then(setUsage).catch(onFetchErr);
      if (canSettings) void getPlatformAnalytics().then(setPlatformUsage).catch(() => null);
    }
    if (tab === "roles" && selRole) {
      const role = roles.find((x) => x.id === selRole);
      setChecked(new Set(role?.permissions ?? []));
    }
    if (tab === "features") {
      setErr(null);
      void getAdminFeatures().then(setFeatures).catch(onFetchErr);
    }
    if (tab === "audit") {
      setErr(null);
      void getAuditLogs(100, selTenant || undefined, auditAction || undefined)
        .then(setAuditRows)
        .catch(onFetchErr);
    }
    if (tab === "system") {
      setErr(null);
      void loadSystem();
    }
  }, [tab, selRole, roles, isAdmin, canSettings, selTenant, auditAction, loadSystem]);

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

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteBusy(true);
    setMsg(null);
    setErr(null);
    try {
      await inviteUser({
        email: inviteEmail.trim(),
        name: inviteName.trim(),
        roleKey: inviteRole,
        ...(canSettings && selTenant ? { tenantId: selTenant } : {}),
      });
      setInviteEmail("");
      setInviteName("");
      setMsg("Undangan terkirim.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal mengirim undangan.");
    } finally {
      setInviteBusy(false);
    }
  }

  async function setTenantSuspended(suspended: boolean) {
    if (!selTenant) return;
    setMsg(null);
    setErr(null);
    try {
      await suspendTenant(selTenant, suspended);
      setMsg(suspended ? "Tenant ditangguhkan." : "Tenant diaktifkan kembali.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal mengubah status tenant.");
    }
  }

  async function impersonate(userId: string) {
    setMsg(null);
    setErr(null);
    try {
      await impersonateUser(userId);
      window.location.href = "/app";
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal masuk sebagai user.");
    }
  }

  async function doReconcile() {
    setSysBusy(true);
    setSysMsg("");
    setErr(null);
    try {
      const r = await reconcileAccurate(selTenant || undefined);
      setSysMsg(`Rekonsiliasi selesai: ${r.credited} pesanan dikreditkan.`);
      await loadSystem();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal rekonsiliasi.");
    } finally {
      setSysBusy(false);
    }
  }

  async function saveFeatures() {
    if (!features) return;
    setMsg(null);
    setErr(null);
    try {
      setFeatures(await putAdminFeatures(features));
      setMsg("Feature flag disimpan.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan feature flag.");
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
  if (me === null) return null;

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
        <p className="page__sub">Kelola user dan hak akses peran perusahaan.</p>

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
            <div className="btn-row" style={{ marginTop: "var(--space-xs)" }}>
              <button className="btn btn--danger btn--sm" onClick={() => void setTenantSuspended(true)}>
                Tangguhkan tenant
              </button>
              <button className="btn btn--2 btn--sm" onClick={() => void setTenantSuspended(false)}>
                Aktifkan kembali
              </button>
            </div>
          </div>
        )}

        <div className="tabs" role="group" aria-label="Bagian Admin">
          <button className="tab" aria-pressed={tab === "users"} onClick={() => setTab("users")}>
            User
          </button>
          <button className="tab" aria-pressed={tab === "roles"} onClick={() => setTab("roles")}>
            Peran
          </button>
          <button className="tab" aria-pressed={tab === "usage"} onClick={() => setTab("usage")}>
            Pemakaian AI
          </button>
          {canSettings && (
            <button className="tab" aria-pressed={tab === "features"} onClick={() => setTab("features")}>
              Fitur
            </button>
          )}
          <button className="tab" aria-pressed={tab === "audit"} onClick={() => setTab("audit")}>
            Audit
          </button>
          <button className="tab" aria-pressed={tab === "system"} onClick={() => setTab("system")}>
            Sistem
          </button>
        </div>

        {msg && <p className="banner banner--ok" role="status">{msg}</p>}
        {err && <p className="banner banner--err" role="alert">{err}</p>}

        {tab === "users" && (
          <>
          <form className="card" onSubmit={(e) => void sendInvite(e)} style={{ marginBottom: "var(--space-s)" }}>
            <strong className="card__title">Undang user</strong>
            <p className="meta" style={{ marginTop: 0 }}>
              User menerima email untuk membuat password. Tidak perlu lewat OAuth Accurate.
            </p>
            <div className="admin-invite-grid">
              <label className="field">
                Nama
                <input className="input" value={inviteName} onChange={(e) => setInviteName(e.target.value)} required maxLength={120} />
              </label>
              <label className="field">
                Email
                <input className="input" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
              </label>
              <label className="field">
                Role
                <select className="select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                  {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                </select>
              </label>
              <button className="btn" type="submit" disabled={inviteBusy || !inviteRole}>
                {inviteBusy ? "Mengirim…" : "Kirim undangan"}
              </button>
            </div>
          </form>
          <div className="table-wrap">
            <table className="table table--users">
              <thead>
                <tr>
                  <th className="th-no" style={{ width: 40 }}>No</th>
                  <th>Nama</th>
                  <th className="th-email">Email</th>
                  <th className="th-role">Role</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <Fragment key={u.id}>
                    <tr
                      className="user-row"
                      aria-expanded={openUser === u.id}
                      onClick={() => setOpenUser(openUser === u.id ? null : u.id)}
                    >
                      <td className="td-no">{i + 1}</td>
                      <td>
                        {u.name}
                        <span className="user-row__chev" aria-hidden="true">
                          {openUser === u.id ? "▾" : "▸"}
                        </span>
                      </td>
                      <td className="td-email muted">{u.email}</td>
                      <td className="td-role">
                        <select
                          className="select"
                          style={{ maxWidth: 180 }}
                          value={u.roleKey}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => void changeRole(u.id, e.target.value)}
                          aria-label={`Role ${u.name}`}
                        >
                          {roles.map((r) => (
                            <option key={r.key} value={r.key}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                        {canSettings && (
                          <button
                            className="btn btn--ghost btn--sm"
                            style={{ marginLeft: 6 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              void impersonate(u.id);
                            }}
                          >
                            Masuk
                          </button>
                        )}
                      </td>
                    </tr>
                    <tr className={`user-detail${openUser === u.id ? " is-open" : ""}`}>
                      <td colSpan={4}>
                        <dl className="user-detail__list">
                          <dt>Email</dt>
                          <dd>{u.email}</dd>
                          <dt>Role</dt>
                          <dd>
                            <select
                              className="select"
                              value={u.roleKey}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => void changeRole(u.id, e.target.value)}
                              aria-label={`Role ${u.name} (detail)`}
                            >
                              {roles.map((r) => (
                                <option key={r.key} value={r.key}>
                                  {r.name}
                                </option>
                              ))}
                            </select>
                          </dd>
                        </dl>
                      </td>
                    </tr>
                  </Fragment>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty">Belum ada user.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </>
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

            <h3 className="section-title" style={{ marginTop: "var(--space-s)" }}>Modul Accurate</h3>
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

        {tab === "usage" && (
          <div>
            <div className="card" style={{ marginBottom: "var(--space-m)" }}>
              <strong>Pemakaian AI hari ini</strong>
              <p style={{ color: "var(--ink-2)", margin: "var(--space-xs) 0 0" }}>
                {usage
                  ? `${usage.today.tokens.toLocaleString("id-ID")} token dari ${usage.today.calls.toLocaleString("id-ID")} panggilan` +
                    (usage.limit > 0 ? ` · kuota harian ${usage.limit.toLocaleString("id-ID")} token` : " · tanpa kuota")
                  : "Memuat…"}
              </p>
            </div>
            {usage && usage.days.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Tanggal</th>
                      <th scope="col">Panggilan</th>
                      <th scope="col">Token</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...usage.days].reverse().map((d) => (
                      <tr key={d.day}>
                        <td>{d.day}</td>
                        <td>{d.calls.toLocaleString("id-ID")}</td>
                        <td>{d.tokens.toLocaleString("id-ID")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {platformUsage && (
              <>
                <h3 style={{ margin: "var(--space-l) 0 var(--space-s)" }}>Semua perusahaan (30 hari)</h3>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Perusahaan</th>
                        <th scope="col">Panggilan</th>
                        <th scope="col">Token</th>
                        <th scope="col">Sesi</th>
                        <th scope="col">User</th>
                        <th scope="col">Terakhir</th>
                      </tr>
                    </thead>
                    <tbody>
                      {platformUsage.tenants.map((t) => (
                        <tr key={t.tenantId}>
                          <td>{t.name}</td>
                          <td>{t.calls.toLocaleString("id-ID")}</td>
                          <td>{t.tokens.toLocaleString("id-ID")}</td>
                          <td>{t.sessions}</td>
                          <td>{t.users}</td>
                          <td>{t.lastDay || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "features" && canSettings && (
          <div className="card">
            <strong className="card__title">Feature flag &amp; kill switch</strong>
            <p className="meta" style={{ marginTop: 0 }}>
              Matikan fitur tertentu tanpa deploy ulang. Perubahan berlaku pada request berikutnya.
            </p>
            {!features ? (
              <PageLoader label="Memuat fitur…" />
            ) : (
              <>
                <div className="stack" style={{ gap: 0 }}>
                  {Object.entries(features).map(([key, value]) => (
                    <label key={key} className="check">
                      <input
                        type="checkbox"
                        checked={value}
                        onChange={(e) => setFeatures({ ...features, [key]: e.target.checked })}
                      />
                      <span>{key}</span>
                    </label>
                  ))}
                </div>
                <div className="btn-row" style={{ marginTop: "var(--space-s)" }}>
                  <button className="btn" onClick={() => void saveFeatures()}>Simpan</button>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "audit" && (
          <div>
            <form
              className="card"
              onSubmit={(e) => {
                e.preventDefault();
                setAuditAction(auditDraft.trim());
              }}
            >
              <div className="btn-row" style={{ alignItems: "flex-end" }}>
                <label className="field" style={{ flex: 1, minWidth: 200 }}>
                  Filter action
                  <input
                    className="input"
                    value={auditDraft}
                    onChange={(e) => setAuditDraft(e.target.value)}
                    placeholder="tool.call, auth.login, role.permissions.update…"
                  />
                </label>
                <button className="btn" type="submit">Terapkan</button>
                <a
                  className="btn btn--2"
                  href={`/api/admin/audit/export?limit=2000${selTenant ? `&tenantId=${encodeURIComponent(selTenant)}` : ""}${auditAction ? `&action=${encodeURIComponent(auditAction)}` : ""}`}
                >
                  Export CSV
                </a>
              </div>
            </form>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Waktu</th>
                    <th scope="col">Tenant</th>
                    <th scope="col">User</th>
                    <th scope="col">Action</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{new Date(r.createdAt).toLocaleString("id-ID")}</td>
                      <td>{r.tenantName ?? "-"}</td>
                      <td className="muted">{r.userEmail}</td>
                      <td><code>{r.action}</code></td>
                      <td title={r.detail}>
                        <code style={{ fontSize: "0.72rem" }}>{r.detail.length > 120 ? `${r.detail.slice(0, 117)}…` : r.detail}</code>
                      </td>
                    </tr>
                  ))}
                  {auditRows.length === 0 && (
                    <tr><td colSpan={5} className="empty">Belum ada audit log.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "system" && (
          <div className="stack">
            <div className="btn-row" style={{ alignItems: "center" }}>
              <button className="btn" onClick={() => void loadSystem()} disabled={sysBusy}>
                {sysBusy ? "Memuat…" : "Muat ulang"}
              </button>
              <button
                className="btn btn--2"
                onClick={() => void doReconcile()}
                disabled={sysBusy || (canSettings && !selTenant)}
              >
                Rekonsiliasi wallet
              </button>
              {sysMsg && <span className="meta" role="status">{sysMsg}</span>}
            </div>

            <div className="card">
              <strong className="card__title">Health check</strong>
              {health?.checks ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Layanan</th><th>Status</th><th>Latensi</th></tr></thead>
                    <tbody>
                      {Object.entries(health.checks).map(([name, c]) => (
                        <tr key={name}>
                          <td style={{ textTransform: "capitalize" }}>{name}</td>
                          <td>
                            <span className={`account-dot${c.ok ? " is-on" : ""}`} style={{ display: "inline-block", marginRight: 6 }} />
                            {c.ok ? "OK" : "Gagal"}
                          </td>
                          <td>{c.ms != null ? `${c.ms} ms` : c.error ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="meta">Tidak dapat memuat health check.</p>
              )}
            </div>

            <div className="card">
              <strong className="card__title">Status Accurate &amp; sinkronisasi</strong>
              {canSettings && !selTenant ? (
                <p className="meta">Pilih perusahaan di atas untuk melihat status Accurate.</p>
              ) : accStatus ? (
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      <tr><td>Perusahaan</td><td>{accStatus.tenant.name} ({accStatus.tenant.alias})</td></tr>
                      <tr><td>Koneksi</td><td>{accStatus.connection ? `${accStatus.connection.status} · ${accStatus.connection.host}` : "belum terhubung"}</td></tr>
                      <tr><td>Token expired</td><td>{accStatus.connection ? new Date(accStatus.connection.expiresAt).toLocaleString("id-ID") : "-"}</td></tr>
                      <tr><td>Sync terakhir</td><td>{accStatus.lastMetric ? `${accStatus.lastMetric.date} · ${new Date(accStatus.lastMetric.updatedAt).toLocaleString("id-ID")}` : "belum ada"}</td></tr>
                      <tr><td>Webhook 24 jam</td><td>{accStatus.webhookCount24h} event{accStatus.lastWebhook ? ` · terakhir ${accStatus.lastWebhook.event}` : ""}</td></tr>
                      <tr><td>Wallet penjualan</td><td>Rp{accStatus.wallet.available.toLocaleString("id-ID")} tersedia · Rp{accStatus.wallet.pendingWithdrawal.toLocaleString("id-ID")} pending</td></tr>
                      <tr><td>AI hari ini</td><td>{accStatus.ai.tokens.toLocaleString("id-ID")} token · {accStatus.ai.calls} panggilan{accStatus.ai.limit ? ` · limit ${accStatus.ai.limit.toLocaleString("id-ID")}` : ""}</td></tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="meta">Tidak dapat memuat status Accurate.</p>
              )}
            </div>

            <div className="card">
              <strong className="card__title">Metrik runtime</strong>
              {metrics ? (
                <>
                  <p className="meta" style={{ marginTop: 0 }}>
                    Uptime {Math.floor(metrics.uptimeSec / 60)} menit · memori {metrics.memoryMb} MB · LLM {metrics.llm.calls} panggilan
                  </p>
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Rute</th><th>Request</th><th>Error</th><th>p95</th></tr></thead>
                      <tbody>
                        {metrics.routes.slice(0, 10).map((r) => (
                          <tr key={r.route}>
                            <td><code>{r.route}</code></td>
                            <td>{r.count}</td>
                            <td>{r.errors}</td>
                            <td>{r.p95} ms</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="meta">Metrik tidak tersedia untuk peran ini.</p>
              )}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
