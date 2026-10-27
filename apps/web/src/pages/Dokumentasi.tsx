import { useEffect } from "react";
import "./landing.css";
import { ACCURATE_OAUTH_CTA } from "../oauth";
import { IconBook } from "../icons";

interface DocSection {
  id: string;
  num: string;
  title: string;
  intro: string;
  image: string;
  imageAlt: string;
  points: string[];
}

const SECTIONS: DocSection[] = [
  {
    id: "mulai",
    num: "01",
    title: "Masuk & hubungkan Accurate",
    intro:
      "Mulai dengan menghubungkan akun Accurate Anda. Data perusahaan akan dibaca otomatis — tanpa migrasi dan tanpa input ulang.",
    image: "/manual/00-login.png",
    imageAlt: "Halaman masuk AI Asisten",
    points: [
      "Klik “Hubungkan Accurate” di halaman depan, atau masuk dengan email & password.",
      "Setelah otorisasi, pilih database perusahaan yang ingin dipakai.",
      "Anda diminta membuat password sekali — minimal 8 karakter dan mengandung angka.",
      "Satu pengguna satu akun; jangan berbagi password antar staf.",
    ],
  },
  {
    id: "ai",
    num: "02",
    title: "AI Asisten — bertanya seperti ke rekan kerja",
    intro:
      "Menu AI adalah asisten chat Anda. Tanyakan apa pun tentang kondisi usaha — piutang, penjualan, stok, kas, hingga laba-rugi.",
    image: "/manual/01-ai.png",
    imageAlt: "Halaman AI Asisten",
    points: [
      "Ketik atau ucapkan pertanyaan, mis. “Berapa total piutang bulan ini?”",
      "Jawaban data selalu ditampilkan sebagai tabel beserta rincian sumbernya.",
      "Riwayat percakapan tersimpan dan bisa dilanjutkan kapan saja.",
      "Ketik /contoh untuk melihat daftar pertanyaan yang sering dipakai.",
    ],
  },
  {
    id: "analisa",
    num: "03",
    title: "Analisis Bisnis — kondisi & saran",
    intro:
      "Halaman Analisa menghitung kesehatan bisnis dari data Accurate, lalu memberi saran yang disesuaikan dengan bidang usaha dan skala perusahaan Anda.",
    image: "/manual/02-analisa.png",
    imageAlt: "Halaman Analisis Bisnis",
    points: [
      "Skor 0–100 menunjukkan kondisi: Bisnis Sehat, Perlu Perhatian, atau Butuh Tindakan.",
      "Setiap temuan menyebutkan penyebab dan langkah perbaikan yang bisa dijalankan.",
      "Analisis dihitung sekali per hari agar hemat kuota Accurate.",
      "Klik “Analisis ulang” bila ingin menghitung ulang di hari yang sama.",
    ],
  },
  {
    id: "insight",
    num: "04",
    title: "Insight — berita industri & harga pesaing",
    intro:
      "Briefing pasar harian dari sumber resmi, ditambah perbandingan harga produk Anda dengan marketplace.",
    image: "/manual/03-insight.png",
    imageAlt: "Halaman Insight pasar",
    points: [
      "Saring berita per topik: Harga, Regulasi, Tren, Event, Ekonomi, Industri.",
      "Harga tiap marketplace ditampilkan sebagai rentang termurah–termahal.",
      "Pencocokan harga bersifat ketat: model, kapasitas, dan varian harus sama.",
      "Gunakan kotak tanya untuk bertanya tentang pasar — jawaban hanya dari sumber yang ditampilkan.",
    ],
  },
  {
    id: "pesanan",
    num: "05",
    title: "Pesanan — dari WhatsApp sampai kurir",
    intro:
      "AI penjaga toko menjawab pembeli di WhatsApp, membuat pesanan, dan mencatatnya ke Accurate. Halaman Pesanan memantau seluruh alurnya.",
    image: "/manual/04-pesanan.png",
    imageAlt: "Halaman daftar pesanan",
    points: [
      "Saring pesanan berdasarkan status: Menunggu bayar, Lunas, SO Accurate, Difakturkan, Selesai.",
      "Buka detail pesanan untuk melihat pembeli, item, pengiriman, dan dokumen Accurate.",
      "Isi nomor HP penerima yang valid agar order kurir tidak gagal.",
      "Status pengiriman diperbarui otomatis dari layanan kurir.",
    ],
  },
  {
    id: "whatsapp",
    num: "06",
    title: "WhatsApp — gateway & AI penjaga toko",
    intro:
      "Hubungkan nomor WhatsApp agar AI dapat membalas pelanggan, mengirim pengingat jatuh tempo, dan laporan harian ke pemilik.",
    image: "/manual/05-whatsapp.png",
    imageAlt: "Halaman pengaturan WhatsApp",
    points: [
      "Hubungkan nomor lewat menu Gateway sesuai instruksi pemindaian.",
      "Atur bahasa, gaya balasan, dan izin AI membuat pesanan otomatis.",
      "Gunakan Sandbox untuk menguji percakapan tanpa mengirim pesan sungguhan.",
      "Pantau percakapan masuk dan keluar di menu Chat WA.",
    ],
  },
  {
    id: "penjualan",
    num: "07",
    title: "Penjualan & Wallet — laporan dan penarikan",
    intro:
      "Rangkuman pesanan sukses serta saldo hasil penjualan (terpisah dari saldo token AI) yang bisa ditarik ke rekening.",
    image: "/manual/06-penjualan.png",
    imageAlt: "Halaman Penjualan dan Wallet",
    points: [
      "Tab Dompet menampilkan saldo tersedia, riwayat penarikan, dan pergerakan saldo.",
      "Klik “Tarik Dana”, pilih rekening tujuan, lalu masukkan jumlah (minimal Rp10.000).",
      "Nomor rekening divalidasi otomatis sebelum disimpan agar tidak salah transfer.",
      "Tab Laporan Penjualan bisa disaring per tanggal atau periode.",
    ],
  },
  {
    id: "scan",
    num: "08",
    title: "Scan nota, faktur & bukti bayar",
    intro:
      "Unggah foto atau PDF; AI membaca isinya, mengenali jenis dokumen, lalu membantu memasukkannya ke Accurate sekaligus menyimpan berkasnya.",
    image: "/manual/07-scan.png",
    imageAlt: "Halaman scan nota dan bukti bayar",
    points: [
      "Foto nota/kuitansi atau unggah PDF (maksimal 15 MB).",
      "Periksa hasil baca: tanggal, pihak, jumlah, dan akun sebelum menyimpan.",
      "Pilih tujuan pencatatan (faktur penjualan, penerimaan, pembelian, atau beban).",
      "Dokumen ikut diunggah ke Google Drive dan dikategorikan otomatis.",
    ],
  },
  {
    id: "drive",
    num: "09",
    title: "Explore Manager — merapikan Google Drive",
    intro: "AI menata nama berkas dan memindahkan dokumen ke kategori yang benar. Semua perubahan bisa dibatalkan sekaligus.",
    image: "/manual/08-explore.png",
    imageAlt: "Halaman Explore Manager",
    points: [
      "Hubungkan Google Drive lebih dulu agar Explore dapat membaca berkas.",
      "Periksa pratinjau rencana penataan sebelum menjalankannya.",
      "Setelah disetujui, berkas diganti nama dan dipindah ke folder kategori.",
      "Satu klik membatalkan seluruh perubahan bila hasilnya tidak sesuai.",
    ],
  },
  {
    id: "akses",
    num: "10",
    title: "Role Akses — tim, peran, dan audit",
    intro: "Undang staf dan tentukan hak aksesnya. Setiap tindakan penting tercatat sehingga mudah ditelusuri.",
    image: "/manual/10-role-akses.png",
    imageAlt: "Halaman pengelolaan user dan peran",
    points: [
      "Buat peran lebih dulu, lalu tentukan izin yang melekat pada peran itu.",
      "Tambahkan anggota tim dan tetapkan perannya.",
      "Berikan izin seminimal mungkin sesuai kebutuhan pekerjaan.",
      "Menu Aktivitas menampilkan jejak tindakan pengguna.",
    ],
  },
  {
    id: "saldo",
    num: "11",
    title: "Saldo & pemakaian AI",
    intro: "Setiap pemakaian AI memotong saldo token. Halaman Saldo menampilkan sisa saldo, riwayat pemakaian, dan cara top up.",
    image: "/manual/11-saldo.png",
    imageAlt: "Halaman saldo dan pemakaian AI",
    points: [
      "Saldo juga tampil singkat di header aplikasi.",
      "Top up dengan memilih nominal lalu membayar melalui QRIS.",
      "Riwayat pemakaian menunjukkan konsumsi per aktivitas.",
      "Pantau saldo agar layanan tidak terhenti saat dibutuhkan.",
    ],
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
      { threshold: 0.08, rootMargin: "0px 0px -30px 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

export function Dokumentasi() {
  useReveal();

  return (
    <div className="landing ld2">
      <header className="ld2-nav">
        <a className="ld2-brand" href="/" aria-label="AI Asisten — beranda">
          <img src="/logo.webp" alt="AI Asisten" className="ld2-logo" width={114} height={38} />
        </a>
        <nav className="ld2-links" aria-label="Navigasi utama">
          <a href="/">Beranda</a>
          <a href="#dok-isi">Daftar isi</a>
          <a className="ld2-login" href="/login">Masuk</a>
        </nav>
      </header>

      <main className="doc-page">
        <section className="doc-hero">
          <span className="ld2-eyebrow">Dokumentasi</span>
          <h1>Panduan AI Asisten</h1>
          <p>
            Panduan bergambar untuk pemilik usaha dan staf: mulai dari menghubungkan Accurate hingga
            membaca analisis, mengelola pesanan, dan menarik hasil penjualan.
          </p>
          <div className="ld2-cta">
            <a className="ld2-btn ld2-btn--primary" href={ACCURATE_OAUTH_CTA}>
              Hubungkan Accurate
            </a>
            <a className="ld2-btn ld2-btn--ghost" href="#dok-isi">
              Lihat daftar isi
            </a>
          </div>
        </section>

        <nav className="doc-toc" id="dok-isi" aria-label="Daftar isi dokumentasi">
          <span className="doc-toc__title">
            <IconBook size={16} /> Daftar isi
          </span>
          <ol>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>
                  <span className="doc-toc__num">{s.num}</span>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {SECTIONS.map((s) => (
          <section className="doc-sec ld-reveal" id={s.id} key={s.id}>
            <div className="doc-sec__head">
              <span className="doc-sec__num">{s.num}</span>
              <h2>{s.title}</h2>
            </div>
            <p className="doc-sec__intro">{s.intro}</p>
            <div className="doc-sec__body">
              <figure className="doc-shot">
                <div className="doc-shot__phone">
                  <img src={s.image} alt={s.imageAlt} loading="lazy" width="390" height="900" />
                </div>
              </figure>
              <ul className="doc-points">
                {s.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          </section>
        ))}

        <section className="doc-cta">
          <h2>Siap mencoba dengan data Anda?</h2>
          <p>Tanpa migrasi, tanpa input ulang. Accurate tetap sumber kebenaran — AI Asisten yang mengolahnya.</p>
          <div className="ld2-cta">
            <a className="ld2-btn ld2-btn--primary" href={ACCURATE_OAUTH_CTA}>
              Hubungkan Accurate
            </a>
            <a className="ld2-btn ld2-btn--ghost" href="/">
              Kembali ke beranda
            </a>
          </div>
        </section>
      </main>

      <footer className="ld2-footer">
        <div className="ld2-footer__bar">
          <span>© {new Date().getFullYear()} PT Asisten Cerdas Indonesia.</span>
          <span className="ld2-footer__links">
            <a href="/">Beranda</a>
            <a href="/login">Masuk</a>
            <a href="mailto:halo@ai-asisten.my.id">Kontak</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
