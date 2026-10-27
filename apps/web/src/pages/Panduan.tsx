import { useEffect, useState } from "react";
import { getMe } from "../api";
import { AppHeader } from "../ui";
import { ACCURATE_OAUTH_CTA } from "../oauth";
import { IconCheck, IconChevron } from "../icons";

interface Section {
  id: string;
  icon: string;
  title: string;
  intro: string;
  steps: Array<{ t: string; d: string }>;
  tips?: string[];
}

const SECTIONS: Section[] = [
  {
    id: "mulai",
    icon: "01",
    title: "Memulai & menghubungkan Accurate",
    intro:
      "Seluruh analisis dan jawaban AI bersumber dari data Accurate perusahaan Anda. Tanpa koneksi Accurate, sebagian besar fitur tidak aktif.",
    steps: [
      { t: "Masuk ke aplikasi", d: "Klik “Hubungkan Accurate” di halaman depan, atau masuk dengan email & password bila sudah punya." },
      { t: "Pilih database perusahaan", d: "Setelah otorisasi Accurate, pilih database yang ingin dipakai. Satu akun login mewakili satu orang." },
      { t: "Buat password (sekali)", d: "Anda diminta membuat password (minimal 8 karakter, mengandung angka) agar bisa masuk tanpa Accurate." },
      { t: "Buka dashboard", d: "Menu “AI” adalah asisten chat; menu lain mengelompokkan pekerjaan per topik." },
    ],
    tips: [
      "Satu pengguna = satu akun. Jangan berbagi password antar staf.",
      "Bila data Accurate tidak muncul, buka Pengaturan lalu periksa status koneksi.",
    ],
  },
  {
    id: "ai",
    icon: "02",
    title: "AI Asisten — bertanya dengan bahasa sehari-hari",
    intro:
      "Anda bisa bertanya seperti kepada rekan kerja: piutang, penjualan, stok, kas, sampai laba-rugi. Jawaban disertai rincian sumbernya.",
    steps: [
      { t: "Ketik atau ucapkan pertanyaan", d: "Contoh: “Berapa total piutang bulan ini?” atau “Barang apa yang paling laris?”." },
      { t: "Baca rincian jawaban", d: "Jawaban data selalu ditampilkan sebagai tabel, lengkap dengan angka pendukung." },
      { t: "Lanjutkan percakapan", d: "Riwayat sesi tersimpan; Anda bisa melanjutkan kapan saja." },
      { t: "Pakai perintah /contoh", d: "Ketik /contoh untuk melihat daftar template pertanyaan yang sering dipakai." },
    ],
    tips: [
      "Semakin spesifik pertanyaan (periode, nama pelanggan, nama barang), semakin tepat jawabannya.",
      "Jika jawaban terasa janggal, sebutkan periode secara eksplisit, mis. “September 2026”.",
    ],
  },
  {
    id: "analisa",
    icon: "03",
    title: "Analisis Bisnis — kondisi & saran",
    intro:
      "Halaman Analisa menghitung kesehatan bisnis dari data Accurate, lalu memberi saran yang disesuaikan dengan bidang usaha dan skala perusahaan.",
    steps: [
      { t: "Buka menu Analisa", d: "Analisis dihitung sekali per hari agar hemat kuota Accurate." },
      { t: "Baca skor & verdict", d: "Skor 0–100 menunjukkan kondisi: Bisnis Sehat, Perlu Perhatian, atau Butuh Tindakan." },
      { t: "Telusuri temuan", d: "Setiap temuan berisi penjelasan penyebab dan saran konkret yang bisa dijalankan." },
      { t: "Klik “Analisis ulang”", d: "Hanya tombol ini yang memaksa perhitungan baru pada hari yang sama." },
    ],
    tips: [
      "Jalankan analisis ulang setelah menutup pembukuan bulanan.",
      "Perhatikan margin kotor: ambang “wajar” berbeda per industri (mis. sembako vs F&B).",
    ],
  },
  {
    id: "insight",
    icon: "04",
    title: "Insight — berita industri & harga pesaing",
    intro:
      "Insight merangkum berita dari sumber resmi dan membandingkan harga produk Anda dengan marketplace, difilter agar hanya produk yang benar-benar sejenis.",
    steps: [
      { t: "Buka menu Insight", d: "Briefing diperbarui otomatis setiap hari." },
      { t: "Saring per topik", d: "Gunakan chip topik: Harga, Regulasi, Tren, Event, Ekonomi, Industri." },
      { t: "Cek Pasar & pesaing", d: "Lihat rentang harga termurah–termahal per marketplace dibandingkan harga jual Anda." },
      { t: "Gunakan kotak tanya", d: "Ajukan pertanyaan tentang pasar; jawaban hanya memakai sumber yang ditampilkan." },
    ],
    tips: [
      "Pencocokan harga bersifat ketat: model, ukuran, dan varian harus sama (mis. iPhone 6S 128GB tidak dicocokkan dengan 64GB atau 6S Plus).",
      "Jika harga pesaing kosong, biasanya karena produk belum terpantau atau kuota pencarian harian habis.",
    ],
  },
  {
    id: "pesanan",
    icon: "05",
    title: "Pesanan — dari WhatsApp sampai kurir",
    intro:
      "AI penjaga toko menjawab pembeli di WhatsApp, membuat pesanan, dan mencatatnya ke Accurate. Halaman Pesanan memantau seluruh alurnya.",
    steps: [
      { t: "Pantau status", d: "Filter status: Menunggu bayar, Lunas, SO Accurate, Difakturkan, Selesai." },
      { t: "Buka detail pesanan", d: "Klik pesanan untuk melihat pembeli, item, pengiriman, dan dokumen Accurate." },
      { t: "Proses pengiriman", d: "Isi nomor penerima yang valid, lalu proses ke kurir untuk mendapatkan resi." },
      { t: "Lacak paket", d: "Status pengiriman diperbarui otomatis dari layanan kurir." },
    ],
    tips: [
      "Nomor HP penerima wajib valid (8–16 digit) agar order kurir tidak gagal.",
      "Bila sinkronisasi Accurate gagal, gunakan tombol “Ulangi sinkron” di detail pesanan.",
    ],
  },
  {
    id: "wa",
    icon: "06",
    title: "WhatsApp — gateway & AI penjaga toko",
    intro:
      "Hubungkan nomor WhatsApp agar AI dapat membalas pelanggan, mengirim pengingat jatuh tempo, dan laporan harian.",
    steps: [
      { t: "Hubungkan nomor", d: "Buka WhatsApp → Gateway, lalu pindai kode atau sambungkan sesuai instruksi." },
      { t: "Atur AI penjaga toko", d: "Tentukan bahasa, gaya balasan, dan apakah AI boleh membuat pesanan otomatis." },
      { t: "Uji tanpa risiko", d: "Gunakan menu Sandbox untuk mencoba percakapan tanpa mengirim pesan sungguhan." },
      { t: "Pantau riwayat", d: "Menu Chat WA menampilkan percakapan masuk dan keluar." },
    ],
    tips: [
      "Aktifkan Sandbox lebih dulu sebelum mengaktifkan AI ke pelanggan nyata.",
      "Pengingat jatuh tempo memakai data piutang Accurate, jadi pastikan koneksi tetap aktif.",
    ],
  },
  {
    id: "penjualan",
    icon: "07",
    title: "Penjualan & Wallet — laporan dan penarikan",
    intro:
      "Halaman Penjualan merangkum pesanan sukses dan menyimpan saldo hasil penjualan (terpisah dari saldo token AI).",
    steps: [
      { t: "Tab Dompet", d: "Lihat saldo tersedia, riwayat penarikan, dan pergerakan saldo." },
      { t: "Tarik dana", d: "Klik “Tarik Dana”, pilih rekening tujuan, lalu masukkan jumlah (minimal Rp10.000)." },
      { t: "Tambah rekening", d: "Nomor rekening divalidasi otomatis lewat Brick sebelum disimpan, agar tidak salah transfer." },
      { t: "Tab Laporan Penjualan", d: "Saring pesanan per tanggal atau periode; tabel dapat dibuka per baris di ponsel." },
    ],
    tips: [
      "Saldo wallet adalah hasil penjualan; saldo token AI diatur terpisah di menu Saldo.",
      "Penarikan berstatus “Pending” sampai disetujui/dibayar admin.",
    ],
  },
  {
    id: "scan",
    icon: "08",
    title: "Scan nota, faktur & bukti bayar",
    intro:
      "Unggah foto atau PDF; AI membaca isinya, mengenali jenis dokumen, lalu membantu memasukkan ke Accurate sekaligus menyimpan berkasnya.",
    steps: [
      { t: "Pilih berkas", d: "Foto nota/kuitansi atau unggah PDF (maksimal 15 MB)." },
      { t: "Periksa hasil baca", d: "AI mengisi kolom tanggal, pihak, jumlah, dan akun; periksa sebelum menyimpan." },
      { t: "Simpan entri ke Accurate", d: "Pilih tujuan (faktur penjualan, penerimaan, pembelian, atau beban) lalu simpan." },
      { t: "Berkas tersimpan", d: "Dokumen ikut diunggah ke Google Drive dan dikategorikan otomatis." },
    ],
    tips: [
      "Foto dengan pencahayaan cukup dan tidak terpotong agar pembacaan akurat.",
      "Selalu periksa nominal sebelum menyimpan — AI bisa salah membaca angka yang buram.",
    ],
  },
  {
    id: "drive",
    icon: "09",
    title: "Explore Manager — merapikan Google Drive",
    intro:
      "AI menata nama file dan memindahkan dokumen ke kategori yang benar. Semua perubahan bisa dibatalkan sekaligus.",
    steps: [
      { t: "Hubungkan Google Drive", d: "Lewat Pengaturan, izinkan akses ke Drive perusahaan." },
      { t: "Lihat rencana", d: "Explore menampilkan pratinjau rencana penataan sebelum dijalankan." },
      { t: "Jalankan penataan", d: "Setujui rencana; file diganti nama dan dipindah ke folder kategori." },
      { t: "Urungkan bila perlu", d: "Satu klik mengembalikan seluruh perubahan." },
    ],
    tips: [
      "Selalu periksa pratinjau sebelum menyetujui, terutama untuk file penting.",
      "Penataan bersifat reversibel, tetapi tetap disarankan mencoba pada folder kecil dulu.",
    ],
  },
  {
    id: "toko",
    icon: "10",
    title: "Akun Toko — alamat asal & kurir",
    intro:
      "Atur alamat gudang asal dan koneksi kurir. Data ini dipakai saat menghitung ongkir dan membuat order pengiriman.",
    steps: [
      { t: "Isi data asal", d: "Nama kontak, nomor HP, nama toko, alamat lengkap, dan kode pos." },
      { t: "Cari kode pos", d: "Gunakan pencarian area untuk memastikan kode pos benar." },
      { t: "Simpan", d: "Pengaturan langsung dipakai pada pesanan berikutnya." },
    ],
    tips: [
      "Pastikan nomor HP aktif — kurir menghubungi nomor ini.",
      "Periksa mode pengiriman: Sandbox untuk uji coba, Live untuk pengiriman nyata.",
    ],
  },
  {
    id: "akses",
    icon: "11",
    title: "Role Akses — tim, peran, dan audit",
    intro:
      "Undang staf dan tentukan hak aksesnya. Setiap tindakan penting tercatat sehingga mudah ditelusuri.",
    steps: [
      { t: "Buat peran", d: "Tentukan izin per peran, mis. hanya melihat atau boleh menyimpan transaksi." },
      { t: "Undang pengguna", d: "Tambahkan anggota tim dan tetapkan perannya." },
      { t: "Periksa jejak audit", d: "Menu Aktivitas menampilkan catatan tindakan pengguna." },
    ],
    tips: [
      "Berikan izin seminimal mungkin sesuai kebutuhan pekerjaan.",
      "Tinjau peran secara berkala, terutama saat ada pergantian staf.",
    ],
  },
  {
    id: "saldo",
    icon: "12",
    title: "Saldo & pemakaian AI",
    intro:
      "Setiap pemakaian AI memotong saldo token. Halaman Saldo menampilkan sisa saldo, riwayat pemakaian, dan cara top up.",
    steps: [
      { t: "Lihat sisa saldo", d: "Saldo tampil juga di header aplikasi." },
      { t: "Top up", d: "Pilih nominal, lalu bayar melalui QRIS." },
      { t: "Pantau pemakaian", d: "Riwayat menunjukkan pemakaian per aktivitas." },
    ],
    tips: [
      "Aktifkan notifikasi bila saldo menipis agar layanan tidak terhenti.",
      "Biaya per fitur berbeda; dokumen/gambar umumnya lebih mahal daripada chat teks.",
    ],
  },
];

export function Panduan() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [open, setOpen] = useState<string>("mulai");

  useEffect(() => {
    void getMe().then(setMe);
  }, []);

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash && SECTIONS.some((s) => s.id === hash)) setOpen(hash);
  }, []);

  if (me === undefined) return null;
  if (me === null) {
    window.location.href = "/login";
    return null;
  }

  return (
    <div className="app">
      <AppHeader me={me} />
      <main className="page page--narrow manual">
        <header className="manual__head">
          <div>
            <h1>Panduan Penggunaan</h1>
            <p className="page__sub">Langkah demi langkah untuk admin & staf perusahaan</p>
          </div>
          <a className="btn btn--sm" href={ACCURATE_OAUTH_CTA}>
            Hubungkan Accurate
          </a>
        </header>

        <nav className="manual__toc" aria-label="Daftar isi">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="manual__toc-item" onClick={() => setOpen(s.id)}>
              <span className="manual__toc-num">{s.icon}</span>
              <span>{s.title}</span>
            </a>
          ))}
        </nav>

        <div className="manual__sections">
          {SECTIONS.map((s) => {
            const isOpen = open === s.id;
            return (
              <section className={`manual__section${isOpen ? " is-open" : ""}`} id={s.id} key={s.id}>
                <button
                  type="button"
                  className="manual__toggle"
                  onClick={() => setOpen(isOpen ? "" : s.id)}
                  aria-expanded={isOpen}
                  aria-controls={`manual-body-${s.id}`}
                >
                  <span className="manual__num">{s.icon}</span>
                  <span className="manual__title">{s.title}</span>
                  <span className="manual__chev" aria-hidden="true">
                    <IconChevron size={16} />
                  </span>
                </button>
                {isOpen && (
                  <div className="manual__body" id={`manual-body-${s.id}`}>
                    <p className="manual__intro">{s.intro}</p>
                    <ol className="manual__steps">
                      {s.steps.map((st, i) => (
                        <li key={st.t}>
                          <span className="manual__step-num">{i + 1}</span>
                          <div>
                            <strong>{st.t}</strong>
                            <p>{st.d}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                    {s.tips && s.tips.length > 0 && (
                      <div className="manual__tips">
                        <strong>Tips</strong>
                        <ul>
                          {s.tips.map((t) => (
                            <li key={t}>
                              <IconCheck size={13} /> {t}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <p className="manual__foot">
          Butuh bantuan lain? Hubungi <a href="mailto:halo@ai-asisten.my.id">halo@ai-asisten.my.id</a>.
        </p>
      </main>
    </div>
  );
}
