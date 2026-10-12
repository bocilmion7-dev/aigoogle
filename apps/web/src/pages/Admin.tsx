import { useCallback, useEffect, useState } from "react";
import {
  getAdminUsers,
  getAuditLogs,
  getPrivileges,
  getRoles,
  putRolePermissions,
  putUserRole,
  type AdminRole,
  type AdminUser,
  type AuditRow,
  type PrivilegesPayload,
} from "../api";

const card: React.CSSProperties = {
  border: "1px solid #e3ddd4",
  borderRadius: 6,
  padding: 16,
  marginBottom: 12,
  background: "#faf8f5",
  fontFamily: "system-ui",
};
const btn: React.CSSProperties = {
  border: "none",
  borderRadius: 4,
  padding: "8px 14px",
  cursor: "pointer",
  background: "#3d6b54",
  color: "white",
  fontSize: 14,
};
const tabBtn = (active: boolean): React.CSSProperties => ({
  ...btn,
  background: active ? "#3d6b54" : "#eeeae3",
  color: active ? "white" : "#333",
  marginRight: 8,
});

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

  const loadRoles = useCallback(async () => {
    const r = await getRoles();
    setRoles(r);
    return r;
  }, []);

  useEffect(() => {
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
  }, [loadRoles]);

  const onFetchErr = (e: unknown) => {
    if (e instanceof Error && e.message === "belum_login") window.location.href = "/login";
    else setErr("Gagal memuat data.");
  };

  useEffect(() => {
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
  }, [tab, selRole, roles]);

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

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "40px auto", padding: 24 }}>
      <h1 style={{ fontSize: 24 }}>Admin</h1>
      <div style={{ margin: "16px 0" }}>
        <button style={tabBtn(tab === "users")} onClick={() => setTab("users")}>
          User
        </button>
        <button style={tabBtn(tab === "roles")} onClick={() => setTab("roles")}>
          Peran
        </button>
        <button style={tabBtn(tab === "audit")} onClick={() => setTab("audit")}>
          Audit
        </button>
      </div>
      {msg && <p style={{ color: "#3d6b54", fontSize: 14 }}>{msg}</p>}
      {err && <p style={{ color: "#a33", fontSize: 14 }}>{err}</p>}

      {tab === "users" && (
        <div style={card}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#666" }}>
                <th style={{ padding: 6 }}>Nama</th>
                <th style={{ padding: 6 }}>Email</th>
                <th style={{ padding: 6 }}>Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderTop: "1px solid #e3ddd4" }}>
                  <td style={{ padding: 6 }}>{u.name}</td>
                  <td style={{ padding: 6, color: "#555" }}>{u.email}</td>
                  <td style={{ padding: 6 }}>
                    <select value={u.roleKey} onChange={(e) => void changeRole(u.id, e.target.value)} style={{ padding: 4 }}>
                      {roles.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "roles" && (
        <div style={card}>
          <label style={{ fontSize: 14, color: "#555" }}>
            Role:{" "}
            <select value={selRole} onChange={(e) => setSelRole(e.target.value)} style={{ padding: 4 }}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <h3 style={{ fontSize: 15, color: "#3d6b54", marginTop: 16 }}>Modul Accurate</h3>
          {priv?.modules.map((m) => (
            <label key={m.key} style={{ display: "block", fontSize: 14, padding: "4px 0" }}>
              <input
                type="checkbox"
                checked={checked.has(m.key)}
                onChange={(e) => {
                  const next = new Set(checked);
                  e.target.checked ? next.add(m.key) : next.delete(m.key);
                  setChecked(next);
                }}
              />{" "}
              {m.label} <span style={{ color: "#888", fontSize: 12 }}>({m.key})</span>
              {m.mirrorChecked && !checked.has(m.key) && (
                <span style={{ color: "#888", fontSize: 12 }}> — default Accurate: aktif</span>
              )}
            </label>
          ))}
          <h3 style={{ fontSize: 15, color: "#3d6b54", marginTop: 16 }}>Fitur Aplikasi</h3>
          {priv?.appFeatures.map((f) => (
            <label key={f.key} style={{ display: "block", fontSize: 14, padding: "4px 0" }}>
              <input
                type="checkbox"
                checked={checked.has(f.key)}
                onChange={(e) => {
                  const next = new Set(checked);
                  e.target.checked ? next.add(f.key) : next.delete(f.key);
                  setChecked(next);
                }}
              />{" "}
              {f.label} <span style={{ color: "#888", fontSize: 12 }}>({f.key})</span>
            </label>
          ))}
          <button style={{ ...btn, marginTop: 12 }} onClick={() => void saveRole()}>
            Simpan Hak Akses
          </button>
        </div>
      )}

      {tab === "audit" && (
        <div style={card}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#666" }}>
                <th style={{ padding: 6 }}>Waktu</th>
                <th style={{ padding: 6 }}>User</th>
                <th style={{ padding: 6 }}>Aksi</th>
                <th style={{ padding: 6 }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} style={{ borderTop: "1px solid #e3ddd4" }}>
                  <td style={{ padding: 6, whiteSpace: "nowrap" }}>{new Date(a.createdAt).toLocaleString("id-ID")}</td>
                  <td style={{ padding: 6 }}>{a.userEmail}</td>
                  <td style={{ padding: 6 }}>{a.action}</td>
                  <td style={{ padding: 6, color: "#555", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{a.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
