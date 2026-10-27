/**
 * Playbook analisis per bidang usaha.
 * Menentukan: fokus KPI, tolok ukur wajar, risiko khas, dan bentuk saran
 * yang relevan untuk bisnis tersebut — supaya analisis tidak generik.
 */

export interface IndustryPlaybook {
  key: string;
  label: string;
  /** aspek yang paling menentukan kesehatan bisnis ini */
  focus: string[];
  /** tolok ukur kasar (persen) agar penilaian kontekstual */
  benchmark: {
    grossMargin: number;
    netMargin: number;
    /** rasio piutang terhadap penjualan bulanan yang masih wajar */
    receivableRatio: number;
  };
  /** risiko khas industri */
  risks: string[];
  /** bentuk saran yang biasanya paling berdampak */
  levers: string[];
}

const DEFAULT_BENCH: IndustryPlaybook["benchmark"] = {
  grossMargin: 25,
  netMargin: 8,
  receivableRatio: 0.4,
};

const mk = (
  key: string,
  label: string,
  focus: string[],
  risks: string[],
  levers: string[],
  benchmark: Partial<IndustryPlaybook["benchmark"]> = {}
): IndustryPlaybook => ({
  key,
  label,
  focus,
  risks,
  levers,
  benchmark: { ...DEFAULT_BENCH, ...benchmark },
});

export const PLAYBOOKS: Record<string, IndustryPlaybook> = {
  aksesoris_gadget: mk(
    "aksesoris_gadget",
    "Aksesoris & Gadget",
    ["perputaran stok", "margin per SKU", "harga pesaing marketplace", "stok produk laris"],
    ["stok mati karena model HP cepat berganti", "perang harga di marketplace", "barang kompatibilitas salah"],
    ["fokus SKU kompatibel model terbaru", "bundling casing+tempered glass", "cek harga pesaing tiap minggu"],
    { grossMargin: 35, netMargin: 10 }
  ),
  fashion: mk(
    "fashion",
    "Fashion & Pakaian",
    ["perputaran ukuran/warna", "margin per kategori", "retur & ukuran tidak laku", "musim penjualan"],
    ["salah prediksi ukuran/warna", "diskon berlebihan", "stok mati akhir musim"],
    ["kurangi varian yang lambat laku", "jual paket outfit", "manfaatkan momen Harbolnas/Lebaran"],
    { grossMargin: 45, netMargin: 12 }
  ),
  sembako: mk(
    "sembako",
    "Sembako & Kebutuhan Pokok",
    ["perputaran tinggi", "margin tipis per item", "efisiensi pembelian", "harga pokok harian"],
    ["margin sangat tipis", "fluktuasi harga bahan", "kerugian susut/kedaluwarsa"],
    ["negosiasi harga grosir", "jaga perputaran cepat", "awasi barang mendekati kedaluwarsa"],
    { grossMargin: 12, netMargin: 4, receivableRatio: 0.2 }
  ),
  makanan_minuman: mk(
    "makanan_minuman",
    "Makanan & Minuman (F&B)",
    ["food cost", "harga jual per porsi", "limbah bahan", "jam/ hari ramai"],
    ["food cost membengkak", "bahan terbuang", "harga bahan naik"],
    ["hitung food cost per menu", "kontrol porsi & stok harian", "dorong menu margin tertinggi"],
    { grossMargin: 60, netMargin: 12, receivableRatio: 0.2 }
  ),
  bangunan: mk(
    "bangunan",
    "Bangunan & Material",
    ["nilai transaksi besar", "termin pembayaran", "piutang proyek", "ketersediaan stok berat"],
    ["piutang proyek macet", "harga material naik", "kas terikat stok"],
    ["perketat termin & uang muka", "pantau piutang per proyek", "beli sesuai proyek berjalan"],
    { grossMargin: 18, netMargin: 6, receivableRatio: 0.7 }
  ),
  elektronik: mk(
    "elektronik",
    "Elektronik & Peralatan",
    ["margin per unit", "garansi & retur", "perputaran stok", "harga pesaing"],
    ["stok model lama", "klaim garansi", "perang harga"],
    ["jual cepat model lama", "layanan purna jual sebagai pembeda", "pantau harga pasar"],
    { grossMargin: 20, netMargin: 6 }
  ),
  otomotif: mk(
    "otomotif",
    "Otomotif & Sparepart",
    ["kecocokan part", "stok fast-moving", "jasa pasang", "margin part"],
    ["salah part", "stok mati part lama", "harga kompetitor bengkel"],
    ["fokus part fast-moving", "bundling part + jasa", "catat semua jasa pasang"],
    { grossMargin: 30, netMargin: 10 }
  ),
  kesehatan: mk(
    "kesehatan",
    "Kesehatan & Farmasi",
    ["kepatuhan izin/BPOM", "kedaluwarsa", "margin", "resep/pelanggan berulang"],
    ["obat kedaluwarsa", "izin tidak lengkap", "stok kritis"],
    ["kontrol tanggal kedaluwarsa", "lengkapi izin edar", "program pelanggan berulang"],
    { grossMargin: 25, netMargin: 8 }
  ),
  kecantikan: mk(
    "kecantikan",
    "Kecantikan & Perawatan",
    ["margin", "pelanggan berulang", "kedaluwarsa", "tren produk"],
    ["stok mati tren", "kedaluwarsa", "biaya promosi tinggi"],
    ["manfaatkan repeat order", "bundling perawatan", "pantau tren & ulasan"],
    { grossMargin: 50, netMargin: 12 }
  ),
  pertanian: mk(
    "pertanian",
    "Pertanian & Perkebunan",
    ["musim panen", "harga komoditas", "biaya input", "susut hasil"],
    ["fluktuasi harga panen", "serangan hama", "susut pascapanen"],
    ["jual bertahap saat harga baik", "tekan biaya input", "jaga mutu pascapanen"],
    { grossMargin: 25, netMargin: 10, receivableRatio: 0.5 }
  ),
  peternakan: mk(
    "peternakan",
    "Peternakan & Pakan",
    ["harga pakan", "tingkat kematian", "harga jual ternak", "siklus produksi"],
    ["harga pakan naik", "penyakit", "harga jual turun saat panen raya"],
    ["efisiensi pakan", "jadwal kesehatan hewan", "jual pada harga optimal"],
    { grossMargin: 20, netMargin: 8 }
  ),
  jasa_konstruksi: mk(
    "jasa_konstruksi",
    "Jasa Konstruksi",
    ["nilai proyek", "progres vs penagihan", "piutang termin", "biaya material & upah"],
    ["proyek macet", "piutang termin tertahan", "biaya membengkak"],
    ["tagih sesuai progres", "kunci uang muka", "kontrol biaya per proyek"],
    { grossMargin: 15, netMargin: 6, receivableRatio: 0.9 }
  ),
  jasa_konsultan: mk(
    "jasa_konsultan",
    "Jasa Profesional & Konsultan",
    ["utilisasi waktu", "nilai proyek", "piutang", "biaya tetap"],
    ["piutang tertahan", "proyek tidak berulang", "beban tetap tinggi"],
    ["retainer pelanggan", "tagih sesuai milestone", "jaga biaya tetap rendah"],
    { grossMargin: 60, netMargin: 15, receivableRatio: 0.6 }
  ),
  percetakan: mk(
    "percetakan",
    "Percetakan & Kreatif",
    ["biaya bahan", "order berulang", "kapasitas mesin", "margin per order"],
    ["bahan naik", "order musiman", "revisi berulang"],
    ["paket langganan cetak", "minimalkan revisi", "hitung margin per order"],
    { grossMargin: 35, netMargin: 10 }
  ),
  logistik: mk(
    "logistik",
    "Logistik & Pengiriman",
    ["biaya per kiriman", "utilisasi kendaraan", "piutang korporat", "ketepatan waktu"],
    ["biaya bahan bakar", "piutang korporat", "kiriman rusak"],
    ["konsolidasi muatan", "termin jelas untuk korporat", "asuransi kiriman"],
    { grossMargin: 20, netMargin: 7, receivableRatio: 0.6 }
  ),
  pendidikan: mk(
    "pendidikan",
    "Pendidikan & Pelatihan",
    ["jumlah siswa berulang", "biaya pengajar", "pembayaran SPP", "musim pendaftaran"],
    ["siswa berhenti", "SPP tertunggak", "musim sepi"],
    ["program lanjutan siswa", "tagih SPP bertahap", "promo musim pendaftaran"],
    { grossMargin: 50, netMargin: 15 }
  ),
  perjalanan: mk(
    "perjalanan",
    "Travel & Wisata",
    ["margin per paket", "musim liburan", "pembayaran pelanggan", "harga pemasok"],
    ["musim sepi", "pembatalan", "selisih harga pemasok"],
    ["paket low-season", "kebijakan pembatalan jelas", "kunci harga pemasok"],
    { grossMargin: 18, netMargin: 6 }
  ),
  properti: mk(
    "properti",
    "Properti & Sewa",
    ["tingkat hunian", "piutang sewa", "biaya perawatan", "arus kas"],
    ["unit kosong", "sewa tertunggak", "biaya perbaikan"],
    ["jaga okupansi", "tagih sewa terjadwal", "rencana perawatan"],
    { grossMargin: 55, netMargin: 20, receivableRatio: 0.4 }
  ),
  retail_umum: mk(
    "retail_umum",
    "Retail Umum",
    ["perputaran stok", "margin kategori", "stok mati", "pelanggan berulang"],
    ["stok mati", "margin tipis", "persaingan harga"],
    ["fokus produk fast-moving", "bundling & upsell", "pantau margin per kategori"],
    { grossMargin: 25, netMargin: 8 }
  ),
  jasa_umum: mk(
    "jasa_umum",
    "Jasa & Layanan",
    ["utilisasi kapasitas", "harga jasa", "pelanggan berulang", "piutang"],
    ["kapasitas menganggur", "harga jasa terlalu murah", "piutang"],
    ["paket langganan", "hitung ulang tarif jasa", "tagih tepat waktu"],
    { grossMargin: 45, netMargin: 12, receivableRatio: 0.4 }
  ),
};

export function playbookFor(keys: string[]): IndustryPlaybook {
  for (const k of keys) {
    const pb = PLAYBOOKS[k];
    if (pb) return pb;
  }
  return mk(
    "umum",
    "Bisnis Umum",
    ["penjualan", "margin", "piutang", "stok"],
    ["margin tipis", "piutang tertahan", "stok menumpuk"],
    ["fokus produk paling menguntungkan", "tagih piutang", "kendalikan biaya"],
    {}
  );
}
