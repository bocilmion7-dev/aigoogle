import { useEffect } from "react";
import "./landing.css";
import { ACCURATE_OAUTH_CTA } from "../oauth";
import { IconBook, IconStar } from "../icons";

/** Halaman depan: ringkas, tenang, dan berorientasi hasil. */
const PILLARS = [
  {
    k: "Tanya",
    title: "Jawaban dari data Accurate Anda",
    body: "Piutang, penjualan, stok, kas, hingga laba-rugi — cukup bertanya. Jawaban disertai rincian yang menyusunnya, bukan angka tanpa asal."
  },
  {
    k: "Analisis",
    title: "Analisis & saran sesuai bidang usaha",
    body: "Setiap usaha berbeda. Sistem mengenali industri Anda dari katalog dan transaksi, lalu memberi temuan dan langkah perbaikan yang masuk akal untuk skala bisnis Anda."
  },
  {
    k: "Otomatis",
    title: "Pekerjaan rutin berjalan sendiri",
    body: "Pengingat jatuh tempo ke pelanggan, laporan harian ke WhatsApp pemilik, dan dokumen yang tertata — tanpa Anda mengetik satu pesan."
  },
];

const CAPS = [
  { t: "Chat AI atas data Accurate", d: "Tanya piutang, faktur penjualan, stok, saldo kas, atau laba-rugi. Jawaban langsung dengan rincian pendukungnya." },
  { t: "Analisis bisnis per bidang usaha", d: "Skor kesehatan bisnis, temuan, dan saran konkret — disesuaikan dengan industri dan skala usaha Anda." },
  { t: "Insight pasar & pesaing", d: "Ringkasan berita industri dan perbandingan harga produk Anda dengan marketplace, dari sumber resmi." },
  { t: "Membaca PDF, foto & nota", d: "Dokumen, screenshot, bukti transfer dibaca AI lalu dikenali dan dikelompokkan ke kategori yang benar." },
  { t: "Merapikan Google Drive", d: "Nama file diseragamkan dan dokumen masuk kategori sendiri. Salah beres? Urungkan sekaligus dengan satu klik." },
  { t: "Pesanan lewat WhatsApp", d: "AI penjaga toko menjawab pembeli, membuat pesanan, dan mencatatnya ke Accurate secara otomatis." },
  { t: "Kirim & lacak paket", d: "Cek ongkir, buat order kurir, dan pantau resi — terhubung ke layanan pengiriman." },
  { t: "Laporan otomatis ke WhatsApp", d: "Ringkasan penjualan harian dan pengingat jatuh tempo terkirim sendiri, tepat waktu." },
  { t: "Wallet & penarikan hasil penjualan", d: "Saldo hasil penjualan terpisah dari saldo token AI, bisa ditarik ke rekening yang tervalidasi." },
  { t: "Bicara, bukan mengetik", d: "Tanya dengan suara dan jawaban dibacakan — tanpa biaya langganan tambahan." },
  { t: "Tim, peran & jejak audit", d: "Undang staf, atur siapa boleh melihat apa, dan setiap aksi tercatat rapi." },
  { t: "Dua cara masuk", d: "Lewat Accurate sekali klik, atau email & password — keduanya menuju dashboard yang sama." }
];

const FLOW = [
  { n: "01", t: "Hubungkan Accurate", d: "Satu klik. Data perusahaan langsung terbaca tanpa migrasi." },
  { n: "02", t: "Kenali bisnis Anda", d: "Sistem mendeteksi bidang usaha dari katalog dan transaksi." },
  { n: "03", t: "Terima analisis", d: "Kondisi keuangan, prioritas tindakan, dan saran yang bisa dijalankan." },
  { n: "04", t: "Bertindak & pantau", d: "Jalankan saran, lalu lihat hasilnya pada periode berikutnya." }
];

const TESTIMONI = [
  {
    quote:
      "Pengingat faktur jatuh tempo ke pelanggan sekarang jalan sendiri tiap pagi. Saya tinggal cek WhatsApp — piutang bulan lalu turun hampir sepertiga.",
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
      "Dulu dua jam tiap minggu merapikan nota klien. Sekarang selesai sambil saya minum kopi, dan dokumennya rapi sendiri di Drive.",
    name: "Dewi Anggraini",
    role: "Konsultan Akuntansi · Yogyakarta",
    photo: "/testimoni/dewi.jpg",
  },
  {
    quote:
      "Yang paling membantu justru analisisnya: sistem menunjukkan margin saya turun dan menyarankan langkah konkret. Bukan cuma angka, tapi arahan.",
    name: "Agus Prasetyo",
    role: "Toko Bangunan · Semarang",
    photo: "/testimoni/agus.jpg",
  },
  {
    quote:
      "Pesanan dari WhatsApp langsung tercatat ke Accurate tanpa saya input ulang. Kesalahan catat hampir hilang sama sekali.",
    name: "Rina Kusuma",
    role: "Pemilik Butik · Jakarta",
    photo: "/testimoni/rina.jpg",
  },
  {
    quote:
      "Saya pakai untuk beberapa usaha kecil. Laporan harian masuk ke WhatsApp tiap malam — saya bisa putuskan besok pagi tanpa buka laptop.",
    name: "Hendra Wijaya",
    role: "Pengusaha Retail · Medan",
    photo: "/testimoni/hendra.jpg",
  },
];

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".ld-reveal");
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

export function Landing() {
  useReveal();
  return (
    <div className="landing ld2">
      <header className="ld2-nav">
        <a className="ld2-brand" href="/" aria-label="AI Asisten — beranda">
          <img src="/logo.webp" alt="AI Asisten" className="ld2-logo" width="114" height="38" fetchPriority="high" />
        </a>
        <nav className="ld2-links" aria-label="Navigasi utama">
          <a href="#cara-kerja">Cara kerja</a>
          <a href="#kemampuan">Kemampuan</a>
          <a href="#testimoni">Testimoni</a>
          <a className="ld2-doc-link" href="/dokumentasi" title="Dokumentasi" aria-label="Dokumentasi">
            <IconBook size={22} />
          </a>
          <a className="ld2-login" href="/login">Masuk</a>
        </nav>
      </header>

      <main>
        {/* ── Hero ── */}
        <section className="ld2-hero">
          <div className="ld2-hero__copy">
            {/* Hero TIDAK memakai .ld-reveal: elemen di atas layar harus langsung
                terlihat. Dulu opacity:0 menunggu IntersectionObserver → LCP
                tertahan ~3 dtk (render delay 3.109 ms di Lighthouse). */}
            <span className="ld2-eyebrow">Untuk pemilik usaha &amp; akuntan</span>
            <h1>
              Pekerjaan rutin di Accurate selesai <em>sebelum hari Anda dimulai</em>.
            </h1>
            <p className="ld2-lede">
              Menagih, mencari berkas, menyusun laporan — biar bagian itu yang dikerjakan.
              Anda cukup membaca hasilnya dan memutuskan.
            </p>
            <div className="ld2-cta">
              <a className="ld2-btn ld2-btn--primary" href={ACCURATE_OAUTH_CTA}>
                Hubungkan Accurate
              </a>
              <a className="ld2-btn ld2-btn--ghost" href="/login">
                Masuk dengan password
              </a>
            </div>
            <p className="ld2-note">
              Pertama kali dari Accurate? Anda diminta membuat password — kurang dari satu menit.
            </p>
          </div>

          <div className="ld2-hero__panel" aria-hidden="true">
            <div className="ld2-panel__bar">
              <span className="ld2-dot" />
              <span className="ld2-dot" />
              <span className="ld2-dot" />
              <span className="ld2-panel__title">Analisis Bisnis · Oktober 2026</span>
            </div>
            <div className="ld2-panel__body">
              <div className="ld2-score">
                <span className="ld2-score__num">78</span>
                <span className="ld2-score__cap">Skor kesehatan</span>
              </div>
              <ul className="ld2-kpis">
                <li>
                  <span>Penjualan</span>
                  <strong>Rp 48.250.000</strong>
                </li>
                <li>
                  <span>Margin kotor</span>
                  <strong>34%</strong>
                </li>
                <li>
                  <span>Piutang</span>
                  <strong>Rp 6.100.000</strong>
                </li>
              </ul>
              <div className="ld2-advice">
                <span className="ld2-advice__tag">Saran</span>
                <p>Tagih 3 faktur jatuh tempo pekan ini untuk memperbaiki arus kas.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Tiga pilar ── */}
        <section className="ld2-pillars" id="kemampuan">
          <div className="ld2-section-head ld-reveal">
            <span className="ld2-kicker">Kemampuan inti</span>
            <h2>Tiga hal yang paling melegakan</h2>
          </div>
          <div className="ld2-pillar-grid">
            {PILLARS.map((p, i) => (
              <article className="ld2-pillar ld-reveal" key={p.k} style={{ transitionDelay: `${i * 70}ms` }}>
                <span className="ld2-pillar__k">{p.k}</span>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Fitur lengkap ── */}
        <section className="ld2-caps" aria-labelledby="fitur-heading">
          <div className="ld2-section-head ld-reveal">
            <span className="ld2-kicker">Fitur</span>
            <h2 id="fitur-heading">Semua yang bisa dikerjakan</h2>
          </div>
          <div className="ld2-caps-grid">
            {CAPS.map((c, i) => (
              <article className="ld2-cap ld-reveal" key={c.t} style={{ transitionDelay: `${(i % 3) * 60}ms` }}>
                <span className="ld2-cap__n">{String(i + 1).padStart(2, "0")}</span>
                <h3>{c.t}</h3>
                <p>{c.d}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Contoh: tanya utang pelanggan ── */}
        <section className="ld2-demo" id="contoh">
          <div className="ld2-demo__copy ld-reveal">
            <span className="ld2-kicker">Contoh nyata</span>
            <h2>“Berapa utang pelanggan saya?”</h2>
            <p>
              Cukup bertanya seperti ke rekan kerja. AI Asisten membaca data Accurate Anda,
              lalu menyebutkan total piutang beserta pelanggan dan faktur yang menyusunnya —
              bukan angka tanpa dasar.
            </p>
            <ul className="ld2-demo__list">
              <li>Tidak perlu buka laporan atau menyorot kolom</li>
              <li>Jawaban lengkap dengan rincian faktur</li>
              <li>Bisa dilanjutkan: “tagih yang jatuh tempo minggu ini”</li>
            </ul>
            <div className="ld2-cta">
              <a className="ld2-btn ld2-btn--primary" href={ACCURATE_OAUTH_CTA}>
                Coba dengan data Anda
              </a>
            </div>
          </div>
          <figure className="ld2-demo__shot ld-reveal">
            <div className="ld2-demo__phone">
              <img
                src="/contoh/chat-utang.jpg"
                alt="Contoh percakapan AI Asisten: bertanya utang pelanggan dan menerima rincian piutang"
                width="720"
                height="1612"
                loading="lazy"
              />
            </div>
            <figcaption>Contoh pertanyaan: utang pelanggan</figcaption>
          </figure>
        </section>

        {/* ── Cara kerja ── */}
        <section className="ld2-flow" id="cara-kerja">
          <div className="ld2-section-head ld-reveal">
            <span className="ld2-kicker">Cara kerja</span>
            <h2>Empat langkah, tanpa ribet</h2>
          </div>
          <ol className="ld2-flow__list">
            {FLOW.map((f, i) => (
              <li className="ld2-step ld-reveal" key={f.n} style={{ transitionDelay: `${i * 60}ms` }}>
                <span className="ld2-step__n">{f.n}</span>
                <div>
                  <strong>{f.t}</strong>
                  <p>{f.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Testimoni ── */}
        <section className="ld2-testi" id="testimoni">
          <div className="ld2-section-head ld-reveal">
            <span className="ld2-kicker">Testimoni</span>
            <h2>Mereka yang sudah merasakan bedanya</h2>
          </div>
          <div className="ld2-testi-grid">
            {TESTIMONI.map((t, i) => (
              <figure className="ld2-tcard ld-reveal" key={t.name} style={{ transitionDelay: `${(i % 3) * 70}ms` }}>
                <div className="ld2-tcard__stars" role="img" aria-label="Penilaian 5 dari 5 bintang">
                  {[0, 1, 2, 3, 4].map((n) => (
                    <IconStar key={n} size={14} />
                  ))}
                </div>
                <blockquote className="ld2-tcard__quote">“{t.quote}”</blockquote>
                <figcaption className="ld2-tcard__by">
                  <img className="ld2-tcard__photo" src={t.photo} alt={`Foto ${t.name}`} width="44" height="44" loading="lazy" />
                  <span className="ld2-tcard__who">
                    <strong>{t.name}</strong>
                    <span>{t.role}</span>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* ── Suasana kerja ── */}
        <section className="ld2-office" aria-labelledby="office-heading">
          <div className="ld2-section-head ld-reveal">
            <span className="ld2-kicker">Dipakai sehari-hari</span>
            <h2 id="office-heading">Dibuka pagi, dipakai sepanjang hari kerja</h2>
            <p className="ld2-office__lede">
              Dari meja pemilik, ruang rapat, sampai tim di lapangan — semuanya membaca angka yang sama.
            </p>
          </div>
          <div className="ld2-office__grid">
            {[
              { src: "/office/kantor-1.webp", cap: "Memeriksa kondisi usaha sebelum rapat pagi" },
              { src: "/office/kantor-2.webp", cap: "Tim berbagi satu sumber data yang sama" },
              { src: "/office/kantor-3.webp", cap: "Keputusan diambil dari angka, bukan perkiraan" },
              { src: "/office/kantor-4.webp", cap: "Analisis menyusul ke meja kerja, tanpa ditanya" },
            ].map((o, i) => (
              <figure className="ld2-office__item ld-reveal" key={o.src} style={{ transitionDelay: `${i * 70}ms` }}>
                <img src={o.src} alt={o.cap} loading="lazy" width="1280" height="720" />
                <figcaption>{o.cap}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* ── Ajakan akhir ── */}
        <section className="ld2-final ld-reveal">
          <img src="/logo.webp" alt="AI Asisten" className="ld2-final__logo" width="104" height="40" loading="lazy" />
          <h2>Mulai dari data yang sudah Anda percaya</h2>
          <p>Tanpa migrasi, tanpa input ulang. Accurate tetap sumber kebenaran — AI Asisten yang mengolahnya untuk Anda.</p>
          <div className="ld2-cta">
            <a className="ld2-btn ld2-btn--primary" href={ACCURATE_OAUTH_CTA}>
              Hubungkan Accurate
            </a>
            <a className="ld2-btn ld2-btn--ghost" href="/login">
              Saya sudah punya akun
            </a>
          </div>
        </section>
      </main>

      {/* ── Info perusahaan + footer ── */}
      <footer className="ld2-footer">
        <div className="ld2-footer__inner">
          <div className="ld2-footer__brand">
            <img src="/logo.webp" alt="AI Asisten" className="ld2-logo ld2-logo--sm" width="96" height="32" loading="lazy" />
            <p className="ld2-footer__desc">
              Asisten AI untuk pemilik usaha dan akuntan di Indonesia. Bekerja di atas data Accurate,
              Google Drive, dan WhatsApp — agar pekerjaan rutin selesai tanpa menambah beban.
            </p>
            <address className="ld2-footer__addr">
              <strong>PT Asisten Cerdas Indonesia</strong>
              <span>Jakarta, Indonesia</span>
              <a href="mailto:halo@ai-asisten.my.id">halo@ai-asisten.my.id</a>
            </address>
          </div>

          <div className="ld2-footer__cols">
            <div>
              <h3>Produk</h3>
              <ul>
                <li><a href="#kemampuan">Kemampuan</a></li>
                <li><a href="#cara-kerja">Cara kerja</a></li>
                <li><a href="#testimoni">Testimoni</a></li>
                <li><a href="/login">Masuk</a></li>
              </ul>
            </div>
            <div>
              <h3>Sumber</h3>
              <ul>
                <li><a href="/login">Panduan penggunaan</a></li>
                <li><a href="/login">Pusat bantuan</a></li>
                <li><a href={ACCURATE_OAUTH_CTA}>Hubungkan Accurate</a></li>
              </ul>
            </div>
            <div>
              <h3>Perusahaan</h3>
              <ul>
                <li><a href="#tentang">Tentang kami</a></li>
                <li><a href="mailto:halo@ai-asisten.my.id">Kontak</a></li>
                <li><a href="/login">Kebijakan privasi</a></li>
                <li><a href="/login">Syarat layanan</a></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="ld2-footer__bar">
          <span>© {new Date().getFullYear()} PT Asisten Cerdas Indonesia. Seluruh hak cipta dilindungi.</span>
          <span className="ld2-footer__links">
            <a href="/login">Privasi</a>
            <a href="/login">Syarat</a>
            <a href="mailto:halo@ai-asisten.my.id">Kontak</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
