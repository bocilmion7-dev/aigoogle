# Dokumen Listing — Accurate Store

> Template untuk pendaftaran add-on di Accurate Store (account.accurate.id/developer).
> Proses kemitraan/review CPSsoft = prasyarat bisnis (spek §15, spike §17 #5).

## Identitas aplikasi

| Field | Isi |
|---|---|
| Nama | AI Google — Asisten AI untuk Accurate |
| Kategori | Produktivitas / Akuntansi |
| Ringkasan (1 kalimat) | Tanya data akuntansi Anda dengan bahasa Indonesia (teks/suara) dan rapikan folder Google Drive dokumen penjualan secara otomatis. |

## Deskripsi (untuk halaman listing)

**Tanya data akuntansi tanpa ribet.** Add-on ini membuka jendela AI di samping Accurate Online Anda:

- **Chat & suara** — tanyakan pelanggan, faktur penjualan, atau ringkasan transaksi dalam Bahasa Indonesia. Jawaban streaming dengan sumber data yang jelas (badge tool).
- **Rapikan Drive** — pilih folder scan/kwitansi, biarkan AI mengenali jenis dokumen (Faktur, Kuitansi, Nota, Surat Jalan) dari isi PDF-nya dan menertibkannya ke sub-folder. Selalu ada preview rencana + persetujuan Anda sebelum eksekusi; semua aksi dicatat (dasar urungkan).
- **Hak akses sesuai Accurate** — data yang boleh diakses AI mengikuti hak akses modul user di Accurate; admin dapat mengatur role via checklist di aplikasi.
- **Riwayat & audit** — setiap panggilan tool AI dan aksi Drive tercatat, bisa dilihat admin.

Privasi: token akses Accurate & Google Drive terenkripsi at rest; data tidak dipakai melatih model; isolasi ketat antar-perusahaan.

## Paket harga (contoh — sesuaikan kebijakan)

| Paket | Harga | Isi |
|---|---|---|
| Gratis | Rp 0 | 50 pertanyaan AI/bulan, rapikan 5 folder/bulan |
| Pro | Rp 99.000/bln | Chat & suara tanpa batas wajar, rapikan Drive tanpa batas wajar |
| Enterprise | Hubungi kami | SLA, onboarding, volume tinggi |

Entri billing Midtrans QRIS sudah tersedia di sistem (nonaktif sampai kebijakan harga final).

## Data yang diakses

- Profil & daftar database Accurate (saat launch) — untuk identitas tenant.
- Modul sesuai hak akses user (mis. pelanggan, penjualan) — hanya saat AI menjawab pertanyaan Anda.
- Google Drive (scope `drive`) — hanya jika Anda menghubungkan Drive untuk fitur rapikan; aksi terbatas pada folder yang Anda pilih + log lengkap.

## Gambar yang perlu disiapkan (unggah saat listing)

1. `01-landing.png` — halaman landing
2. `02-chat.png` — chat dengan jawaban + badge tool
3. `03-explore.png` — Explore Manager preview rencana
4. `04-admin.png` — editor role checklist
5. `05-audit.png` — tabel audit log

(Semua diambil dari app mode mock/dev, tanpa data nyata.)

## FAQ (usulan)

- **Apakah menggantikan Accurate?** Tidak — hanya add-on baca/tanya + perapian file.
- **Siapa yang bisa login?** Pengguna database Accurate Anda yang membuka add-on (tanpa password tambahan).
- **Bagaimana AI dibatasi?** Mengikuti hak akses modul di Accurate + checklist admin; setiap aksi teraudit.
- **Bisakah data dipakai melatih AI?** Tidak.
