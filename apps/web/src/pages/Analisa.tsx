import { useCallback, useEffect, useState } from "react";
import { getMe } from "../api";
import { AppHeader } from "../ui";
import { IconActivity, IconCheck, IconRefresh, IconSearch, IconWallet } from "../icons";

interface Metric {
  key: string;
  label: string;
  value: string;
  raw: number;
  hint: string;
}
interface Finding {
  severity: "sehat" | "perhatian" | "kritis";
  title: string;
  detail: string;
  advice: string;
}
interface Payload {
  generatedAt: string;
  period: { from: string; to: string; label: string };
  profile: {
    industry: string[];
    industryKeys: string[];
    playbook: string;
    focus: string[];
    scale: "mikro" | "kecil" | "menengah";
    businessModel: string;
  };
  verdict: "sehat" | "perhatian" | "kritis";
  score: number;
  metrics: Metric[];
  findings: Finding[];
  priorities: string[];
  narrative: string;
  source: "accurate";
}

const VERDICT_LABEL: Record<string, string> = {
  sehat: "Bisnis Sehat",
  perhatian: "Perlu Perhatian",
  kritis: "Butuh Tindakan",
};
const VERDICT_SUB: Record<string, string> = {
  sehat: "Kinerja baik — pertahankan dan kembangkan",
  perhatian: "Ada hal yang perlu diperbaiki segera",
  kritis: "Prioritas utama: perbaiki fundamental bisnis",
};
const SEVERITY_LABEL: Record<string, string> = {
  sehat: "Baik",
  perhatian: "Perhatian",
  kritis: "Kritis",
};

function Skeleton() {
  return (
    <div className="an-skel" aria-hidden="true">
      <div className="an-skel-hero">
        <div className="sk sk--line" style={{ width: "40%" }} />
        <div className="sk" style={{ width: 90, height: 48, marginTop: 12 }} />
        <div className="sk sk--line" style={{ width: "60%", marginTop: 12 }} />
      </div>
      <div className="an-skel-grid">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="an-skel-card">
            <div className="sk sk--line" style={{ width: "50%" }} />
            <div className="sk" style={{ width: "80%", height: 22, marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div className="an-skel-card" style={{ height: 160 }} />
    </div>
  );
}

export function Analisa() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [fresh, setFresh] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setFresh(force);
    setErr("");
    try {
      const res = await fetch(`/api/analisa${force ? "?fresh=1" : ""}`);
      const j = (await res.json()) as Payload & { error?: string };
      if (!res.ok) {
        setErr(
          j.error === "belum_connect"
            ? "Accurate belum terhubung. Hubungkan akun Accurate dulu di Dashboard."
            : j.error ?? "Gagal memuat analisis."
        );
        return;
      }
      setData(j);
    } catch {
      setErr("Gagal memuat analisis bisnis.");
    } finally {
      setLoading(false);
      setFresh(false);
    }
  }, []);

  useEffect(() => {
    void getMe().then(setMe);
    void load(false);
  }, [load]);

  if (me === undefined) return null;
  if (me === null) {
    window.location.href = "/login";
    return null;
  }

  const ring = data ? Math.max(0, Math.min(100, data.score)) : 0;
  const R = 42;
  const C = 2 * Math.PI * R;

  return (
    <div className="app">
      <AppHeader me={me} />
      <main className="page page--narrow an">
        <header className="an-head">
          <div>
            <h1>Analisis Bisnis</h1>
            <p className="page__sub">Berbasis data Accurate — analisis &amp; saran untuk bisnis Anda</p>
          </div>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => void load(true)}
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? <span className="spinner" aria-hidden="true" /> : <IconRefresh size={15} />}
            {fresh ? "Menganalisis…" : "Analisis ulang"}
          </button>
        </header>

        {err && (
          <p className="banner banner--err" role="alert">
            {err}
          </p>
        )}

        {loading && !data && <Skeleton />}

        {data && (
          <div className={loading ? "an-body is-loading" : "an-body"}>
            {/* ── Skor & profil ── */}
            <section className={`an-hero is-${data.verdict}`}>
              <div className="an-hero__left">
                <span className="an-hero__badge">
                  <IconActivity size={14} /> {VERDICT_LABEL[data.verdict] ?? data.verdict}
                </span>
                <p className="an-hero__sub">{VERDICT_SUB[data.verdict]}</p>
                <div className="an-hero__chips">
                  <span className="an-chip">{data.profile.playbook}</span>
                  <span className="an-chip">Skala {data.profile.scale}</span>
                  <span className="an-chip">{data.period.label}</span>
                </div>
              </div>
              <div className="an-hero__ring" aria-label={`Skor kesehatan ${data.score} dari 100`}>
                <svg viewBox="0 0 100 100" width="104" height="104">
                  <circle cx="50" cy="50" r={R} className="an-ring__bg" />
                  <circle
                    cx="50"
                    cy="50"
                    r={R}
                    className="an-ring__fg"
                    strokeDasharray={C}
                    strokeDashoffset={C - (ring / 100) * C}
                  />
                </svg>
                <span className="an-ring__value">{data.score}</span>
              </div>
            </section>

            {/* ── Metrik ── */}
            <section className="an-metrics">
              {data.metrics.map((m, i) => (
                <div className="an-metric" key={m.key} style={{ ["--i" as string]: i }}>
                  <span className="an-metric__label">{m.label}</span>
                  <strong className={m.raw < 0 ? "is-neg" : ""}>{m.value}</strong>
                  <span className="an-metric__hint">{m.hint}</span>
                </div>
              ))}
            </section>

            {/* ── Narasi analis ── */}
            {data.narrative && (
              <section className="an-narrative">
                <div className="an-narrative__head">
                  <span className="an-narrative__icon">
                    <IconWallet size={16} />
                  </span>
                  <div>
                    <strong>Analisis &amp; Saran</strong>
                    <span>Disusun khusus untuk bidang usaha Anda</span>
                  </div>
                </div>
                <div className="an-narrative__text">
                  {data.narrative
                    .split("\n")
                    .map((line) => line.replace(/\*\*/g, "").trim())
                    .filter(Boolean)
                    .map((line, i) => (
                      <p key={i} className={/^\d+[.)]/.test(line) || line.startsWith("-") ? "is-point" : ""}>
                        {line.replace(/^-\s*/, "")}
                      </p>
                    ))}
                </div>
              </section>
            )}

            {/* ── Prioritas ── */}
            <section className="an-priorities">
              <div className="an-section-head">
                <h2>Prioritas Tindakan</h2>
              </div>
              <ol className="an-prio-list">
                {data.priorities.map((p, i) => (
                  <li key={i}>
                    <span className="an-prio-num">{i + 1}</span>
                    <span className="an-prio-text">{p}</span>
                  </li>
                ))}
              </ol>
            </section>

            {/* ── Temuan ── */}
            <section className="an-findings">
              <div className="an-section-head">
                <h2>Temuan Detail</h2>
                <span>{data.findings.length} temuan</span>
              </div>
              {data.findings.map((f, i) => (
                <article key={i} className={`an-finding is-${f.severity}`}>
                  <div className="an-finding__top">
                    <span className="an-sev">{SEVERITY_LABEL[f.severity] ?? f.severity}</span>
                    <strong>{f.title}</strong>
                  </div>
                  <p className="an-finding__detail">{f.detail}</p>
                  <p className="an-finding__advice">
                    <IconSearch size={13} /> {f.advice}
                  </p>
                </article>
              ))}
            </section>

            <p className="an-source">
              Sumber: <strong>Accurate</strong> · diperbarui {new Date(data.generatedAt).toLocaleString("id-ID")}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
