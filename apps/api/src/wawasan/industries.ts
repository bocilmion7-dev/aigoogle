/**
 * Taksonomi industri + kamus kata kunci untuk INSIGHT pasar.
 *
 * Deteksi bidang usaha HARUS faktual: hanya dari data Accurate (kategori barang,
 * nama barang, omzet produk terlaris). Tidak memakai AI untuk menebak industri.
 */

export type Topic = "regulasi" | "harga" | "tren" | "event" | "makro" | "industri" | "umum";

export interface QueryDef {
  topic: Topic;
  q: string;
}

export interface IndustryDef {
  key: string;
  label: string;
  /** kata kunci pencocokan katalog/omzet (huruf kecil) */
  keywords: string[];
  /** kata kunci untuk skor relevansi berita */
  newsKeywords: string[];
  queries: QueryDef[];
}

export const INDUSTRIES: IndustryDef[] = [
  {
    key: "aksesoris_gadget",
    label: "Aksesoris & Gadget",
    keywords: [
      "iphone", "ipad", "samsung", "xiaomi", "oppo", "vivo", "realme", "infinix", "handphone",
      "hp", "casing", "case", "anti gores", "tempered", "glass", "charger", "kabel data", "powerbank",
      "earphone", "headset", "tws", "lcd", "baterai", "gadget", "aksesoris", "smartwatch", "airpods",
    ],
    newsKeywords: ["aksesoris hp", "gadget", "smartphone", "elektronik konsumen", "impor elektronik", "e-commerce gadget"],
    queries: [
      { topic: "tren", q: "tren gadget dan aksesoris HP Indonesia" },
      { topic: "industri", q: "importir aksesoris HP aturan impor elektronik" },
      { topic: "event", q: "Harbolnas promo gadget toko online" },
      { topic: "tren", q: "peluncuran smartphone baru harga iPhone" },
      { topic: "harga", q: "harga aksesoris HP casing tempered glass" },
      { topic: "industri", q: "bisnis toko aksesoris HP Indonesia" },
    ],
  },
  {
    key: "fashion",
    label: "Fashion & Pakaian",
    keywords: [
      "baju", "kaos", "kemeja", "blouse", "celana", "jeans", "rok", "dress", "gamis", "hijab", "kerudung",
      "jaket", "sweater", "sepatu", "sandal", "tas", "dompet", "pakaian", "fashion", "mukena", "batik",
    ],
    newsKeywords: ["tren fashion", "brand lokal", "fashion e-commerce", "industri tekstil"],
    queries: [
      { topic: "tren", q: "tren fashion Indonesia brand lokal" },
      { topic: "event", q: "promo fashion Ramadan Lebaran" },
      { topic: "industri", q: "industri tekstil dan pakaian Indonesia" },
    ],
  },
  {
    key: "sembako",
    label: "Sembako & Kebutuhan Pokok",
    keywords: [
      "beras", "gula", "minyak goreng", "tepung", "telur", "mie instan", "sembako", "kedelai", "bawang",
      "cabai", "terigu", "gula pasir", "minyak", "garam", "kecap",
    ],
    newsKeywords: ["harga pangan", "harga sembako", "operasi pasar", "inflasi pangan", "harga beras"],
    queries: [
      { topic: "harga", q: "harga sembako beras gula minyak hari ini" },
      { topic: "regulasi", q: "kebijakan pangan operasi pasar pemerintah" },
      { topic: "harga", q: "inflasi pangan Indonesia" },
    ],
  },
  {
    key: "makanan_minuman",
    label: "Makanan & Minuman (F&B)",
    keywords: [
      "kopi", "susu", "teh", "sirup", "boba", "cup", "ayam", "nasi", "roti", "kue", "snack", "bumbu",
      "saus", "minuman", "makanan", "bahan kue", "keju", "mentega", "frozen food",
    ],
    newsKeywords: ["harga bahan pangan", "sertifikasi halal", "tren kuliner", "pajak restoran", "bisnis kuliner"],
    queries: [
      { topic: "harga", q: "harga bahan pangan cabai beras gula" },
      { topic: "regulasi", q: "sertifikasi halal usaha kuliner" },
      { topic: "tren", q: "tren kuliner dan bisnis makanan minuman" },
      { topic: "event", q: "Ramadan Lebaran bisnis kuliner" },
    ],
  },
  {
    key: "bangunan",
    label: "Bangunan & Material",
    keywords: [
      "semen", "pasir", "batu", "besi", "baja", "pipa", "cat", "keramik", "granit", "kayu", "paku",
      "triplek", "material", "bata", "genteng", "kaca", "aluminium",
    ],
    newsKeywords: ["harga material bangunan", "harga semen", "harga besi", "infrastruktur", "properti"],
    queries: [
      { topic: "harga", q: "harga material bangunan semen besi" },
      { topic: "makro", q: "proyek infrastruktur properti Indonesia" },
      { topic: "event", q: "musim hujan konstruksi bangunan" },
    ],
  },
  {
    key: "elektronik",
    label: "Elektronik & Peralatan",
    keywords: [
      "tv", "televisi", "kulkas", "mesin cuci", "ac", "kipas", "rice cooker", "blender", "dispenser",
      "lampu", "elektronik", "instalasi listrik", "setrika", "microwave", "oven",
    ],
    newsKeywords: ["tren elektronik", "harga elektronik", "impor elektronik", "peralatan rumah tangga"],
    queries: [
      { topic: "tren", q: "tren elektronik rumah tangga Indonesia" },
      { topic: "harga", q: "harga elektronik impor" },
      { topic: "regulasi", q: "regulasi impor elektronik SNI" },
    ],
  },
  {
    key: "otomotif",
    label: "Otomotif & Sparepart",
    keywords: [
      "oli", "ban", "velg", "bearing", "kampas", "busi", "filter", "sparepart", "motor", "mobil", "aki",
      "shockbreaker", "service", "bengkel", "helm", "variasi motor", "knalpot",
    ],
    newsKeywords: ["industri otomotif", "harga sparepart", "kendaraan listrik", "penjualan mobil motor"],
    queries: [
      { topic: "industri", q: "industri otomotif dan sparepart Indonesia" },
      { topic: "harga", q: "harga sparepart dan suku cadang" },
      { topic: "tren", q: "kendaraan listrik motor listrik" },
    ],
  },
  {
    key: "kesehatan",
    label: "Kesehatan & Farmasi",
    keywords: [
      "obat", "vitamin", "masker", "alkes", "tensimeter", "termometer", "farmasi", "klinik", "suplemen",
      "plester", "perban", "handscoon", "alkes kesehatan",
    ],
    newsKeywords: ["regulasi farmasi", "BPOM", "tren kesehatan", "obat dan vitamin"],
    queries: [
      { topic: "regulasi", q: "regulasi farmasi BPOM obat" },
      { topic: "tren", q: "tren kesehatan suplemen vitamin" },
    ],
  },
  {
    key: "kecantikan",
    label: "Kecantikan & Perawatan",
    keywords: [
      "skincare", "serum", "lipstik", "makeup", "kosmetik", "salon", "perawatan", "parfum", "sunscreen",
      "foundation", "masker wajah", "cream", "krim",
    ],
    newsKeywords: ["tren skincare", "regulasi kosmetik BPOM", "industri kecantikan"],
    queries: [
      { topic: "tren", q: "tren skincare dan kosmetik Indonesia" },
      { topic: "regulasi", q: "regulasi kosmetik BPOM" },
    ],
  },
  {
    key: "pertanian",
    label: "Pertanian & Perkebunan",
    keywords: [
      "pupuk", "benih", "pestisida", "traktor", "cangkul", "pertanian", "perkebunan", "sawit", "bibit",
      "herbisida", "irigasi",
    ],
    newsKeywords: ["harga komoditas", "harga pupuk", "panen", "ekspor pertanian", "harga sawit"],
    queries: [
      { topic: "harga", q: "harga komoditas pertanian sawit pupuk" },
      { topic: "regulasi", q: "kebijakan pertanian ekspor impor" },
      { topic: "event", q: "musim panen pertanian" },
    ],
  },
  {
    key: "peternakan",
    label: "Peternakan & Pakan",
    keywords: ["pakan ternak", "ayam", "sapi", "kambing", "vaksin hewan", "peternakan", "telur ayam", "daging"],
    newsKeywords: ["harga pakan ternak", "harga daging ayam", "flu burung", "peternakan"],
    queries: [
      { topic: "harga", q: "harga pakan ternak dan daging" },
      { topic: "regulasi", q: "regulasi peternakan wabah hewan" },
    ],
  },
  {
    key: "jasa_konstruksi",
    label: "Jasa Konstruksi",
    keywords: ["jasa bangun", "renovasi", "kontraktor", "tukang", "instalasi", "proyek", "konstruksi"],
    newsKeywords: ["proyek infrastruktur", "tender konstruksi", "jasa konstruksi"],
    queries: [
      { topic: "industri", q: "proyek infrastruktur tender konstruksi" },
      { topic: "harga", q: "harga material konstruksi" },
    ],
  },
  {
    key: "jasa_konsultan",
    label: "Jasa Profesional & Konsultan",
    keywords: ["konsultan", "konsultasi", "desain", "arsitek", "perencanaan", "audit", "pajak", "akuntan"],
    newsKeywords: ["regulasi usaha", "tarif jasa", "pajak jasa", "konsultan bisnis"],
    queries: [
      { topic: "regulasi", q: "regulasi usaha dan pajak jasa" },
      { topic: "tren", q: "tren jasa konsultan bisnis" },
    ],
  },
  {
    key: "percetakan",
    label: "Percetakan & Kreatif",
    keywords: ["cetak", "printing", "banner", "spanduk", "brosur", "kartu nama", "stiker", "percetakan", "undangan"],
    newsKeywords: ["harga kertas", "digital printing", "tren desain", "industri kreatif"],
    queries: [
      { topic: "harga", q: "harga kertas dan digital printing" },
      { topic: "tren", q: "tren industri kreatif desain" },
    ],
  },
  {
    key: "logistik",
    label: "Logistik & Pengiriman",
    keywords: ["ekspedisi", "pengiriman", "logistik", "trucking", "gudang", "kargo", "kurir", "ongkir"],
    newsKeywords: ["tarif logistik", "ongkos kirim", "ekspor impor", "harga BBM"],
    queries: [
      { topic: "harga", q: "tarif logistik ongkos kirim BBM" },
      { topic: "regulasi", q: "regulasi ekspor impor kepabeanan" },
    ],
  },
  {
    key: "pendidikan",
    label: "Pendidikan & Pelatihan",
    keywords: ["kursus", "les", "pelatihan", "training", "bimbingan", "pendidikan", "sekolah", "kursus online"],
    newsKeywords: ["regulasi pendidikan", "tren kursus online", "pelatihan kerja"],
    queries: [
      { topic: "regulasi", q: "regulasi pendidikan dan pelatihan" },
      { topic: "tren", q: "tren kursus online pelatihan kerja" },
    ],
  },
  {
    key: "perjalanan",
    label: "Travel & Wisata",
    keywords: ["tiket", "travel", "hotel", "wisata", "tour", "umroh", "paket wisata"],
    newsKeywords: ["pariwisata", "tiket pesawat", "musim liburan", "travel umroh"],
    queries: [
      { topic: "tren", q: "pariwisata dan tiket pesawat Indonesia" },
      { topic: "event", q: "musim liburan travel" },
    ],
  },
  {
    key: "properti",
    label: "Properti & Sewa",
    keywords: ["properti", "sewa", "kontrakan", "rumah", "tanah", "apartemen", "ruko", "kost"],
    newsKeywords: ["harga properti", "KPR", "suku bunga", "pasar properti"],
    queries: [
      { topic: "harga", q: "harga properti KPR suku bunga" },
      { topic: "regulasi", q: "regulasi properti dan perumahan" },
    ],
  },
  {
    key: "retail_umum",
    label: "Retail Umum",
    keywords: [],
    newsKeywords: ["tren retail", "belanja konsumen", "promo belanja", "ritel Indonesia"],
    queries: [
      { topic: "tren", q: "tren retail dan belanja konsumen Indonesia" },
      { topic: "event", q: "Harbolnas promo belanja" },
    ],
  },
  {
    key: "jasa_umum",
    label: "Jasa & Layanan",
    keywords: ["jasa", "layanan", "servis", "perbaikan", "reparasi"],
    newsKeywords: ["regulasi usaha jasa", "tarif jasa", "tren layanan"],
    queries: [
      { topic: "regulasi", q: "regulasi usaha jasa dan layanan" },
      { topic: "tren", q: "tren layanan jasa Indonesia" },
    ],
  },
];

/** Berita umum yang relevan untuk semua usaha. */
export const GENERIC_QUERIES: QueryDef[] = [
  { topic: "regulasi", q: "pajak UMKM PPN Coretax" },
  { topic: "makro", q: "ekonomi Indonesia suku bunga BI inflasi kurs" },
  { topic: "makro", q: "harga BBM listrik tarif Indonesia" },
  { topic: "umum", q: "upah minimum provinsi 2026" },
  { topic: "umum", q: "berita bisnis UMKM Indonesia" },
];

/** Domain yang dianggap AMAN/terjamin (sumber resmi + media bisnis kredibel). */
export const WHITELIST_DOMAINS: string[] = [
  // resmi
  "kemenkeu.go.id",
  "pajak.go.id",
  "bi.go.id",
  "bps.go.id",
  "kemendag.go.id",
  "kemenkopukm.go.id",
  "ojk.go.id",
  "kemenperin.go.id",
  "bpom.go.id",
  "kemenag.go.id",
  "setkab.go.id",
  "indonesia.go.id",
  // media bisnis
  "kontan.co.id",
  "bisnis.com",
  "cnbcindonesia.com",
  "katadata.co.id",
  "antaranews.com",
  "tempo.co",
  "kompas.com",
  "detik.com",
  "medcom.id",
  "republika.co.id",
  "investor.id",
  "hukumonline.com",
];

export const OFFICIAL_DOMAINS = new Set(WHITELIST_DOMAINS.slice(0, 12));

export function industryDef(key: string): IndustryDef | undefined {
  return INDUSTRIES.find((i) => i.key === key);
}

export function industryLabel(key: string): string {
  return industryDef(key)?.label ?? "Usaha Umum";
}

export interface IndustryInput {
  name: string;
  category?: string;
  revenue?: number;
  qty?: number;
}

export interface IndustryMatch {
  key: string;
  label: string;
  weight: number;
  matched: string[];
}

const norm = (s: string) => ` ${s.toLowerCase().replace(/\s+/g, " ").trim()} `;

/** pencocokan kata kunci yang aman (kata pendek pakai batas kata) */
function hasKeyword(text: string, kw: string): boolean {
  const k = kw.toLowerCase();
  if (k.length <= 3) return new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text);
  return text.includes(k);
}

/**
 * Cocokkan katalog/omzet ke industri. Deterministik & multi-label:
 * bobot = campuran porsi omzet (bila ada) + porsi jumlah item.
 */
export function matchIndustries(items: IndustryInput[]): IndustryMatch[] {
  if (!items.length) return [{ key: "jasa_umum", label: industryLabel("jasa_umum"), weight: 1, matched: [] }];
  const totalRevenue = items.reduce((a, i) => a + Math.max(0, i.revenue ?? 0), 0);
  const totalCount = items.length;
  const out: IndustryMatch[] = [];
  for (const def of INDUSTRIES) {
    if (!def.keywords.length) continue;
    let revenue = 0;
    let count = 0;
    const matched = new Set<string>();
    for (const it of items) {
      const text = norm(`${it.name} ${it.category ?? ""}`);
      const hit = def.keywords.find((kw) => hasKeyword(text, kw));
      if (!hit) continue;
      count += 1;
      revenue += Math.max(0, it.revenue ?? 0);
      matched.add(hit);
    }
    if (!count) continue;
    const countShare = count / totalCount;
    const revShare = totalRevenue > 0 ? revenue / totalRevenue : 0;
    const weight = totalRevenue > 0 ? Math.round((revShare * 0.7 + countShare * 0.3) * 1000) / 1000 : countShare;
    if (weight >= 0.1) {
      out.push({ key: def.key, label: def.label, weight, matched: [...matched].slice(0, 8) });
    }
  }
  out.sort((a, b) => b.weight - a.weight);
  const top = out.slice(0, 3);
  if (top.length) return top;
  // tidak ada yang cocok tapi ada barang → retail umum (fakta: menjual barang)
  return [{ key: "retail_umum", label: industryLabel("retail_umum"), weight: 1, matched: [] }];
}
