import "./landing.css";

const FEATURES = [
  {
    title: "Chat AI akuntansi",
    desc: "Tanya data Accurate dengan bahasa alami — faktur, pelanggan, laporan. Jawaban streaming dengan jejak tool.",
  },
  {
    title: "Explore Manager",
    desc: "Rapikan folder Google Drive otomatis: klasifikasi PDF, folder kategori, urungkan massal bila salah.",
  },
  {
    title: "WhatsApp otomatis",
    desc: "Pengingat jatuh tempo ke pelanggan & laporan harian ke pemilik — saldo topup 200 rupiah per kirim.",
  },
  {
    title: "Suara Edge & Gemini",
    desc: "Bicara dengan asisten: STT browser, TTS neural Edge gratis — tanpa mengirim audio ke Gemini.",
  },
];

export function Landing() {
  return (
    <div className="landing">
      <header className="ld-header">
        <a className="ld-brand" href="/">
          <span className="ld-brand-mark" aria-hidden="true">
            AI
          </span>
          AI Google
        </a>
        <a className="ld-nav-login" href="/login">
          Masuk
        </a>
      </header>

      <section className="ld-hero">
        <div>
          <p className="ld-eyebrow ld-rise ld-rise-1">Add-on untuk Accurate Online</p>
          <h1 className="ld-h1 ld-rise ld-rise-1">
            Akuntansi Anda, <em>dibantu AI</em> — tanpa meninggalkan Accurate.
          </h1>
          <p className="ld-lede ld-rise ld-rise-2">
            Chat, rapikan Drive, kirim WhatsApp jatuh tempo — satu dashboard. Masuk lewat Accurate
            sekali, setelah itu cukup email & password.
          </p>
          <div className="ld-actions ld-rise ld-rise-3">
            <a className="ld-btn ld-btn-primary" href="/api/launch">
              Masuk lewat Accurate →
            </a>
            <a className="ld-btn ld-btn-secondary" href="/login">
              Masuk dengan password
            </a>
          </div>
          <p className="ld-note ld-rise ld-rise-3">
            Pertama kali dari Accurate, Anda diminta membuat password satu menit.
          </p>
        </div>

        <div className="ld-card ld-rise ld-rise-4" aria-hidden="true">
          <div className="ld-card-bar">
            <strong>Buku besar · Oktober 2026</strong>
            <span className="ld-badge">AI</span>
          </div>
          <div className="ld-card-body">
            <p className="ld-q">“Berapa total penjualan bulan ini?”</p>
            <p className="ld-a">Rp 8.750.000</p>
            <ul className="ld-rows">
              <li>
                <span>FJ/2026/0001 · Budi Santoso</span>
                <span>2.500.000</span>
              </li>
              <li>
                <span>FJ/2026/0002 · Siti Aminah</span>
                <span>3.750.000</span>
              </li>
              <li>
                <span>FJ/2026/0003 · CV Sentosa</span>
                <span>2.500.000</span>
              </li>
              <li className="is-total">
                <span>Total</span>
                <span>8.750.000</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="ld-features" aria-labelledby="fitur-heading">
        <h2 id="fitur-heading">Yang bisa dilakukan</h2>
        <ul>
          {FEATURES.map((f, i) => (
            <li key={f.title} className="ld-rise">
              <span className="ld-idx">{String(i + 1).padStart(2, "0")}</span>
              <span className="ld-feat-title">{f.title}</span>
              <p className="ld-feat-desc">{f.desc}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="ld-footer">
        <span>AI Google · Add-on AI untuk Accurate Online</span>
        <span>
          <a className="ld-link" href="/api/launch">
            Masuk lewat Accurate
          </a>
          <a className="ld-link" href="/login">
            Masuk dengan password
          </a>
        </span>
      </footer>
    </div>
  );
}
