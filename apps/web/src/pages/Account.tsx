import { useCallback, useEffect, useState } from "react";
import {
  disable2fa,
  enable2fa,
  getMe,
  regenerateBackupCodes,
  resendVerification,
  setEmailOtp,
  setup2fa,
  updateProfile,
  type TwoFactorSetup,
} from "../api";
import { AppHeader, PageLoader } from "../ui";
import { getPushSubscriptionState, disablePush, enablePush } from "../push";
import { IconBell, IconCheck, IconPhone, IconPower, IconUsers } from "../icons";

type MeInfo = NonNullable<Awaited<ReturnType<typeof getMe>>>;

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "AI";
  return (words[0]![0] + (words.length > 1 ? words[words.length - 1]![0] : "")).toUpperCase();
}

function roleLabel(key?: string): string {
  if (key === "platform-admin") return "Platform Admin";
  if (key === "accurate-admin") return "Admin";
  if (key === "staff") return "Staff";
  return key || "Anggota";
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
  busy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle${checked ? " is-on" : ""}`}
      onClick={() => onChange(!checked)}
      disabled={disabled || busy}
    >
      <span className="toggle__knob" aria-hidden="true">
        {busy ? <span className="spinner spinner--tiny" /> : null}
      </span>
    </button>
  );
}

export function Account() {
  const [me, setMe] = useState<MeInfo | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [twoFactorMode, setTwoFactorMode] = useState<"idle" | "setup" | "disable" | "backup">("idle");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [backupMsg, setBackupMsg] = useState("");
  const [otpPassword, setOtpPassword] = useState("");
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushMsg, setPushMsg] = useState("");
  const [verifyMsg, setVerifyMsg] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const m = await getMe(true);
    setMe(m);
    if (m) {
      setName(m.name);
      setPhone(m.phone ?? "");
    }
  }, []);

  useEffect(() => {
    void load();
    void getPushSubscriptionState().then(setPushEnabled);
  }, [load]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setBusy("profile");
    setMsg("");
    setErr("");
    try {
      await updateProfile({ name: name.trim(), phone: phone.trim() });
      await load();
      setMsg("Profil diperbarui.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan profil.");
    } finally {
      setBusy("");
    }
  }

  async function resendVerify() {
    setBusy("verify");
    setVerifyMsg("");
    try {
      await resendVerification();
      setVerifyMsg("Email verifikasi dikirim. Cek inbox/spam.");
    } catch (e) {
      setVerifyMsg(e instanceof Error ? e.message : "Gagal mengirim verifikasi.");
    } finally {
      setBusy("");
    }
  }

  async function start2fa() {
    setTwoFactorMode("setup");
    setBusy("2fa-setup");
    setMsg("");
    setErr("");
    try {
      setSetup(await setup2fa());
    } catch (e) {
      setTwoFactorMode("idle");
      setErr(e instanceof Error ? e.message : "Gagal memulai 2FA.");
    } finally {
      setBusy("");
    }
  }

  async function confirm2fa(e: React.FormEvent) {
    e.preventDefault();
    setBusy("2fa-enable");
    setMsg("");
    setErr("");
    try {
      const r = await enable2fa(code.replace(/\D/g, ""));
      setSetup(null);
      setTwoFactorMode("idle");
      setCode("");
      setBackupCodes(r.backupCodes);
      setBackupMsg("Simpan backup code ini sekarang. Tidak akan ditampilkan lagi.");
      await load();
      setMsg("2FA aktif. Simpan backup code di tempat aman.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Kode tidak valid.");
    } finally {
      setBusy("");
    }
  }

  async function turnOff2fa(e: React.FormEvent) {
    e.preventDefault();
    setBusy("2fa-disable");
    setMsg("");
    setErr("");
    try {
      await disable2fa(password, code.replace(/\D/g, ""));
      setTwoFactorMode("idle");
      setPassword("");
      setCode("");
      setBackupCodes([]);
      setBackupMsg("");
      await load();
      setMsg("2FA dinonaktifkan.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menonaktifkan 2FA.");
    } finally {
      setBusy("");
    }
  }

  async function regenerateBackup(e: React.FormEvent) {
    e.preventDefault();
    setBusy("2fa-backup");
    setMsg("");
    setErr("");
    try {
      const r = await regenerateBackupCodes(password, code.replace(/\D/g, ""));
      setBackupCodes(r.backupCodes);
      setBackupMsg("Backup code baru dibuat. Yang lama sudah tidak berlaku.");
      setTwoFactorMode("idle");
      setPassword("");
      setCode("");
      setMsg("Backup code diperbarui.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal membuat backup code.");
    } finally {
      setBusy("");
    }
  }

  async function copyBackupCodes() {
    await navigator.clipboard?.writeText(backupCodes.join("\n")).then(
      () => setBackupMsg("Backup code disalin."),
      () => setErr("Gagal menyalin. Salin manual.")
    );
  }

  function downloadBackupCodes() {
    const blob = new Blob([backupCodes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ai-asisten-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function toggleEmailOtp(enabled: boolean) {
    if (!otpPassword) {
      setErr("Isi password untuk mengubah OTP email.");
      return;
    }
    setBusy("email-otp");
    setMsg("");
    setErr("");
    try {
      await setEmailOtp(enabled, otpPassword);
      setOtpPassword("");
      await load();
      setMsg(enabled ? "OTP via email diaktifkan." : "OTP via email dimatikan.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal mengubah OTP email.");
    } finally {
      setBusy("");
    }
  }

  async function togglePush(next: boolean) {
    setBusy("push");
    setPushMsg("");
    try {
      if (next) {
        const r = await enablePush();
        setPushEnabled(r.ok);
        setPushMsg(r.ok ? "Notifikasi aktif di perangkat ini." : (r.error ?? "Gagal mengaktifkan notifikasi."));
      } else {
        await disablePush();
        setPushEnabled(false);
        setPushMsg("Notifikasi dimatikan di perangkat ini.");
      }
    } catch (e) {
      setPushEnabled(false);
      setPushMsg(e instanceof Error ? e.message : "Gagal mengubah notifikasi.");
    } finally {
      setBusy("");
    }
  }

  function copyText(text: string) {
    void navigator.clipboard?.writeText(text).then(
      () => setMsg("Secret disalin."),
      () => setErr("Gagal menyalin. Salin manual dari teks di atas.")
    );
  }

  if (me === undefined) {
    return (
      <div className="app">
        <main className="page page--narrow"><PageLoader /></main>
      </div>
    );
  }
  if (me === null) {
    window.location.href = "/login";
    return null;
  }

  const twoFactorBusy = busy.startsWith("2fa");
  const emailOtpBusy = busy === "email-otp";
  const pushBusy = busy === "push";

  return (
    <div className="app">
      <AppHeader me={me} />
      <main className="page account-page">
        {msg && <p className="banner banner--ok" role="status">{msg}</p>}
        {err && <p className="banner banner--err" role="alert">{err}</p>}

        <section className="account-hero">
          <div className="account-avatar" aria-hidden="true">{initials(me.name)}</div>
          <div className="account-hero__body">
            <h1>{me.name}</h1>
            <p className="account-hero__email">{me.email}</p>
            <div className="account-chips">
              <span className="account-chip">{me.tenant.name}</span>
              <span className="account-chip">{roleLabel(me.roleKey)}</span>
              <span className={`account-chip${me.emailVerified ? " is-ok" : ""}`}>
                {me.emailVerified ? <IconCheck size={12} /> : null}
                {me.emailVerified ? "Email terverifikasi" : "Email belum diverifikasi"}
              </span>
            </div>
          </div>
        </section>

        <div className="account-grid">
          <section className="account-card account-card--wide">
            <div className="account-card__head">
              <span className="account-card__icon"><IconUsers size={18} /></span>
              <div className="account-card__title">
                <strong>Profil</strong>
                <span>Nama dan nomor HP yang dipakai di aplikasi.</span>
              </div>
            </div>
            <form onSubmit={(e) => void saveProfile(e)} className="account-form">
              <div className="account-form__row">
                <label className="field">
                  Nama
                  <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="field">
                  Nomor HP
                  <span className="account-input-wrap">
                    <IconPhone size={16} />
                    <input className="input" value={phone} maxLength={32} onChange={(e) => setPhone(e.target.value)} placeholder="0812xxxxxxx" />
                  </span>
                </label>
              </div>
              <div className="account-form__foot">
                <span className="account-note">Email login: <strong>{me.email}</strong></span>
                <button className="btn" type="submit" disabled={busy === "profile"}>
                  {busy === "profile" ? "Menyimpan…" : "Simpan profil"}
                </button>
              </div>
            </form>
            {!me.emailVerified && (
              <div className="account-verify">
                <span>Email belum diverifikasi.</span>
                <button className="btn btn--2 btn--sm" onClick={() => void resendVerify()} disabled={busy === "verify"}>
                  {busy === "verify" ? "Mengirim…" : "Kirim ulang verifikasi"}
                </button>
              </div>
            )}
            {verifyMsg && <p className="account-note" role="status">{verifyMsg}</p>}
          </section>

          <section className="account-card">
            <div className="account-card__head">
              <span className="account-card__icon"><IconPower size={18} /></span>
              <div className="account-card__title">
                <strong>2FA Authenticator</strong>
                <span>Kode 6 digit dari Google Authenticator/Authy.</span>
              </div>
              <Toggle
                checked={!!me.twoFactorEnabled}
                label="Aktifkan 2FA authenticator"
                busy={twoFactorBusy && twoFactorMode === "idle"}
                disabled={twoFactorMode !== "idle"}
                onChange={(next) => {
                  setMsg("");
                  setErr("");
                  setCode("");
                  setPassword("");
                  if (next) void start2fa();
                  else setTwoFactorMode("disable");
                }}
              />
            </div>
            <p className="account-status">
              <span className={`account-dot${me.twoFactorEnabled ? " is-on" : ""}`} />
              {me.twoFactorEnabled ? "Aktif — login meminta kode authenticator." : "Belum aktif."}
            </p>

            {twoFactorMode === "setup" && (
              <div className="account-panel">
                {setup ? (
                  <>
                    {setup.qrDataUrl && (
                      <img className="account-qr" src={setup.qrDataUrl} alt="QR code 2FA" width={180} height={180} />
                    )}
                    <p className="account-note">Scan QR di atas, atau tambahkan secret ini secara manual:</p>
                    <div className="account-secret">
                      <code>{setup.secret}</code>
                      <button type="button" className="btn btn--2 btn--sm" onClick={() => copyText(setup.secret)}>
                        Salin
                      </button>
                    </div>
                    <a className="account-link" href={setup.uri}>Buka aplikasi authenticator →</a>
                    <form onSubmit={(e) => void confirm2fa(e)} className="account-inline-form">
                      <label className="field">
                        Kode 6 digit
                        <input className="input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
                      </label>
                      <button className="btn" type="submit" disabled={busy === "2fa-enable"}>Aktifkan</button>
                      <button className="btn btn--ghost" type="button" onClick={() => { setTwoFactorMode("idle"); setSetup(null); setCode(""); }}>Batal</button>
                    </form>
                  </>
                ) : (
                  <p className="account-note">Menyiapkan secret…</p>
                )}
              </div>
            )}

            {twoFactorMode === "disable" && (
              <form onSubmit={(e) => void turnOff2fa(e)} className="account-panel">
                <p className="account-note">Masukkan password dan kode authenticator saat ini untuk menonaktifkan.</p>
                <div className="account-inline-form">
                  <label className="field">
                    Password
                    <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                  </label>
                  <label className="field">
                    Kode 6 digit
                    <input className="input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
                  </label>
                  <button className="btn btn--danger" type="submit" disabled={busy === "2fa-disable"}>Nonaktifkan</button>
                  <button className="btn btn--ghost" type="button" onClick={() => { setTwoFactorMode("idle"); setPassword(""); setCode(""); }}>Batal</button>
                </div>
              </form>
            )}

            {backupCodes.length > 0 && (
              <div className="account-panel account-backup">
                <p className="account-note">{backupMsg}</p>
                <div className="account-backup__grid">
                  {backupCodes.map((c) => <code key={c}>{c.slice(0, 4)}-{c.slice(4)}</code>)}
                </div>
                <div className="btn-row">
                  <button type="button" className="btn btn--2 btn--sm" onClick={() => void copyBackupCodes()}>Salin</button>
                  <button type="button" className="btn btn--2 btn--sm" onClick={downloadBackupCodes}>Unduh</button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setBackupCodes([]); setBackupMsg(""); }}>Selesai</button>
                </div>
              </div>
            )}

            {me.twoFactorEnabled && twoFactorMode === "idle" && (
              <div className="account-panel account-backup-actions">
                <p className="account-note">
                  {me.backupCodesRemaining
                    ? `${me.backupCodesRemaining} backup code tersisa.`
                    : "Tidak ada backup code. Buat baru agar bisa login jika HP hilang."}
                </p>
                <button
                  type="button"
                  className="btn btn--2 btn--sm"
                  onClick={() => { setTwoFactorMode("backup"); setPassword(""); setCode(""); }}
                >
                  Buat ulang backup code
                </button>
              </div>
            )}

            {twoFactorMode === "backup" && (
              <form onSubmit={(e) => void regenerateBackup(e)} className="account-panel">
                <p className="account-note">Masukkan password dan kode authenticator untuk membuat 10 backup code baru.</p>
                <div className="account-inline-form">
                  <label className="field">
                    Password
                    <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                  </label>
                  <label className="field">
                    Kode 6 digit
                    <input className="input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
                  </label>
                  <button className="btn" type="submit" disabled={busy === "2fa-backup"}>Buat baru</button>
                  <button className="btn btn--ghost" type="button" onClick={() => { setTwoFactorMode("idle"); setPassword(""); setCode(""); }}>Batal</button>
                </div>
              </form>
            )}
          </section>

          <section className="account-card">
            <div className="account-card__head">
              <span className="account-card__icon"><IconBell size={18} /></span>
              <div className="account-card__title">
                <strong>OTP via email</strong>
                <span>Faktor kedua default setiap login.</span>
              </div>
              <Toggle
                checked={!!me.emailOtpEnabled}
                label="Aktifkan OTP via email"
                busy={emailOtpBusy}
                disabled={!otpPassword}
                onChange={(next) => void toggleEmailOtp(next)}
              />
            </div>
            <p className="account-status">
              <span className={`account-dot${me.emailOtpEnabled ? " is-on" : ""}`} />
              {me.emailOtpEnabled ? "Aktif — kode dikirim ke email." : "Nonaktif."}
            </p>
            <label className="field account-confirm">
              Konfirmasi password untuk mengubah
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={otpPassword}
                onChange={(e) => setOtpPassword(e.target.value)}
                placeholder="Password akun Anda"
              />
            </label>
          </section>

          <section className="account-card account-card--wide">
            <div className="account-card__head">
              <span className="account-card__icon"><IconBell size={18} /></span>
              <div className="account-card__title">
                <strong>Notifikasi push</strong>
                <span>Pengingat langganan, saldo menipis, dan pesanan baru.</span>
              </div>
              <Toggle
                checked={pushEnabled}
                label="Aktifkan notifikasi push"
                busy={pushBusy}
                onChange={(next) => void togglePush(next)}
              />
            </div>
            <p className="account-status">
              <span className={`account-dot${pushEnabled ? " is-on" : ""}`} />
              {pushEnabled ? "Aktif di perangkat ini." : "Nonaktif di perangkat ini."}
            </p>
            {pushMsg && <p className="account-note" role="status">{pushMsg}</p>}
          </section>
        </div>
      </main>
    </div>
  );
}
