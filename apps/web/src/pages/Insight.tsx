import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  askInsight,
  getInsight,
  getMe,
  type InsightMarketplace,
  type InsightPayload,
  type InsightPrice,
  type InsightSource,
} from "../api";
import { AppHeader } from "../ui";
import { IconNews, IconSearch, IconSend } from "../icons";

const TOPIC_LABEL: Record<string, string> = {
  regulasi: "Regulasi",
  harga: "Harga",
  tren: "Tren",
  event: "Event",
  makro: "Ekonomi",
  industri: "Industri",
  umum: "Umum",
};

const TOPIC_CLASS: Record<string, string> = {
  regulasi: "is-regulasi",
  harga: "is-harga",
  tren: "is-tren",
  event: "is-event",
  makro: "is-neutral",
  industri: "is-neutral",
  umum: "is-neutral",
};

const TOPIC_ORDER = ["harga", "regulasi", "tren", "event", "makro", "industri", "umum"];

const fmtDate = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};
const rp = (n: number | null) =>
  n === null ? "—" : `Rp${Math.round(n).toLocaleString("id-ID")}`;
/** rentang harga min–max dalam satu baris (Rp1.050.000 – 4.450.000) */
const rpRange = (min: number, max: number) =>
  max > min ? `${rp(min)} – ${Math.round(max).toLocaleString("id-ID")}` : rp(min);
const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Jakarta",
      });
};

const todayLine = () =>
  new Date().toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });

const timeAgo = (iso: string | null) => {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} menit lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} hari lalu`;
  return fmtDate(iso);
};

const initials = (name: string) => {
  const words = name.split(/\s+/).filter(Boolean);
  if (!words.length) return "•";
  const a = words[0]![0] ?? "";
  const b = words.length > 1 ? words[words.length - 1]![0] : (words[0]![1] ?? "");
  return (a + b).toUpperCase();
};

const AVA_CLASSES = ["is-a0", "is-a1", "is-a2", "is-a3", "is-a4", "is-a5"];
const avaClass = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVA_CLASSES[h % AVA_CLASSES.length]!;
};

const vp = (i: number) => ({ "--i": i }) as CSSProperties;

function SkeletonFeed() {
  return (
    <div className="insight-skel" aria-hidden="true">
      <div className="insight-skel-feature">
        <div className="sk sk--chip" />
        <div className="sk sk--hero" />
        <div className="sk sk--title" />
        <div className="sk sk--line" />
      </div>
      <div className="insight-skel-grid">
        {[0, 1, 2, 3].map((i) => (
          <div className="insight-skel-card" key={i}>
            <div className="sk sk--chip" />
            <div className="sk sk--title" />
            <div className="sk sk--line" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Halaman Insight: briefing pasar harian bergaya portal berita + tanya AI. */
export function Insight() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [data, setData] = useState<InsightPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<InsightSource[]>([]);
  const [askErr, setAskErr] = useState("");
  const [filter, setFilter] = useState("semua");

  const rootRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getInsight());
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal memuat Insight.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void getMe().then(setMe);
    void load();
  }, [load]);

  // posisi sticky: masthead di bawah app header, rail di bawah masthead
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const header = document.querySelector(".app-header");
    const mast = root.querySelector(".insight-mast");
    const set = () => {
      const h = Math.round(header?.getBoundingClientRect().height ?? 56);
      const mh = Math.round(mast?.getBoundingClientRect().height ?? 0);
      root.style.setProperty("--mast-top", `${h + 6}px`);
      if (mh) root.style.setProperty("--rail-top", `${h + mh + 20}px`);
    };
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, [loading, data]);

  // animasi masuk halus saat elemen terlihat (sekali jalan)
  useEffect(() => {
    if (loading) return;
    const els = rootRef.current?.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!els || els.length === 0) return;
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const ob = new IntersectionObserver(
      (ents) => {
        for (const en of ents) {
          if (en.isIntersecting) {
            en.target.classList.add("is-in");
            ob.unobserve(en.target);
          }
        }
      },
      { rootMargin: "0px 0px -6% 0px" }
    );
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) el.classList.add("is-in");
      else ob.observe(el);
    });
    return () => ob.disconnect();
  }, [data, filter, answer, loading]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const question = q.trim();
    if (!question || asking) return;
    setAsking(true);
    setAskErr("");
    setAnswer("");
    setSources([]);
    try {
      const r = await askInsight(question);
      setAnswer(r.answer);
      setSources(r.sources);
    } catch (e) {
      setAskErr(e instanceof Error ? e.message : "Gagal mencari jawaban.");
    } finally {
      setAsking(false);
    }
  }

  if (me === undefined) {
    return (
      <div className="app">
        <AppHeader me={null} />
        <main className="page page--narrow insight insight--portal">
          <div className="insight-mast" aria-hidden="true">
            <div className="sk sk--eyebrow" />
            <div className="sk sk--hero" />
          </div>
        </main>
      </div>
    );
  }
  if (me === null) {
    window.location.href = "/login";
    return null;
  }

  const industries = data?.industries ?? [];
  const industryText = industries.map((i) => i.label).join(" & ") || "Usaha Anda";

  // ── data pasar (harga berita + marketplace) ──
  const mpByName = new Map((data?.marketplaces ?? []).map((m) => [m.productName.toLowerCase(), m]));
  const priceByName = new Map((data?.prices ?? []).map((p) => [p.productName.toLowerCase(), p]));
  const mpWithData = (data?.marketplaces ?? []).filter((m) => m.items.length > 0);
  const cards: Array<{ price: InsightPrice | null; mp: InsightMarketplace | null }> = (
    data?.prices ?? []
  ).map((p) => ({ price: p, mp: mpByName.get(p.productName.toLowerCase()) ?? null }));
  for (const m of data?.marketplaces ?? []) {
    if (!priceByName.has(m.productName.toLowerCase())) cards.push({ price: null, mp: m });
  }
  const visible = cards.filter((c) => c.price || (c.mp?.items.length ?? 0) > 0);
  const monitored = visible.filter(
    (c) => (c.mp?.items.length ?? 0) > 0 || (c.price?.marketMedian ?? null) !== null
  ).length;

  // ── berita: featured + feed terfilter ──
  const all = data?.items ?? [];
  const topics = TOPIC_ORDER.filter((t) => all.some((i) => i.topic === t));
  const featured = filter === "semua" ? (all.length > 1 ? all[0] ?? null : null) : null;
  const feed = filter === "semua" ? (all.length > 1 ? all.slice(1) : all) : all.filter((i) => i.topic === filter);

  return (
    <div className="app">
      <AppHeader me={me} />
      <main className="page page--narrow insight insight--portal" ref={rootRef}>
        <h1 className="insight-sr">Insight pasar</h1>

        <div className="insight-mast">
          <div className="insight-mast__row">
            <span className="insight-eyebrow">
              <IconNews size={13} /> Briefing pasar — {todayLine()}
            </span>
            {data && <span className="insight-updated">Diperbarui {fmtDateTime(data.generatedAt)}</span>}
          </div>
          <form className="insight-search" onSubmit={submit} role="search">
            <IconSearch size={17} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tanya apa saja tentang pasar Anda…"
              aria-label="Cari informasi pasar"
              maxLength={300}
              enterKeyHint="search"
            />
            <button type="submit" className="insight-search__btn" disabled={asking || !q.trim()} aria-label="Cari">
              {asking ? <span className="spinner" aria-hidden="true" /> : <IconSend size={15} />}
            </button>
          </form>
          <p className="insight-industry">
            Industri terdeteksi: <strong>{industryText}</strong>
            {industries.slice(0, 3).map((i) => (
              <span key={i.key}> · {Math.round(i.weight * 100)}%</span>
            ))}
          </p>
          {topics.length > 0 && (
            <nav className="insight-nav" aria-label="Filter topik berita">
              <button
                type="button"
                className={filter === "semua" ? "is-on" : ""}
                aria-pressed={filter === "semua"}
                onClick={() => setFilter("semua")}
              >
                Semua
              </button>
              {topics.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={filter === t ? "is-on" : ""}
                  aria-pressed={filter === t}
                  onClick={() => setFilter(t)}
                >
                  {TOPIC_LABEL[t] ?? t}
                </button>
              ))}
            </nav>
          )}
        </div>

        {askErr && (
          <p className="insight-alert" role="alert">
            {askErr}
          </p>
        )}

        {answer && (
          <section className="insight-answer" aria-live="polite" data-reveal style={vp(0)}>
            <p className="insight-answer__label">Jawaban</p>
            <div className="insight-answer__text">{answer}</div>
            {sources.length > 0 && (
              <div className="insight-answer__sources">
                <p className="insight-answer__label">Sumber</p>
                <ol>
                  {sources.map((s, i) => (
                    <li key={`${s.url}-${i}`}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        {s.title}
                      </a>
                      <span>
                        {s.sourceName}
                        {s.publishedAt ? ` · ${fmtDate(s.publishedAt)}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>
        )}

        {err && (
          <p className="insight-alert" role="alert">
            {err}
          </p>
        )}
        <div className="insight-cols">
          <div className="insight-main">
            {featured && (
              <article
                className={`insight-featured ${TOPIC_CLASS[featured.topic] ?? "is-neutral"}`}
                data-reveal
                style={vp(0)}
              >
                <div className="insight-featured__body">
                  <div className="insight-kicker">
                    <span className={`insight-topic ${TOPIC_CLASS[featured.topic] ?? "is-neutral"}`}>
                      {TOPIC_LABEL[featured.topic] ?? "Umum"}
                    </span>
                    <span className="insight-kicker__meta">
                      {featured.sourceName}
                      {featured.publishedAt ? ` · ${timeAgo(featured.publishedAt)}` : ""}
                    </span>
                  </div>
                  <h2 className="insight-featured__title">
                    <a href={featured.url} target="_blank" rel="noopener noreferrer">
                      {featured.title}
                    </a>
                  </h2>
                  {featured.snippet && <p className="insight-featured__snippet">{featured.snippet}</p>}
                  <p className="insight-featured__why">{featured.why}</p>
                  <span className="insight-read" aria-hidden="true">
                    Baca selengkapnya →
                  </span>
                </div>
                <div className="insight-featured__media" aria-hidden="true">
                  <span className={`insight-ava insight-ava--big ${avaClass(featured.sourceDomain)}`}>
                    {initials(featured.sourceName)}
                  </span>
                  <span className="insight-featured__domain">{featured.sourceDomain}</span>
                </div>
              </article>
            )}
            <div className="insight-feedwrap">
              <div className="insight-section-head">
                <h2>{filter === "semua" ? "Berita pasar" : (TOPIC_LABEL[filter] ?? filter)}</h2>
                {!loading && data && <span>{feed.length} berita</span>}
              </div>

              {loading ? (
                <SkeletonFeed />
              ) : feed.length > 0 ? (
                <ol className="insight-grid" role="list">
                  {feed.map((it, idx) => (
                    <li data-reveal style={vp(idx)} key={it.id}>
                      <article className={`insight-card ${TOPIC_CLASS[it.topic] ?? "is-neutral"}`}>
                        <div className="insight-card__top">
                          <span className={`insight-ava ${avaClass(it.sourceDomain)}`}>
                            {initials(it.sourceName)}
                          </span>
                          <span className={`insight-topic ${TOPIC_CLASS[it.topic] ?? "is-neutral"}`}>
                            {TOPIC_LABEL[it.topic] ?? "Umum"}
                          </span>
                          <span className="insight-time">{it.publishedAt ? timeAgo(it.publishedAt) : ""}</span>
                        </div>
                        <h3 className="insight-card__title">
                          <a href={it.url} target="_blank" rel="noopener noreferrer">
                            {it.title}
                          </a>
                        </h3>
                        {it.snippet && <p className="insight-card__snippet">{it.snippet}</p>}
                        <p className="insight-card__why">{it.why}</p>
                        {it.matched.length > 0 && (
                          <div className="insight-tags">
                            {it.matched.slice(0, 3).map((m) => (
                              <span key={m}>#{m}</span>
                            ))}
                          </div>
                        )}
                      </article>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="insight-empty">
                  <IconNews size={26} />
                  <strong>Belum ada berita relevan hari ini</strong>
                  <p>Briefing diperbarui sekali sehari. Silakan cek kembali besok.</p>
                </div>
              )}
            </div>
          </div>

          {data && visible.length > 0 && (
            <aside className="insight-rail" data-reveal style={vp(1)}>
              <section className="market" aria-label="Harga pasar dan pesaing">
                <div className="insight-section-head">
                  <h2>Pasar &amp; pesaing</h2>
                  <span>{monitored} terpantau</span>
                </div>
                <ul className="price-list" role="list">
                  {visible.map(({ price: p, mp }) => {
                    const name = p?.productName ?? mp!.productName;
                    const hasMp = !!mp && mp.items.length > 0;
                    const own = p?.ownPrice ?? mp?.ownPrice ?? null;
                    const delta = hasMp ? mp!.deltaPct : (p?.deltaPct ?? null);
                    const cheapest = hasMp ? mp!.cheapestPrice : null;
                    return (
                      <li className="price-card" key={name}>
                        <div className="price-card__head">
                          <strong>{name}</strong>
                          {delta !== null && (
                            <span
                              className={`price-delta ${delta > 0 ? "is-high" : "is-low"}`}
                              title={
                                hasMp
                                  ? "Harga Anda dibanding harga termurah di marketplace"
                                  : "Harga Anda dibanding harga pasar (median)"
                              }
                            >
                              {delta > 0 ? "+" : ""}
                              {delta}%
                            </span>
                          )}
                        </div>
                        <div className="price-card__grid">
                          <div className="price-cell">
                            <span>Harga Anda</span>
                            <strong>{rp(own)}</strong>
                          </div>
                          <div className="price-cell">
                            <span>
                              Harga pasar
                              {hasMp && mp!.cheapestMarketplace ? ` · ${mp!.cheapestMarketplace}` : ""}
                            </span>
                            <strong>
                              {cheapest !== null
                                ? rp(cheapest)
                                : !p || p.marketMedian === null
                                  ? "Belum terpantau"
                                  : p.marketMin === p.marketMax
                                    ? rp(p.marketMedian)
                                    : rpRange(p.marketMin ?? 0, p.marketMax ?? 0)}
                            </strong>
                          </div>
                        </div>
                        {hasMp && (
                          <ul className="mp-list" role="list">
                            {mp!.items.map((it) => (
                              <li key={`${it.marketplace}-${it.link}`}>
                                <span className="mp-name">{it.marketplace}</span>
                                <span className="mp-price">{rpRange(it.price, it.maxPrice)}</span>
                                <a href={it.link} target="_blank" rel="noopener noreferrer">
                                  Buka
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                        {p && (p.sources.length > 0 || p.sampleCount > 0) && (
                          <div className="price-card__foot">
                            {p.sources.slice(0, 2).map((s) => (
                              <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
                                {s.sourceName}
                                {s.publishedAt ? ` · ${fmtDate(s.publishedAt)}` : ""}
                              </a>
                            ))}
                            {p.sampleCount > 0 && <span>{p.sampleCount} sumber harga</span>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="meta" style={{ margin: "10px 2px 0" }}>
                  {data!.marketplaceReady
                    ? mpWithData.length > 0
                      ? "Harga tiap marketplace (Shopee/Tokopedia/Lazada dll.) ditampilkan sebagai rentang termurah–termahal, dibandingkan dengan harga jual Anda."
                      : "Harga marketplace belum terpantau untuk produk ini. Coba lagi besok."
                    : "Perbandingan harga antar marketplace belum aktif (butuh koneksi price API)."}
                </p>
              </section>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
