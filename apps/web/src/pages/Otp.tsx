import { useEffect, useRef, useState } from "react";
import { getEmailOtpInfo, resendEmailOtp, verifyEmailOtp } from "../api";
import { track } from "../telemetry";

const LEN = 6;

export function Otp() {
  const [challenge, setChallenge] = useState(
    new URLSearchParams(window.location.search).get("challenge") ?? ""
  );
  const [digits, setDigits] = useState<string[]>(Array(LEN).fill(""));
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailMasked, setEmailMasked] = useState("");
  const [seconds, setSeconds] = useState(60);
  const [shake, setShake] = useState(false);
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const submitted = useRef(false);

  useEffect(() => {
    if (!challenge) return;
    void getEmailOtpInfo(challenge)
      .then((info) => {
        setEmailMasked(info.emailMasked);
        setSeconds(Math.max(0, Math.ceil((info.resendAfter - Date.now()) / 1000)));
      })
      .catch(() => setSeconds(60));
  }, [challenge]);

  useEffect(() => {
    const t = window.setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const code = digits.join("");

  useEffect(() => {
    if (code.length === LEN && !busy && !success && !submitted.current) {
      submitted.current = true;
      void submitCode(code);
    }
    if (code.length < LEN) submitted.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  function setAt(index: number, value: string) {
    const clean = value.replace(/\D/g, "");
    if (!clean) {
      setDigits((d) => d.map((v, i) => (i === index ? "" : v)));
      return;
    }
    if (clean.length > 1) {
      const chars = clean.slice(0, LEN - index).split("");
      setDigits((d) => {
        const next = [...d];
        chars.forEach((c, i) => {
          if (index + i < LEN) next[index + i] = c;
        });
        return next;
      });
      const target = Math.min(LEN - 1, index + chars.length);
      refs.current[target]?.focus();
      return;
    }
    setDigits((d) => d.map((v, i) => (i === index ? clean : v)));
    if (index < LEN - 1) refs.current[index + 1]?.focus();
  }

  function onKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      e.preventDefault();
      refs.current[index - 1]?.focus();
      setDigits((d) => d.map((v, i) => (i === index - 1 ? "" : v)));
    }
    if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      refs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowRight" && index < LEN - 1) {
      e.preventDefault();
      refs.current[index + 1]?.focus();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void submitCode(digits.join(""));
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LEN);
    if (!text) return;
    const next = Array(LEN).fill("");
    text.split("").forEach((c, i) => {
      next[i] = c;
    });
    setDigits(next);
    const target = Math.min(LEN - 1, text.length);
    refs.current[target]?.focus();
  }

  async function submitCode(value: string) {
    if (!challenge || value.length !== LEN || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await verifyEmailOtp(challenge, value);
      setSuccess(true);
      track("otp_verified", { platform: r.platform });
      window.setTimeout(() => {
        window.location.href = r.platform ? "/admin" : r.needsPassword ? "/set-password" : "/app";
      }, 550);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(
        msg === "kode_salah" || msg === "challenge_tidak_valid"
          ? "Kode salah atau sudah kedaluwarsa. Coba lagi atau kirim ulang kode."
          : msg || "Gagal memverifikasi kode."
      );
      setShake(true);
      window.setTimeout(() => setShake(false), 450);
      setDigits(Array(LEN).fill(""));
      refs.current[0]?.focus();
      submitted.current = false;
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!challenge || busy || seconds > 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await resendEmailOtp(challenge);
      setChallenge(r.challenge);
      setDigits(Array(LEN).fill(""));
      setSeconds(60);
      submitted.current = false;
      const url = new URL(window.location.href);
      url.searchParams.set("challenge", r.challenge);
      window.history.replaceState(null, "", url.toString());
      refs.current[0]?.focus();
      track("otp_resent");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "tunggu_sebentar") {
        setSeconds(60);
        setError("Tunggu sebentar sebelum meminta kode baru.");
      } else {
        setError(msg || "Gagal mengirim ulang kode.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth2 otp-shell">
      <div className="auth2__grid">
        <aside className="auth2__aside otp-aside">
          <a className="auth2__brand" href="/">
            <span className="auth2__mark" aria-hidden="true">AI</span>
            <span>AI Asisten</span>
          </a>
          <div className="otp-aside__art" aria-hidden="true">
            <span className="otp-aside__ring" />
            <span className="otp-aside__icon">✉</span>
          </div>
          <h2 className="auth2__headline">Satu kode lagi.</h2>
          <p className="auth2__sub">
            Kami mengirim kode 6 digit ke email akun Anda. Kode berlaku 10 menit dan hanya bisa dipakai sekali.
          </p>
          <span className="auth2__foot">© {new Date().getFullYear()} AI Asisten</span>
        </aside>

        <main className="auth2__main otp-main">
          <div className={`auth2__card otp-card${shake ? " otp-card--shake" : ""}${success ? " otp-card--success" : ""}`}>
            <img src="/logo-ai-asisten.webp" alt="AI Asisten" className="otp-logo" width={126} height={42} />
            <div className="otp-head">
              <span className="otp-badge" aria-hidden="true">
                {success ? "✓" : "✉"}
              </span>
              <div>
                <h1>{success ? "Terverifikasi" : "Masukkan kode OTP"}</h1>
                <p className="otp-sub">
                  {success
                    ? "Mengalihkan ke aplikasi…"
                    : emailMasked
                      ? `Dikirim ke ${emailMasked}`
                      : "Dikirim ke email akun Anda"}
                </p>
              </div>
            </div>

            {!challenge ? (
              <p className="banner banner--err" role="alert">
                Sesi OTP tidak valid. Silakan login ulang.
              </p>
            ) : (
              <>
                <div
                  className="otp-inputs"
                  role="group"
                  aria-label="Kode OTP 6 digit"
                  onPaste={onPaste}
                >
                  {digits.map((d, i) => (
                    <input
                      key={i}
                      ref={(el) => { refs.current[i] = el; }}
                      className={`otp-input${d ? " is-filled" : ""}`}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete={i === 0 ? "one-time-code" : "off"}
                      maxLength={LEN}
                      value={d}
                      aria-label={`Digit ${i + 1}`}
                      disabled={busy || success}
                      onChange={(e) => setAt(i, e.target.value)}
                      onKeyDown={(e) => onKeyDown(i, e)}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  ))}
                </div>

                <div className="otp-actions">
                  <button
                    className="btn btn--primary otp-verify"
                    type="button"
                    onClick={() => void submitCode(code)}
                    disabled={busy || success || code.length !== LEN}
                    aria-busy={busy}
                  >
                    {busy ? <span className="spinner" aria-hidden="true" /> : null}
                    {success ? "Berhasil" : busy ? "Memverifikasi…" : "Verifikasi"}
                  </button>
                  <button
                    className="btn btn--ghost otp-resend"
                    type="button"
                    onClick={() => void resend()}
                    disabled={busy || seconds > 0}
                  >
                    {seconds > 0 ? `Kirim ulang dalam ${seconds}s` : "Kirim ulang kode"}
                  </button>
                </div>

                {error && (
                  <p className="banner banner--err otp-error" role="alert">
                    {error}
                  </p>
                )}

                <div className="otp-progress" aria-hidden="true">
                  <span style={{ width: `${Math.max(0, Math.min(100, (seconds / 60) * 100))}%` }} />
                </div>
                <p className="otp-hint">
                  Tidak menerima email? Cek folder spam, atau kirim ulang setelah timer habis.
                </p>
              </>
            )}
            <a className="auth2__back" href="/login">← Kembali ke login</a>
          </div>
        </main>
      </div>
    </div>
  );
}
