import "./landing.css";

const STORY = [
  {
    time: "06:45",
    line: "“Selamat pagi. Tiga faktur jatuh tempo hari ini.”",
    body: "Sebelum Anda selesai minum kopi, pengingat untuk pelanggan sudah terkirim ke WhatsApp masing-masing — sopan, tepat waktu, tanpa Anda mengetik satu pun pesan.",
  },
  {
    time: "09:30",
    line: "“Berapa piutang CV Sentosa?”",
    body: "Tidak perlu buka laporan, tidak perlu sorot kolom. Tanya seperti bertanya ke rekan di sebelah — angkanya muncul seketika, beserta faktur yang menyusunnya.",
  },
  {
    time: "13:10",
    line: "Folder penuh PDF tak bernama? Bukan urusan Anda lagi.",
    body: "Sambil makan siang, semuanya sudah terurus: masuk kategori sendiri, nama rapi, siap dicari. Salah beres? Satu klik — semuanya kembali seperti semula.",
  },
  {
    time: "20:00",
    line: "“Penjualan hari ini Rp 8.750.000.”",
    body: "Laporan harian mendarat di WhatsApp Anda — bukan di meja menumpuk. Anda cukup membaca dan memutuskan. Penyusunannya sudah lama selesai.",
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
          <p className="ld-eyebrow ld-rise ld-rise-1">Untuk pemilik usaha & akuntan</p>
          <h1 className="ld-h1 ld-rise ld-rise-1">
            Pekerjaan rutin Anda di Accurate selesai <em>sebelum hari dimulai</em>.
          </h1>
          <p className="ld-lede ld-rise ld-rise-2">
            Setiap hari hal yang sama berulang: menagih, mencari file, menjumlah, menyusun
            laporan. Biar bagian itu yang dikerjakan — Anda tinggal membaca hasilnya dan
            memutuskan, bersama Accurate yang sudah Anda pakai selama ini.
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

      <section className="ld-features" aria-labelledby="hari-heading">
        <h2 id="hari-heading">Sehari bersama AI Google</h2>
        <ul>
          {STORY.map((s) => (
            <li key={s.time} className="ld-rise">
              <span className="ld-idx">{s.time}</span>
              <span className="ld-feat-title">{s.line}</span>
              <p className="ld-feat-desc">{s.body}</p>
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
