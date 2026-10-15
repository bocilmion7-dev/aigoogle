import { useEffect } from "react";
import "./landing.css";
import { ACCURATE_OAUTH_CTA } from "../oauth";

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

const CAPS = [
  {
    title: "Chat AI dengan data Accurate",
    body: "Tanya apa saja — piutang, faktur penjualan, stok, saldo kas. Jawaban datang seketika, lengkap dengan rincian yang menyusunnya.",
  },
  {
    title: "Membaca PDF & gambar",
    body: "Bukan cuma PDF. Foto nota, screenshot nota, bukti transfer, faktur, kuitansi — dibaca langsung oleh AI-nya, lalu dikenali dan dikelompokkan ke kategori yang benar.",
  },
  {
    title: "Merapikan Google Drive",
    body: "Folder berantakan jadi rapi otomatis: nama file diseragamkan, dokumen masuk kategori sendiri. Salah beres? Urungkan sekaligus dengan satu klik.",
  },
  {
    title: "WhatsApp otomatis",
    body: "Pengingat jatuh tempo terkirim ke pelanggan dan laporan harian mendarat di HP pemilik — otomatis, 200 rupiah per kirim.",
  },
  {
    title: "Bicara, bukan mengetik",
    body: "Tanya dengan suara, jawaban dibacakan — gratis tanpa langganan tambahan.",
  },
  {
    title: "Riwayat percakapan",
    body: "Semua sesi tersimpan dan bisa dilanjut kapan pun — hari ini menanyakan hal yang sama seperti minggu lalu? Tinggal buka lagi.",
  },
  {
    title: "Tim, peran & jejak audit",
    body: "Undang staf, atur siapa boleh melihat apa, dan setiap aksi tercatat. Satu akun untuk satu orang, bukan berbagi password.",
  },
  {
    title: "Dua cara masuk",
    body: "Lewat Accurate sekali klik, atau email & password — pilih yang paling nyaman, keduanya ke dashboard yang sama.",
  },
];

const TESTIMONI = [
  {
    quote:
      "Pengingat faktur jatuh tempo ke pelanggan sekarang jalan sendiri tiap pagi. Saya cuma cek WhatsApp — piutang bulan lalu turun hampir sepertiga.",
    name: "Siti Rahmawati",
    role: "Pemilik Toko Roti Sari Rasa · Bandung",
    photo: "/testimoni/siti.jpg",
  },
  {
    quote:
      "Di lapangan saya tanya “berapa kas hari ini”, angkanya langsung muncul di HP. Tidak perlu minta admin kirim laporan, menunggu, lalu salah baca.",
    name: "Budi Hartono",
    role: "Kontraktor · Surabaya",
    photo: "/testimoni/budi.jpg",
  },
  {
    quote:
      "Saya pakai untuk klien-klien kecil. Yang dulu makan dua jam merapikan nota tiap minggu, sekarang selesai sambil saya minum kopi.",
    name: "Dewi Anggraini",
    role: "Akuntan Publik · Jakarta",
    photo: "/testimoni/dewi.jpg",
  },
  {
    quote:
      "PDF dari supplier berantakan di Drive, sekarang masuk folder sendiri dengan nama rapi. Pernah salah beres? Klik urungkan, semuanya kembali.",
    name: "Agus Prasetyo",
    role: "Distributor Sembako · Semarang",
    photo: "/testimoni/agus.jpg",
  },
  {
    quote:
      "Fitur suaranya juara. Saya tanya sambil mengemas pesanan, jawabannya dibacakan. Praktis sekali untuk yang sibuk seperti saya.",
    name: "Rina Kartika",
    role: "Fashion Online · Yogyakarta",
    photo: "/testimoni/rina.jpg",
  },
  {
    quote:
      "Laporan harian mendarat tiap malam di HP saya. Istri bilang, akhirnya bisa makan malam tanpa diinterrupt hitung-hitungan.",
    name: "Hendra Wijaya",
    role: "Bengkel & Sparepart · Medan",
    photo: "/testimoni/hendra.jpg",
  },
];

/** Reveal saat elemen masuk viewport — seluruh halaman terasa hidup, bukan hanya hero. */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".ld-reveal");
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            en.target.classList.add("is-in");
            io.unobserve(en.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

export function Landing() {
  useReveal();
  return (
    <div className="landing">
      <header className="ld-header">
        <a className="ld-brand" href="/">
          <span className="ld-brand-mark" aria-hidden="true">
            AI
          </span>
          AI Asisten
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
            <a className="ld-btn ld-btn-primary" href={ACCURATE_OAUTH_CTA}>
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
        <h2 id="hari-heading" className="ld-reveal">Sehari bersama AI Asisten</h2>
        <ul>
          {STORY.map((s, i) => (
            <li key={s.time} className="ld-reveal" style={{ transitionDelay: `${i * 80}ms` }}>
              <span className="ld-idx">{s.time}</span>
              <span className="ld-feat-title">{s.line}</span>
              <p className="ld-feat-desc">{s.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="ld-caps" aria-labelledby="fitur-heading">
        <h2 id="fitur-heading" className="ld-reveal">Daftar lengkap kemampuannya</h2>
        <div className="ld-caps-grid">
          {CAPS.map((c, i) => (
            <div className="ld-cap ld-reveal" key={c.title} style={{ transitionDelay: `${(i % 2) * 70}ms` }}>
              <span className="ld-idx">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="ld-testi" aria-labelledby="testi-heading">
        <h2 id="testi-heading" className="ld-reveal">Mereka yang sudah mencoba</h2>
        <div className="ld-testi-grid">
          {TESTIMONI.map((t, i) => (
            <figure
              className="ld-tcard ld-reveal"
              key={t.name}
              style={{ transitionDelay: `${(i % 2) * 90 + Math.floor(i / 2) * 40}ms` }}
            >
              <blockquote className="ld-tcard-quote">“{t.quote}”</blockquote>
              <figcaption className="ld-tcard-by">
                <img
                  className="ld-tcard-photo"
                  src={t.photo}
                  alt={`Foto ${t.name}`}
                  width="52"
                  height="52"
                  loading="lazy"
                />
                <span className="ld-tcard-who">
                  <strong className="ld-tcard-name">{t.name}</strong>
                  <span className="ld-tcard-role">{t.role}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <footer className="ld-footer">
        <span>AI Asisten · AI Accurate Assistant, Voice Assistant &amp; Drive Organizer</span>
        <span>
          <a className="ld-link" href={ACCURATE_OAUTH_CTA}>
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
