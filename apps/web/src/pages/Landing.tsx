import { useEffect } from "react";
import "./landing-new.css";
import { ACCURATE_OAUTH_CTA } from "../oauth";
import { IconBook, IconStar } from "../icons";

/** Halaman depan — edisi pagi: broadsheet keuangan, angka, dan aturan tipis. */

const PILLARS = [
  {
    k: "Tanya",
    title: "Jawaban dari data Accurate Anda",
    body: "Piutang, penjualan, stok, kas, hingga laba-rugi — cukup bertanya. Jawaban disertai rincian yang menyusunnya, bukan angka tanpa asal.",
  },
  {
    k: "Analisis",
    title: "Analisis & saran sesuai bidang usaha",
    body: "Setiap usaha berbeda. Sistem mengenali industri Anda dari katalog dan transaksi, lalu memberi temuan dan langkah perbaikan yang masuk akal untuk skala bisnis Anda.",
  },
  {
    k: "Otomatis",
    title: "Pekerjaan rutin berjalan sendiri",
    body: "Pengingat jatuh tempo ke pelanggan, laporan harian ke WhatsApp pemilik, dan dokumen yang tertata — tanpa Anda mengetik satu pesan.",
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
  { t: "Dua cara masuk", d: "Lewat Accurate sekali klik, atau email & password — keduanya menuju dashboard yang sama." },
];

const FLOW = [
  { n: "01", t: "Hubungkan Accurate", d: "Satu klik. Data perusahaan langsung terbaca tanpa migrasi." },
  { n: "02", t: "Kenali bisnis Anda", d: "Sistem mendeteksi bidang usaha dari katalog dan transaksi." },
  { n: "03", t: "Terima analisis", d: "Kondisi keuangan, prioritas tindakan, dan saran yang bisa dijalankan." },
  { n: "04", t: "Bertindak & pantau", d: "Jalankan saran, lalu lihat hasilnya pada periode berikutnya." },
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

const OFFICE = [
  { src: "/office/kantor-1.webp", cap: "Memeriksa kondisi usaha sebelum rapat pagi" },
  { src: "/office/kantor-2.webp", cap: "Tim berbagi satu sumber data yang sama" },
  { src: "/office/kantor-3.webp", cap: "Keputusan diambil dari angka, bukan perkiraan" },
  { src: "/office/kantor-4.webp", cap: "Analisis menyusul ke meja kerja, tanpa ditanya" },
];

const INDEX = ["Piutang", "Stok", "Kas", "Laba-rugi", "Faktur", "Pesanan", "Pajak", "Pelanggan", "Aset", "Biaya", "Jurnal", "Arus kas"];

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".lp-reveal");
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
  const edition = new Date().toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="lp">
      <a className="lp-skip" href="#konten">
        Lewati ke konten
      </a>

      {/* ── Kepala surat ── */}
      <header className="lp-masthead">
        <div className="lp-topbar">
          <div className="lp-topbar__inner">
            <span>Edisi digital</span>
            <span className="lp-topbar__mid">
              <span className="lp-topbar__dot" aria-hidden="true" /> Akuntansi · AI
            </span>
            <span>{edition}</span>
          </div>
        </div>
        <div className="lp-nav">
          <a className="lp-brand" href="/" aria-label="AI Asisten — beranda">
            <img src="/logo-ai-asisten.webp" alt="AI Asisten" width="114" height="38" fetchPriority="high" />
          </a>
          <nav className="lp-links" aria-label="Navigasi utama">
            <a href="#kemampuan">Kemampuan</a>
            <a href="#cara-kerja">Cara kerja</a>
            <a href="#contoh">Contoh</a>
            <a href="#testimoni">Testimoni</a>
          </nav>
          <div className="lp-actions">
            <a className="lp-doc" href="/dokumentasi" title="Dokumentasi" aria-label="Dokumentasi">
              <IconBook size={20} />
            </a>
            <a className="lp-login" href="/login">
              Masuk
            </a>
          </div>
        </div>
      </header>

      <main id="konten">
        {/* ── Halaman depan ── */}
        <section className="lp-hero">
          <div className="lp-hero__copy">
            <p className="lp-eyebrow">
              <span className="lp-square" aria-hidden="true" />
              Untuk pemilik usaha &amp; akuntan
            </p>
            <h1 className="lp-display">
              Pekerjaan rutin di Accurate selesai <em>sebelum hari Anda dimulai</em>.
            </h1>
            <p className="lp-lede">
              Menagih, mencari berkas, menyusun laporan — biar bagian itu yang dikerjakan. Anda cukup
              membaca hasilnya dan memutuskan.
            </p>
            <div className="lp-cta">
              <a className="lp-btn lp-btn--primary" href={ACCURATE_OAUTH_CTA}>
                Hubungkan Accurate
              </a>
              <a className="lp-btn lp-btn--ghost" href="/login">
                Masuk dengan password
              </a>
            </div>
            <p className="lp-note">
              Pertama kali dari Accurate? Anda diminta membuat password — kurang dari satu menit.
            </p>
          </div>

          <aside className="lp-ledger" aria-label="Contoh laporan pagi">
            <div className="lp-ledger__head">
              <span>Laporan pagi</span>
              <span>No. 078</span>
            </div>
            <div className="lp-ledger__body">
              <div className="lp-score">
                <span className="lp-score__num">78</span>
                <span className="lp-score__cap">
                  Skor kesehatan
                  <strong>Oktober 2026</strong>
                </span>
              </div>
              <dl className="lp-rows">
                <div>
                  <dt>Penjualan</dt>
                  <dd>Rp 48.250.000</dd>
                </div>
                <div>
                  <dt>Margin kotor</dt>
                  <dd>34%</dd>
                </div>
                <div>
                  <dt>Piutang</dt>
                  <dd>Rp 6.100.000</dd>
                </div>
              </dl>
              <p className="lp-advice">
                <span>Saran</span>
                Tagih 3 faktur jatuh tempo pekan ini untuk memperbaiki arus kas.
              </p>
            </div>
            <div className="lp-ledger__foot">Dihasilkan otomatis · 06.00 WIB</div>
          </aside>
        </section>

        {/* ── Pita indeks ── */}
        <div className="lp-ticker" aria-label="Data yang bisa ditanyakan">
          <ul>
            {INDEX.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        {/* ── Kemampuan inti ── */}
        <section className="lp-section" id="kemampuan">
          <div className="lp-section__head lp-reveal">
            <p className="lp-kicker">01 — Kemampuan inti</p>
            <h2>Tiga hal yang paling melegakan</h2>
          </div>
          <div className="lp-pillars">
            {PILLARS.map((p, i) => (
              <article className="lp-pillar lp-reveal" key={p.k} style={{ transitionDelay: `${i * 70}ms` }}>
                <span className="lp-pillar__k">{p.k}</span>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Indeks fitur ── */}
        <section className="lp-section" aria-labelledby="fitur-heading">
          <div className="lp-section__head lp-reveal">
            <p className="lp-kicker">02 — Indeks fitur</p>
            <div>
              <h2 id="fitur-heading">Semua yang bisa dikerjakan</h2>
              <p className="lp-sub">Dua belas pekerjaan yang dulu menumpuk di meja, kini selesai di latar belakang.</p>
            </div>
          </div>
          <ol className="lp-index">
            {CAPS.map((c, i) => (
              <li className="lp-cap lp-reveal" key={c.t} style={{ transitionDelay: `${(i % 3) * 60}ms` }}>
                <span className="lp-cap__n">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{c.t}</h3>
                  <p>{c.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Contoh nyata ── */}
        <section className="lp-section lp-demo" id="contoh">
          <div className="lp-demo__copy lp-reveal">
            <p className="lp-kicker">03 — Contoh nyata</p>
            <h2 className="lp-demo__q">
              <span aria-hidden="true">“</span>Berapa utang pelanggan saya?”
            </h2>
            <p>
              Cukup bertanya seperti ke rekan kerja. AI Asisten membaca data Accurate Anda, lalu
              menyebutkan total piutang beserta pelanggan dan faktur yang menyusunnya — bukan angka
              tanpa dasar.
            </p>
            <ul className="lp-ticks">
              <li>Tidak perlu buka laporan atau menyorot kolom</li>
              <li>Jawaban lengkap dengan rincian faktur</li>
              <li>Bisa dilanjutkan: “tagih yang jatuh tempo minggu ini”</li>
            </ul>
            <div className="lp-cta">
              <a className="lp-btn lp-btn--primary" href={ACCURATE_OAUTH_CTA}>
                Coba dengan data Anda
              </a>
            </div>
          </div>
          <figure className="lp-demo__shot lp-reveal">
            <picture>
              <source
                type="image/webp"
                srcSet="/contoh/chat-utang-360.webp 360w, /contoh/chat-utang-720.webp 720w"
                sizes="(min-width: 920px) 336px, calc(100vw - 3rem)"
              />
              <img
                src="/contoh/chat-utang.jpg"
                alt="Contoh percakapan AI Asisten: bertanya utang pelanggan dan menerima rincian piutang"
                width="720"
                height="1612"
                loading="lazy"
                decoding="async"
              />
            </picture>
            <figcaption>Potret layar · Percakapan piutang pelanggan</figcaption>
          </figure>
        </section>

        {/* ── Cara kerja ── */}
        <section className="lp-section" id="cara-kerja">
          <div className="lp-section__head lp-reveal">
            <p className="lp-kicker">04 — Cara kerja</p>
            <h2>Empat langkah, tanpa ribet</h2>
          </div>
          <ol className="lp-flow">
            {FLOW.map((f, i) => (
              <li className="lp-step lp-reveal" key={f.n} style={{ transitionDelay: `${i * 60}ms` }}>
                <span className="lp-step__n">{f.n}</span>
                <strong>{f.t}</strong>
                <p>{f.d}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Testimoni ── */}
        <section className="lp-section" id="testimoni">
          <div className="lp-section__head lp-reveal">
            <p className="lp-kicker">05 — Testimoni</p>
            <h2>Mereka yang sudah merasakan bedanya</h2>
          </div>
          <div className="lp-quotes">
            {TESTIMONI.map((t, i) => (
              <figure className="lp-quote lp-reveal" key={t.name} style={{ transitionDelay: `${(i % 3) * 70}ms` }}>
                <div className="lp-quote__stars" role="img" aria-label="Penilaian 5 dari 5 bintang">
                  {[0, 1, 2, 3, 4].map((n) => (
                    <IconStar key={n} size={13} />
                  ))}
                </div>
                <blockquote>“{t.quote}”</blockquote>
                <figcaption>
                  <img src={t.photo} alt={`Foto ${t.name}`} width="40" height="40" loading="lazy" />
                  <span>
                    <strong>{t.name}</strong>
                    <span>{t.role}</span>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* ── Suasana kerja ── */}
        <section className="lp-section" aria-labelledby="office-heading">
          <div className="lp-section__head lp-reveal">
            <p className="lp-kicker">06 — Dipakai sehari-hari</p>
            <div>
              <h2 id="office-heading">Dibuka pagi, dipakai sepanjang hari kerja</h2>
              <p className="lp-sub">
                Dari meja pemilik, ruang rapat, sampai tim di lapangan — semuanya membaca angka yang sama.
              </p>
            </div>
          </div>
          <div className="lp-office">
            {OFFICE.map((o, i) => (
              <figure className="lp-office__item lp-reveal" key={o.src} style={{ transitionDelay: `${i * 70}ms` }}>
                <img src={o.src} alt={o.cap} loading="lazy" width="1280" height="720" />
                <figcaption>{o.cap}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      </main>

      {/* ── Ajakan penutup ── */}
      <section className="lp-final lp-reveal">
        <div className="lp-final__inner">
          <div>
            <p className="lp-kicker lp-kicker--dark">07 — Mulai</p>
            <h2>Mulai dari data yang sudah Anda percaya</h2>
            <p>
              Tanpa migrasi, tanpa input ulang. Accurate tetap sumber kebenaran — AI Asisten yang
              mengolahnya untuk Anda.
            </p>
          </div>
          <div className="lp-final__cta">
            <a className="lp-btn lp-btn--primary" href={ACCURATE_OAUTH_CTA}>
              Hubungkan Accurate
            </a>
            <a className="lp-btn lp-btn--dark" href="/login">
              Saya sudah punya akun
            </a>
          </div>
        </div>
      </section>

      {/* ── Kolofon ── */}
      <footer className="lp-footer">
        <div className="lp-footer__inner">
          <div className="lp-footer__brand">
            <img src="/logo-ai-asisten.webp" alt="AI Asisten" width="96" height="32" loading="lazy" />
            <p>
              Asisten AI untuk pemilik usaha dan akuntan di Indonesia. Bekerja di atas data Accurate,
              Google Drive, dan WhatsApp — agar pekerjaan rutin selesai tanpa menambah beban.
            </p>
            <address>
              <strong>PT Asisten Cerdas Indonesia</strong>
              <span>Jakarta, Indonesia</span>
              <a href="mailto:halo@ai-asisten.my.id">halo@ai-asisten.my.id</a>
            </address>
          </div>

          <div className="lp-footer__cols">
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
                <li><a href="/dokumentasi">Dokumentasi</a></li>
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

        <div className="lp-footer__bar">
          <span>© {new Date().getFullYear()} PT Asisten Cerdas Indonesia. Seluruh hak cipta dilindungi.</span>
          <span className="lp-footer__links">
            <a href="/login">Privasi</a>
            <a href="/login">Syarat</a>
            <a href="mailto:halo@ai-asisten.my.id">Kontak</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
