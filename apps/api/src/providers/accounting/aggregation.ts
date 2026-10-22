import type { ToolSpec, ProviderCtx } from "./types.js";

/**
 * Tool AGREGASI — satu tool yang di-expose ke LLM, tapi di dalamnya memanggil
 * beberapa endpoint Accurate secara berurutan (search → list → detail) dan
 * mengembalikan hasil FINAL sekali. Tujuannya memangkas jumlah putaran LLM:
 * alih-alih model memanggil customer.list → salesInvoice.list → detail (3 putaran,
 * ~45-60 dtk), cukup SATU tool (~1 putaran). Hit API Accurate sendiri cepat (<1 dtk),
 * jadi batas total pencarian harus < 20 dtk.
 *
 * Tool agregasi TIDAK masuk ACCURATE_CATALOG (yang dikunci 366 oleh test) —
 * mereka digabung di capabilityCatalog() dan ditangani khusus di execute().
 */

export interface AggToolSpec extends ToolSpec {
  /** modul yang butuh izin utk menjalankan agregasi ini (semua harus dimiliki) */
  requires: string[];
}

/** nama tool agregasi → deskripsi & skema utk LLM */
export const AGGREGATION_TOOLS: AggToolSpec[] = [
  {
    name: "customer.lastOrderByName",
    description:
      "Pesanan/faktur penjualan TERAKHIR dari pelanggan berdasarkan NAMA — tidak perlu tahu ID. " +
      "Langsung pakai tool ini bila user menyebut nama pelanggan & ingin transaksi terakhirnya (mis. \"pesanan terakhir Abadi Jaya\"). " +
      "Mengembalikan data pelanggan LENGKAP (customerNo, nama, email, telepon, saldo) + faktur terakhir — TIDAK perlu memanggil customer.list lagi. " +
      "Argumen: name = nama pelanggan (boleh sebagian, mis. \"Abadi\").",
    jsonSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Nama pelanggan (boleh sebagian, mis. 'Abadi')" } },
      required: ["name"],
    },
    requiredPermission: "accurate:customer.view",
    requires: ["accurate:customer.view", "accurate:sales-invoice.view"],
    label: "Mencari pesanan terakhir pelanggan…",
  },
  {
    name: "customer.unpaidByName",
    description:
      "Total piutang BELUM DIBAYAR (unpaid) dari pelanggan berdasarkan NAMA — tidak perlu tahu ID. " +
      "Langsung pakai tool ini bila user menyebut nama pelanggan & ingin sisa piutangnya. " +
      "Mengembalikan data pelanggan LENGKAP + daftar faktur belum lunas — TIDAK perlu customer.list lagi. " +
      "Argumen: name = nama pelanggan (boleh sebagian).",
    jsonSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Nama pelanggan (boleh sebagian, mis. 'Abadi')" } },
      required: ["name"],
    },
    requiredPermission: "accurate:customer.view",
    requires: ["accurate:customer.view", "accurate:sales-invoice.view"],
    label: "Menghitung piutang pelanggan…",
  },
  {
    name: "customer.summaryByName",
    description:
      "Ringkasan pelanggan berdasarkan NAMA: data pelanggan lengkap (customerNo, nama, email, telepon, saldo), jumlah & total faktur penjualan, piutang, serta pesanan terakhir — dalam SATU tool. " +
      "Gunakan bila user menanyakan kondisi/riwayat pelanggan secara umum. Cukup tool ini — JANGAN tambah customer.list. " +
      "Argumen: name = nama pelanggan (boleh sebagian).",
    jsonSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Nama pelanggan (boleh sebagian, mis. 'Abadi')" } },
      required: ["name"],
    },
    requiredPermission: "accurate:customer.view",
    requires: ["accurate:customer.view", "accurate:sales-invoice.view"],
    label: "Menyusun ringkasan pelanggan…",
  },
  {
    name: "customer.salesByName",
    description:
      "SEMUA faktur penjualan dari SATU pelanggan berdasarkan NAMA + periode opsional — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"tampilkan semua pembelian/faktur/penjualan dari <nama> di tahun X\" / \"rincian belanja Abadi Jaya\" — " +
      "JANGAN customer.list dulu lalu salesInvoice.list manual (boros putaran LLM). " +
      "Mengembalikan data pelanggan + daftar faktur (nomor, tanggal, total) + jumlah & total. " +
      "Argumen: name = nama pelanggan (boleh sebagian); fromDate & toDate (dd/mm/yyyy) OPSIONAL — kosongkan keduanya utk SELURUH periode (\"selama ini\"). " +
      "Bila hasilnya \"tidak ditemukan\", kemungkinan nama tsb adalah PEMASOK — langsung coba vendor.purchasesByName (JANGAN ulangi customer.list dgn kata kunci lain). " +
      "Pembelian dari sisi PEMASOK pakai vendor.purchasesByName.",
    jsonSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nama pelanggan (boleh sebagian, mis. 'Abadi')" },
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, kosong = semua periode)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, kosong = semua periode)" },
      },
      required: ["name"],
    },
    requiredPermission: "accurate:customer.view",
    requires: ["accurate:customer.view", "accurate:sales-invoice.view"],
    label: "Mengambil semua faktur pelanggan…",
  },
  {
    name: "customer.itemsByName",
    description:
      "Daftar BARANG yang pernah dijual ke SATU pelanggan berdasarkan NAMA (dari baris detail faktur) + periode opsional — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"barang apa saja yang dibeli/diterima <pelanggan> / barang apa yang dijual ke X\" — " +
      "JANGAN customer.salesByName + salesInvoice.detail satu per satu (hanya daftar faktur, tanpa isinya; boros & lambat). " +
      "Tiap baris: nama barang, total qty, nilai, jumlah faktur. Pertanyaan daftar FAKTUR (nomor/tanggal) pakai customer.salesByName.",
    jsonSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nama pelanggan (boleh sebagian, mis. 'Abadi')" },
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, kosong = semua periode)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, kosong = semua periode)" },
      },
      required: ["name"],
    },
    requiredPermission: "accurate:sales-invoice.view",
    requires: ["accurate:customer.view", "accurate:sales-invoice.view"],
    label: "Mengambil barang per pelanggan…",
  },
  {
    name: "salesInvoice.summary",
    description:
      "Ringkasan penjualan per periode: total nilai, jumlah faktur, rata-rata, dan daftar ringkas — dalam SATU tool. " +
      "Argumen: fromDate & toDate (format dd/mm/yyyy). Bila kosong, default = bulan berjalan.",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, cth: 01/10/2026)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, cth: 17/10/2026)" },
      },
    },
    requiredPermission: "accurate:sales-invoice.view",
    requires: ["accurate:sales-invoice.view"],
    label: "Menyusun ringkasan penjualan…",
  },
  {
    name: "purchaseInvoice.summary",
    description:
      "Ringkasan pembelian per periode: total nilai, jumlah faktur, rata-rata, dan daftar ringkas — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"total pembelian bulan ini\" — JANGAN pakai purchaseInvoice.list + jumlahkan sendiri. " +
      "Argumen: fromDate & toDate (format dd/mm/yyyy). Bila kosong, default = bulan berjalan.",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, cth: 01/10/2026)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, cth: 17/10/2026)" },
      },
    },
    requiredPermission: "accurate:purchase-invoice.view",
    requires: ["accurate:purchase-invoice.view"],
    label: "Menyusun ringkasan pembelian…",
  },
  {
    name: "invoice.biggestBoth",
    description:
      "Faktur penjualan TERBESAR dan faktur pembelian TERBESAR (sepanjang masa) dalam SATU tool — " +
      "seluruh halaman diurutkan menurun menurut totalAmount, kembalikan nomor + nilai + nama pelanggan/pemasok di kedua sisi. " +
      "Utk \"faktur penjualan terbesar dan faktur pembelian terbesar — sebutkan nomor dan nilainya\" — " +
      "JANGAN salesInvoice.summary + purchaseInvoice.summary terpisah (default-nya bulan berjalan → salah) dan JANGAN urut manual di model (pernah salah urut).",
    jsonSchema: { type: "object", properties: {} },
    requiredPermission: "accurate:sales-invoice.view",
    requires: ["accurate:sales-invoice.view", "accurate:purchase-invoice.view"],
    label: "Mencari faktur terbesar kedua sisi…",
  },
  {
    name: "vendor.lastPurchaseByName",
    description:
      "Faktur pembelian TERAKHIR dari pemasok berdasarkan NAMA — tidak perlu tahu ID. " +
      "Langsung pakai tool ini bila user menyebut nama pemasok/vendor & ingin transaksi terakhirnya. " +
      "Mengembalikan data pemasok LENGKAP (vendorNo, nama, email, telepon, saldo) + faktur terakhir — TIDAK perlu vendor.list lagi. " +
      "Argumen: name = nama pemasok (boleh sebagian, mis. \"CV Sentosa\").",
    jsonSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Nama pemasok (boleh sebagian, mis. 'CV Sentosa')" } },
      required: ["name"],
    },
    requiredPermission: "accurate:vendor.view",
    requires: ["accurate:vendor.view", "accurate:purchase-invoice.view"],
    label: "Mencari pembelian terakhir pemasok…",
  },
  {
    name: "vendor.purchasesByName",
    description:
      "SEMUA faktur pembelian dari SATU pemasok berdasarkan NAMA + periode opsional — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"tampilkan semua pembelian dari <pemasok> di tahun X\" / \"rincikan pembelian CV Sentosa\" — " +
      "JANGAN vendor.list dulu lalu purchaseInvoice.list manual (boros putaran LLM). " +
      "Mengembalikan data pemasok + daftar faktur (nomor, tanggal, total) + jumlah & total. " +
      "Argumen: name = nama pemasok (boleh sebagian); fromDate & toDate (dd/mm/yyyy) OPSIONAL — kosongkan keduanya utk SELURUH periode (\"selama ini\"). " +
      "Bila hasilnya \"tidak ditemukan\", kemungkinan nama tsb adalah PELANGGAN — langsung coba customer.salesByName (JANGAN ulangi vendor.list dgn kata kunci lain). " +
      "Pembelian dari sisi PELANGGAN (siapa yang beli) pakai customer.salesByName.",
    jsonSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nama pemasok (boleh sebagian, mis. 'CV Sentosa')" },
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, kosong = semua periode)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, kosong = semua periode)" },
      },
      required: ["name"],
    },
    requiredPermission: "accurate:vendor.view",
    requires: ["accurate:vendor.view", "accurate:purchase-invoice.view"],
    label: "Mengambil semua faktur pemasok…",
  },
  {
    name: "vendor.itemsByName",
    description:
      "Daftar BARANG yang pernah dibeli dari SATU pemasok berdasarkan NAMA (dari baris detail faktur) + periode opsional — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"barang apa saja yang dibeli/di-suplai dari <pemasok> / pemasok X menjual apa saja ke kita\" — " +
      "JANGAN vendor.purchasesByName + purchaseInvoice.detail satu per satu (hanya daftar faktur, tanpa isinya; boros & lambat). " +
      "Tiap baris: nama barang, total qty, nilai, jumlah faktur. Pertanyaan daftar FAKTUR (nomor/tanggal) pakai vendor.purchasesByName.",
    jsonSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nama pemasok (boleh sebagian, mis. 'Mega Mendung')" },
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, kosong = semua periode)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, kosong = semua periode)" },
      },
      required: ["name"],
    },
    requiredPermission: "accurate:purchase-invoice.view",
    requires: ["accurate:vendor.view", "accurate:purchase-invoice.view"],
    label: "Mengambil barang per pemasok…",
  },
  {
    name: "vendor.unpaidByName",
    description:
      "Total utang BELUM DIBAYAR (unpaid) dari pemasok berdasarkan NAMA — tidak perlu tahu ID. " +
      "Langsung pakai tool ini bila user menyebut nama pemasok & ingin sisa utangnya (\"utang belum dibayar vendor X\"). " +
      "Mengembalikan data pemasok LENGKAP + daftar faktur belum lunas — TIDAK perlu vendor.list lagi. " +
      "Argumen: name = nama pemasok (boleh sebagian).",
    jsonSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Nama pemasok (boleh sebagian)" } },
      required: ["name"],
    },
    requiredPermission: "accurate:vendor.view",
    requires: ["accurate:vendor.view", "accurate:purchase-invoice.view"],
    label: "Menghitung utang pemasok…",
  },
  {
    name: "vendor.summaryByName",
    description:
      "Ringkasan pemasok berdasarkan NAMA: data pemasok lengkap (vendorNo, nama, email, telepon, saldo), jumlah & total faktur pembelian, utang belum lunas, serta pembelian terakhir — dalam SATU tool. " +
      "Gunakan bila user menanyakan kondisi/riwayat pemasok secara umum. Cukup tool ini — JANGAN tambah vendor.list. " +
      "Argumen: name = nama pemasok (boleh sebagian).",
    jsonSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Nama pemasok (boleh sebagian)" } },
      required: ["name"],
    },
    requiredPermission: "accurate:vendor.view",
    requires: ["accurate:vendor.view", "accurate:purchase-invoice.view"],
    label: "Menyusun ringkasan pemasok…",
  },
  {
    name: "salesInvoice.perCustomer",
    description:
      "Penjualan dikelompokkan per PELANGGAN: nama+kode pelanggan, jumlah faktur, total nilai — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"siapa yang paling banyak membeli / belanja terbanyak / pembelian terbanyak\" (dari sisi PELANGGAN) " +
      "atau \"rincikan penjualan per pelanggan\" — JANGAN tarik semua halaman salesInvoice.list. " +
      "Argumen: fromDate & toDate (dd/mm/yyyy) OPSIONAL — kosongkan keduanya utk SELURUH periode (\"selama ini\"). " +
      "Argumen limit OPSIONAL — bila diisi, hanya N pelanggan teratas (urut total menurun) yang dikembalikan (contoh: \"cari 3 pelanggan\" → limit 3). " +
      "Untuk pengelompokan pembelian dari sisi PEMASOK pakai purchaseInvoice.perVendor.",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, kosong = semua periode)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, kosong = semua periode)" },
        limit: { type: "integer", description: "Tampilkan hanya N pelanggan teratas (kosong = semua, maks 20)" },
      },
    },
    requiredPermission: "accurate:sales-invoice.view",
    requires: ["accurate:sales-invoice.view"],
    label: "Mengelompokkan penjualan per pelanggan…",
  },
  {
    name: "purchaseInvoice.perVendor",
    description:
      "Pembelian dikelompokkan per PEMASOK: nama+kode pemasok, jumlah faktur, total nilai — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"pemasok mana yang paling banyak menjual ke kita / pembelian terbanyak per pemasok\" — " +
      "JANGAN tarik semua halaman purchaseInvoice.list + hitung manual. " +
      "Argumen: fromDate & toDate (dd/mm/yyyy) OPSIONAL — kosongkan keduanya utk SELURUH periode (\"selama ini\"). " +
      "Argumen limit OPSIONAL — bila diisi, hanya N pemasok teratas (urut total menurun) yang dikembalikan (contoh: \"cari 3 pemasok\" → limit 3). " +
      "Untuk pembelian dari sisi PELANGGAN (siapa yang beli) pakai salesInvoice.perCustomer.",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, kosong = semua periode)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, kosong = semua periode)" },
        limit: { type: "integer", description: "Tampilkan hanya N pemasok teratas (kosong = semua, maks 20)" },
      },
    },
    requiredPermission: "accurate:purchase-invoice.view",
    requires: ["accurate:purchase-invoice.view"],
    label: "Mengelompokkan pembelian per pemasok…",
  },
  {
    name: "item.topSelling",
    description:
      "Barang PALING LARIS pada satu periode (diurutkan dari jumlah terjual) — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"barang apa yang paling laris / terlaris bulan ini\" — JANGAN pakai item.list / salesInvoice.list + detail satu per satu. " +
      "Tiap baris: qty terjual, nilai total, dan avgUnitPrice (harga rata-rata terjual) → cukup utk \"barang mana yang paling besar nilainya\". " +
      "Harga jual terkini / stok SATU barang pakai item.byName. " +
      "Argumen: fromDate & toDate (dd/mm/yyyy, default bulan berjalan), limit (jumlah baris, default 10).",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, cth: 01/10/2026)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, cth: 17/10/2026)" },
        limit: { type: "number", description: "Jumlah barang teratas (default 10)" },
      },
    },
    requiredPermission: "accurate:sales-invoice.view",
    requires: ["accurate:sales-invoice.view"],
    label: "Menghitung barang terlaris…",
  },
  {
    name: "item.byName",
    description:
      "Info SATU barang berdasarkan NAMA: kode, harga jual terkini, stok, kuantitas terdaftar — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"berapa harga Kertas A4 / stok X / cari barang X\" — " +
      "JANGAN item.list berkali-kali lalu item.get-selling-price & item.get-stock satu per satu (boros putaran LLM). " +
      "Barang terlaris per periode pakai item.topSelling.",
    jsonSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Nama/kode barang (boleh sebagian, mis. 'Kertas A4')" } },
      required: ["name"],
    },
    requiredPermission: "accurate:item.view",
    requires: ["accurate:item.view"],
    label: "Mencari data barang…",
  },
  {
    name: "item.buyers",
    description:
      "Siapa saja PELANGGAN yang pernah membeli SATU barang tertentu (berdasarkan nama), beserta jumlah unit & nilai per pelanggan — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"siapa pembeli barang X / siapa yang beli Hard Case / pelanggan pembeli Samsung S7\" — " +
      "JANGAN item.topSelling + salesInvoice.list + detail satu per satu (boros putaran & lambat). " +
      "Cocok utk pertanyaan relasi barang↔pelanggan. Periode opsional (default semua periode).",
    jsonSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nama/kode barang (boleh sebagian, mis. 'Hard Case')" },
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy) — opsional" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy) — opsional" },
      },
      required: ["name"],
    },
    requiredPermission: "accurate:sales-invoice.view",
    requires: ["accurate:sales-invoice.view"],
    label: "Mencari pembeli barang…",
  },
  {
    name: "item.suppliers",
    description:
      "Siapa saja PEMASOK/supplier/suplier yang pernah mensupply SATU barang tertentu (berdasarkan nama barang), " +
      "beserta jumlah unit & nilai per pemasok — dalam SATU tool (kebalikan dari item.buyers). " +
      "Langsung pakai tool ini utk \"pemasok mana yang memasok barang X / suplier Oppo / siapa pemasok Samsung S7 / " +
      "total pembelian barang X dari semua pemasok\" — JANGAN vendor.purchasesByName + detail satu per satu. " +
      "Sinonim: suplier = supplier = pemasok = vendor. Periode opsional (default semua periode).",
    jsonSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nama/kode BARANG (boleh sebagian, mis. 'Oppo')" },
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy) — opsional" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy) — opsional" },
      },
      required: ["name"],
    },
    requiredPermission: "accurate:purchase-invoice.view",
    requires: ["accurate:purchase-invoice.view"],
    label: "Mencari pemasok barang…",
  },
  {
    name: "item.invoices",
    description:
      "Daftar FAKTUR yang MEMUAT/MENGANDUNG SATU barang tertentu — penjualan (default) ATAU pembelian — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"faktur penjualan apa saja yang memuat barang X / faktur pembelian mana dari pemasok Y yang isinya barang X\" — " +
      "JANGAN item.byName + salesInvoice.list/purchaseInvoice.list manual (gagal menyaring per-baris). " +
      "Setiap baris: nomor faktur, tanggal, pelanggan/pemasok, total faktur, qty & nilai barang tsb di faktur tsb. " +
      "Argumen: name = nama barang; type = \"sale\" (faktur jual, default) atau \"purchase\" (faktur beli); " +
      "entity = nama pelanggan/pemasok OPSIONAL utk mempersempit; fromDate/toDate opsional.",
    jsonSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nama/kode barang (boleh sebagian, mis. 'Iphone 6 S 128 GB')" },
        type: { type: "string", enum: ["sale", "purchase"], description: "sale = faktur penjualan (default), purchase = faktur pembelian" },
        entity: { type: "string", description: "Nama pelanggan (type=sale) / pemasok (type=purchase) — opsional" },
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy) — opsional" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy) — opsional" },
      },
      required: ["name"],
    },
    requiredPermission: "accurate:sales-invoice.view",
    requires: ["accurate:customer.view", "accurate:sales-invoice.view", "accurate:purchase-invoice.view"],
    label: "Mencari faktur per barang…",
  },
  {
    name: "receivables.summary",
    description:
      "Piutang usaha GLOBAL (seluruh pelanggan): total piutang belum dibayar, jumlah faktur, " +
      "serta daftar pelanggan terbesar beserta tagihannya — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"berapa total piutang perusahaan\" / \"siapa yang paling banyak berutang\". " +
      "Untuk piutang SATU pelanggan pakai customer.unpaidByName; untuk daftar semua pelanggan pakai receivables.summary ini. " +
      "Bila user menanya piutang \"tahun/bulan X\" (periode faktur), isi fromDate & toDate — hasil hanya faktur periode itu yg belum dibayar. " +
      "Argumen: limit (jumlah pelanggan teratas, default 10), fromDate & toDate opsional (dd/mm/yyyy, kosong = semua periode).",
    jsonSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Jumlah pelanggan teratas (default 10)" },
        fromDate: { type: "string", description: "Tanggal mulai faktur (dd/mm/yyyy, kosong = semua)" },
        toDate: { type: "string", description: "Tanggal akhir faktur (dd/mm/yyyy, kosong = semua)" },
      },
    },
    requiredPermission: "accurate:sales-invoice.view",
    requires: ["accurate:sales-invoice.view", "accurate:customer.view"],
    label: "Menghitung total piutang usaha…",
  },
  {
    name: "payables.summary",
    description:
      "Utang usaha GLOBAL (seluruh pemasok): total utang belum dibayar, jumlah faktur pembelian, " +
      "serta daftar pemasok terbesar beserta tagihannya — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"berapa total utang perusahaan\" / \"utang ke pemasok mana terbesar\". " +
      "Untuk utang SATU pemasok pakai vendor.unpaidByName. " +
      "Bila user menanya utang \"tahun/bulan X\" (periode faktur), isi fromDate & toDate — hasil hanya faktur periode itu yg belum dibayar. " +
      "Argumen: limit (jumlah pemasok teratas, default 10), fromDate & toDate opsional (dd/mm/yyyy, kosong = semua periode).",
    jsonSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Jumlah pemasok teratas (default 10)" },
        fromDate: { type: "string", description: "Tanggal mulai faktur (dd/mm/yyyy, kosong = semua)" },
        toDate: { type: "string", description: "Tanggal akhir faktur (dd/mm/yyyy, kosong = semua)" },
      },
    },
    requiredPermission: "accurate:purchase-invoice.view",
    requires: ["accurate:purchase-invoice.view", "accurate:vendor.view"],
    label: "Menghitung total utang usaha…",
  },
  {
    name: "gl.plSummary",
    description:
      "Ringkasan laba/rugi (P&L) satu periode dalam SATU panggilan: pendapatan, harga pokok penjualan, " +
      "laba kotor, beban operasional, pendapatan & beban lainnya, serta laba bersih — " +
      "langsung dihitung dari seluruh akun P&L di buku besar. " +
      "Langsung pakai tool ini utk \"berapa laba/rugi bulan ini\" — JANGAN panggil glaccount.get-pl-account-amount lagi. " +
      "Argumen: fromDate & toDate (dd/mm/yyyy). Bila kosong, default = bulan berjalan.",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, cth: 01/10/2026)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, cth: 31/10/2026)" },
      },
    },
    requiredPermission: "accurate:glaccount.view",
    requires: ["accurate:glaccount.view"],
    label: "Menghitung laba rugi…",
  },
  {
    name: "gl.bsSummary",
    description:
      "Ringkasan posisi keuangan (neraca/balance sheet) per tanggal dalam SATU panggilan: " +
      "total aset, total kewajiban, modal, rincian per jenis akun, dan akun-akun terbesar di tiap bagian. " +
      "Langsung pakai tool ini utk \"posisi keuangan per 31/12/2017\" / \"berapa aset dan hutang\" — " +
      "JANGAN panggil glaccount.get-bs-account-amount (mentah, 38KB) lagi setelahnya. " +
      "Argumen: asOfDate (dd/mm/yyyy, default hari ini).",
    jsonSchema: {
      type: "object",
      properties: {
        asOfDate: { type: "string", description: "Tanggal posisi (dd/mm/yyyy, cth: 31/12/2017; default hari ini)" },
      },
    },
    requiredPermission: "accurate:glaccount.view",
    requires: ["accurate:glaccount.view"],
    label: "Menyusun posisi keuangan…",
  },
  {
    name: "finance.overview",
    description:
      "Laporan keuangan satu periode SEKALI jalan: laba rugi, posisi keuangan (aset/utang/modal per akhir periode), " +
      "serta total penjualan & pembelian periode itu — dalam SATU tool. " +
      "Langsung pakai tool ini utk \"tampilkan laporan keuangan bulan X / laporan keuangan lengkap\" — " +
      "JANGAN gl.plSummary + gl.bsSummary + salesInvoice.summary satu per satu (3 putaran LLM). " +
      "Hanya laba rugi → gl.plSummary; hanya aset/utang → gl.bsSummary. " +
      "Arus kas (kas masuk vs keluar) → cashflow.summary.",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, default bulan berjalan)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, default akhir periode)" },
      },
    },
    requiredPermission: "accurate:glaccount.view",
    requires: ["accurate:glaccount.view", "accurate:sales-invoice.view", "accurate:purchase-invoice.view"],
    label: "Menyusun laporan keuangan…",
  },
  {
    name: "cashflow.summary",
    description:
      "Arus kas satu periode dalam SATU tool: kas masuk (penerimaan penjualan) vs kas keluar " +
      "(pembayaran pembelian, biaya/expense, pengeluaran lain) — total, rincian per sumber, dan entri terbesar. " +
      "Langsung pakai tool ini utk \"arus kas bulan ini / kas masuk dan keluar / uang keluar kemana saja\" — " +
      "JANGAN bankTransfer.list + salesReceipt.list + expense.list manual (transfer antar rekening sendiri TIDAK dihitung). " +
      "Argumen: fromDate & toDate (dd/mm/yyyy, default bulan berjalan).",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, default bulan berjalan)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, default akhir periode)" },
      },
    },
    requiredPermission: "accurate:sales-receipt.view",
    requires: ["accurate:sales-receipt.view", "accurate:purchase-payment.view", "accurate:expense.view"],
    label: "Menghitung arus kas…",
  },
  {
    name: "journalVoucher.summary",
    description:
      "Ringkasan jurnal umum: JUMLAH transaksi + TOTAL nilai (penjumlahan OTOMATIS — JANGAN menjumlah manual dari journalVoucher.list, angka besar mudah meleset). " +
      "Tanpa argumen = seluruh masa. Isi fromDate & toDate (dd/mm/yyyy) utk periode tertentu, mis. tahun 2016 → 01/01/2016 & 31/12/2016.",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, cth: 01/01/2016)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, cth: 31/12/2016)" },
      },
    },
    requiredPermission: "accurate:journal-voucher.view",
    requires: ["accurate:journal-voucher.view"],
    label: "Menyusun ringkasan jurnal umum…",
  },
  {
    name: "salesReturn.summary",
    description:
      "Ringkasan retur penjualan: JUMLAH transaksi + TOTAL nilai (penjumlahan OTOMATIS — utk \"berapa total nilai retur penjualan\"; JANGAN jumlahkan salesReturn.list manual). " +
      "Tanpa argumen = seluruh masa; isi fromDate & toDate (dd/mm/yyyy) utk periode tertentu.",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, cth: 01/01/2017)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, cth: 31/12/2017)" },
      },
    },
    requiredPermission: "accurate:sales-return.view",
    requires: ["accurate:sales-return.view"],
    label: "Menghitung retur penjualan…",
  },
  {
    name: "purchaseReturn.summary",
    description:
      "Ringkasan retur pembelian: JUMLAH transaksi + TOTAL nilai (penjumlahan OTOMATIS — utk \"berapa total nilai retur pembelian\"; JANGAN jumlahkan purchaseReturn.list manual). " +
      "Tanpa argumen = seluruh masa; isi fromDate & toDate (dd/mm/yyyy) utk periode tertentu.",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy, cth: 01/01/2017)" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy, cth: 31/12/2017)" },
      },
    },
    requiredPermission: "accurate:purchase-return.view",
    requires: ["accurate:purchase-return.view"],
    label: "Menghitung retur pembelian…",
  },
  {
    name: "salesInvoice.summaryMulti",
    description:
      "Perbandingan penjualan DUA periode dalam SATU panggilan: total, jumlah faktur, rata-rata per faktur, " +
      "JUMLAH PELANGGAN AKTIF dan JUMLAH FAKTUR LUNAS untuk masing-masing periode, plus gabungan dan selisihnya — semua sudah DIHITUNG (bukan perkiraan). " +
      "Langsung pakai utk \"total penjualan bulan A dan bulan B\", \"selisih bulan A dengan bulan B\", " +
      "\"berapa faktur bulan A berbanding bulan B\", \"rata-rata penjualan tahun X dan tahun Y\", " +
      "\"berapa pelanggan aktif tahun X dan tahun Y\", \"berapa faktur lunas tahun X dan tahun Y\". " +
      "Isi fromDate1/toDate1 & fromDate2/toDate2 (dd/mm/yyyy) + label1/label2 utk nama periode.",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate1: { type: "string", description: "Tanggal mulai periode 1 (dd/mm/yyyy)" },
        toDate1: { type: "string", description: "Tanggal akhir periode 1 (dd/mm/yyyy)" },
        label1: { type: "string", description: "Nama periode 1 (mis. November 2016)" },
        fromDate2: { type: "string", description: "Tanggal mulai periode 2 (dd/mm/yyyy)" },
        toDate2: { type: "string", description: "Tanggal akhir periode 2 (dd/mm/yyyy)" },
        label2: { type: "string", description: "Nama periode 2 (mis. Desember 2016)" },
      },
    },
    requiredPermission: "accurate:sales-invoice.view",
    requires: ["accurate:sales-invoice.view"],
    label: "Membandingkan dua periode penjualan…",
  },
  {
    name: "fixedAsset.summary",
    description:
      "Jumlah aset tetap yang DIBELI pada tahun tertentu (filter transDate dd/mm/yyyy — tahun = 4 digit terakhir), dihitung presisi di SEMUA halaman. " +
      "Utk \"ada berapa aset tetap yang dibeli tahun X\" — JANGAN fixedAsset.list lalu hitung manual.",
    jsonSchema: {
      type: "object",
      properties: {
        year: { type: "integer", description: "Tahun pembelian (cth: 2015)" },
      },
      required: ["year"],
    },
    requiredPermission: "accurate:fixed-asset.view",
    requires: ["accurate:fixed-asset.view"],
    label: "Menghitung aset tetap per tahun…",
  },
  {
    name: "journalVoucher.yearSummary",
    description:
      "Jumlah jurnal umum PER TAHUN — dikelompokkan berdasarkan transDate (tanggal, dd/mm/yyyy), BUKAN nomor JV " +
      "(nomor bisa beda tahun dgn tanggal). Menghasilkan tahun dengan transaksi TERBANYAK + rincian seluruh tahun. " +
      "Utk \"tahun berapa yang paling banyak memiliki jurnal umum dan berapa jumlahnya\".",
    jsonSchema: { type: "object", properties: {} },
    requiredPermission: "accurate:journal-voucher.view",
    requires: ["accurate:journal-voucher.view"],
    label: "Mengelompokkan jurnal umum per tahun…",
  },
  {
    name: "item.zeroStock",
    description:
      "Daftar LENGKAP item berkuantitas/stok 0 (SEMUA halaman, presisi) beserta jumlahnya. " +
      "Utk \"barang mana yang stoknya paling sedikit / apa saja yang stoknya 0\" — sebutkan SEMUA nama item stok nol; JANGAN item.list manual.",
    jsonSchema: { type: "object", properties: {} },
    requiredPermission: "accurate:item.view",
    requires: ["accurate:item.view"],
    label: "Menyusun daftar item stok nol…",
  },
  {
    name: "item.stockOverview",
    description:
      "Ringkasan persediaan presisi: JUMLAH JENIS barang + TOTAL seluruh stok (penjumlahan quantity SEMUA halaman) + JUMLAH GUDANG. " +
      "Utk \"ada berapa jenis barang, berapa total seluruh stok, dan berapa gudang\" — angka total stok sudah dihitung server; JANGAN jumlahkan item.list manual. " +
      "BUKAN utk \"barang mana stoknya paling banyak/terbesar\" (stockOverview tak menyebut nama barang — utk itu pakai item.list lalu urut quantity).",
    jsonSchema: { type: "object", properties: {} },
    requiredPermission: "accurate:item.view",
    requires: ["accurate:item.view"],
    label: "Menghitung total stok & gudang…",
  },
  {
    name: "autoNumber.summary",
    description:
      "Jumlah aturan penomoran otomatis (auto number) yang terdaftar — dihitung presisi dari SEMUA baris (bukan perkiraan). " +
      "Utk \"ada berapa aturan penomoran otomatis / auto number yang terdaftar\".",
    jsonSchema: { type: "object", properties: {} },
    requiredPermission: "accurate:auto-number.view",
    requires: ["accurate:auto-number.view"],
    label: "Menghitung aturan penomoran otomatis…",
  },
  {
    name: "purchaseInvoice.summaryMulti",
    description:
      "Perbandingan pembelian DUA periode dalam SATU panggilan: total, jumlah faktur, rata-rata per faktur tiap periode, " +
      "plus gabungan & selisih — semua DIHITUNG SERVER dari nilai asli (presisi; selisih pembelian sering meleset 1 rupiah " +
      "bila total mengandung desimal dan dijumlah/diurung manual). " +
      "Utk \"total pembelian tahun X dan tahun Y\", \"selisih total pembelian tahun X dengan tahun Y\". " +
      "Isi fromDate1/toDate1 & fromDate2/toDate2 (dd/mm/yyyy) + label1/label2.",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate1: { type: "string", description: "Tanggal mulai periode 1 (dd/mm/yyyy)" },
        toDate1: { type: "string", description: "Tanggal akhir periode 1 (dd/mm/yyyy)" },
        label1: { type: "string", description: "Nama periode 1 (mis. tahun 2016)" },
        fromDate2: { type: "string", description: "Tanggal mulai periode 2 (dd/mm/yyyy)" },
        toDate2: { type: "string", description: "Tanggal akhir periode 2 (dd/mm/yyyy)" },
        label2: { type: "string", description: "Nama periode 2 (mis. tahun 2017)" },
      },
    },
    requiredPermission: "accurate:purchase-invoice.view",
    requires: ["accurate:purchase-invoice.view"],
    label: "Membandingkan dua periode pembelian…",
  },
  {
    name: "arap.summary",
    description:
      "Piutang usaha + utang usaha SEKALIGUS dalam SATU panggilan: total masing-masing, jumlah faktur tiap sisi, " +
      "serta mana yang lebih besar beserta selisihnya — semua DIHITUNG dari nilai asli (presisi). " +
      "Utk \"berapa total piutang usaha dan total utang usaha\", \"mana yang lebih besar: piutang atau utang\". " +
      "Bukan utk periode tahun/bulan tertentu (itu pakai receivables.summary + payables.summary terpisah).",
    jsonSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Jumlah pelanggan/pemasok teratas tiap sisi (default 5)" },
      },
    },
    requiredPermission: "accurate:sales-invoice.view",
    requires: [
      "accurate:sales-invoice.view",
      "accurate:purchase-invoice.view",
      "accurate:customer.view",
      "accurate:vendor.view",
    ],
    label: "Menghitung piutang & utang usaha…",
  },
  {
    name: "invoice.statusCounts",
    description:
      "Jumlah faktur penjualan/pembelian LUNAS vs BELUM LUNAS (presisi dari SEMUA halaman; lunas = statusName mengandung \"lunas\" tapi bukan \"belum lunas\"). " +
      "Tanpa periode = seluruh masa; isi fromDate/toDate (dd/mm/yyyy) utk tahun/periode tertentu. " +
      "Utk \"ada berapa faktur penjualan/pembelian yang sudah lunas / belum lunas (tahun X)\" — " +
      "JANGAN .list lalu hitung manual (sering meleset 1 karena model menyebut nomor faktur perlahan).",
    jsonSchema: {
      type: "object",
      properties: {
        side: {
          type: "string",
          enum: ["sales", "purchase"],
          description: "sales = faktur penjualan, purchase = faktur pembelian",
        },
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy) — opsional" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy) — opsional" },
      },
      required: ["side"],
    },
    requiredPermission: "accurate:sales-invoice.view",
    requires: ["accurate:sales-invoice.view", "accurate:purchase-invoice.view"],
    label: "Menghitung faktur lunas vs belum lunas…",
  },
  {
    name: "party.yoySummary",
    description:
      "Perbandingan penjualan (pelanggan) ATAU pembelian (pemasok) DUA TAHUN dalam SATU panggilan: total & jumlah faktur tiap tahun, " +
      "plus arah perubahan (naik/turun/sama) dan selisihnya — semua DIHITUNG SERVER dari nilai asli (presisi). " +
      "Utk \"penjualan pelanggan X naik/turun dari tahun A ke tahun B? Sebutkan angkanya\", \"pembelian pemasok X dari tahun A ke tahun B\". " +
      "Isi party (customer|vendor), name, year1, year2.",
    jsonSchema: {
      type: "object",
      properties: {
        party: { type: "string", enum: ["customer", "vendor"], description: "customer = sisi penjualan, vendor = sisi pembelian" },
        name: { type: "string", description: "Nama pelanggan/pemasok" },
        year1: { type: "integer", description: "Tahun pertama (cth: 2016)" },
        year2: { type: "integer", description: "Tahun kedua (cth: 2017)" },
      },
      required: ["name", "year1", "year2"],
    },
    requiredPermission: "accurate:sales-invoice.view",
    requires: ["accurate:sales-invoice.view", "accurate:purchase-invoice.view"],
    label: "Membandingkan penjualan/pembelian antar tahun…",
  },
  {
    name: "return.summaryBoth",
    description:
      "Total retur penjualan DAN total retur pembelian SEKALIGUS dalam SATU panggilan (seluruh masa atau berdua berperiode sama): " +
      "jumlah dokumen + total tiap sisi + mana yang lebih besar + selisihnya, dihitung server dari nilai asli. " +
      "Utk \"berapa total retur penjualan dan total retur pembelian? Mana yang lebih besar\" — " +
      "JANGAN salesReturn.summary + purchaseReturn.summary terpisah apalagi .list + jumlah manual (pernah meleset: 192.532.600 vs 192.537.400).",
    jsonSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "Tanggal mulai (dd/mm/yyyy) — opsional" },
        toDate: { type: "string", description: "Tanggal akhir (dd/mm/yyyy) — opsional" },
      },
    },
    requiredPermission: "accurate:sales-invoice.view",
    requires: ["accurate:sales-invoice.view", "accurate:purchase-invoice.view"],
    label: "Menjumlahkan retur penjualan & pembelian…",
  },
  {
    name: "salesReceipt.yearCount",
    description:
      "Jumlah bukti penerimaan penjualan (sales receipt) pada TAHUN tertentu — dihitung dari kolom transDate (dd/mm/yyyy), " +
      "BUKAN tahun yang muncul di nomor dokumen (nomor bisa beda tahun dgn tanggal). SEMUA halaman, presisi. " +
      "Utk \"ada berapa bukti penerimaan penjualan tahun X\" — JANGAN salesReceipt.list lalu hitung manual (pernah meleset: 6 vs data 7).",
    jsonSchema: {
      type: "object",
      properties: {
        year: { type: "integer", description: "Tahun transDate (cth: 2016)" },
      },
      required: ["year"],
    },
    requiredPermission: "accurate:sales-receipt.view",
    requires: ["accurate:sales-receipt.view"],
    label: "Menghitung bukti penerimaan penjualan per tahun…",
  },
  {
    name: "deliveryOrder.yearCount",
    description:
      "Jumlah surat jalan (delivery order) pada TAHUN tertentu — dihitung dari kolom transDate (dd/mm/yyyy), " +
      "SEMUA halaman, presisi. Utk \"ada berapa surat jalan tahun X\" — JANGAN deliveryOrder.list lalu hitung manual (pernah meleset: model menyebut 6 dokumen tapi menomori 5).",
    jsonSchema: {
      type: "object",
      properties: {
        year: { type: "integer", description: "Tahun transDate (cth: 2016)" },
      },
      required: ["year"],
    },
    requiredPermission: "accurate:delivery-order.view",
    requires: ["accurate:delivery-order.view"],
    label: "Menghitung surat jalan per tahun…",
  },
  {
    name: "item.topStock",
    description:
      "Daftar barang dengan stok TERBANYAK (quantity) — SEMUA halaman item.list diurutkan menurun oleh quantity, presisi. " +
      "Utk \"barang mana stoknya paling banyak\", \"apa saja tiga barang dengan stok terbanyak\" — " +
      "JANGAN item.stockOverview (itu hanya jumlah jenis/unit/gudang, TIDAK menyebut nama barang) dan JANGAN item.list manual.",
    jsonSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Jumlah barang teratas (default 10)" },
      },
    },
    requiredPermission: "accurate:item.view",
    requires: ["accurate:item.view"],
    label: "Mengurutkan barang stok terbanyak…",
  },
];

export const AGGREGATION_NAMES = new Set(AGGREGATION_TOOLS.map((t) => t.name));

/** helper: ekstrak array dari hasil execute (d atau {items}) */
function asArray(v: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.items)) return o.items as Array<Record<string, unknown>>;
    if (Array.isArray(o.d)) return o.d as Array<Record<string, unknown>>;
  }
  return [];
}

/** helper: meta paginasi dari envelope .list ({items, page, pageSize, total, pageCount}) */
function metaOf(v: unknown): { total: number; pageCount: number } {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o.total === "number" || typeof o.pageCount === "number") {
      return { total: Number(o.total ?? 0), pageCount: Number(o.pageCount ?? 0) };
    }
  }
  const rows = asArray(v);
  return { total: rows.length, pageCount: rows.length ? 1 : 0 };
}

/** helper: petakan tipe akun neraca ke bagian (aset / kewajiban / modal / lainnya) */
const BS_ASSET_TYPES = new Set([
  "CASH_BANK", "ACCOUNT_RECEIVABLE", "INVENTORY", "FIXED_ASSET",
  "OTHER_CURRENT_ASSET", "OTHER_ASSET", "ACCUMULATED_DEPRECIATION",
]);
const BS_LIABILITY_TYPES = new Set([
  "ACCOUNT_PAYABLE", "SHORT_TERM_LIABILITY", "LONG_TERM_LIABILITY",
  "OTHER_CURRENT_LIABILITY", "OTHER_LIABILITY", "UNEARNED_REVENUE",
]);
const BS_EQUITY_TYPES = new Set(["EQUITY", "RETAINED_EARNINGS", "OWNER_EQUITY"]);
function bsSection(type: string): "aset" | "kewajiban" | "modal" | "lainnya" {
  if (BS_ASSET_TYPES.has(type)) return "aset";
  if (BS_LIABILITY_TYPES.has(type)) return "kewajiban";
  if (BS_EQUITY_TYPES.has(type)) return "modal";
  if (/ASSET|CASH|BANK|INVENTORY|RECEIVABLE|PREPAID|DEPOSIT|ACCUMULATED/.test(type)) return "aset";
  if (/LIAB|PAYABLE|UNearned|UNEARNED|DEBT/.test(type)) return "kewajiban";
  if (/EQUITY|CAPITAL|RETAINED|RESERVE/.test(type)) return "modal";
  return "lainnya";
}

/**
 * Tarik SEMUA halaman satu list (pageSize 1000, maks 5 halaman = 5000 baris) —
 * agregasi dulu hanya baca page pertama (pageSize≤100) → total bisa salah hitung
 * diam-diam di data besar. Meta total dari server ikut dikembalikan utk
 * deteksi pemotongan: truncated=true bila baris yg diambil < total di server.
 */
async function listAllPages(
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  tool: string,
  args: Record<string, unknown>
): Promise<{ rows: Array<Record<string, unknown>>; total: number; pageCount: number; truncated: boolean }> {
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 10;
  const first = await execute(tool, { ...args, pageSize: PAGE_SIZE, page: 1 });
  const rows = asArray(first);
  const { total, pageCount } = metaOf(first);
  const pages = Math.min(MAX_PAGES, Math.max(pageCount, 1));
  for (let page = 2; page <= pages; page++) {
    const next = asArray(await execute(tool, { ...args, pageSize: PAGE_SIZE, page }));
    if (!next.length) break;
    rows.push(...next);
  }
  return { rows, total, pageCount, truncated: rows.length < total };
}

/** cari pelanggan by nama → kembalikan baris pelanggan pertama yg cocok (atau null) */
async function findCustomer(
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  name: string
): Promise<Record<string, unknown> | null> {
  const rows = asArray(await execute("customer.list", { keywords: name, pageSize: 10 }));
  const q = normName(name);
  const hit =
    rows.find((r) => normName(r.name).includes(q) || normName(r.customerNo) === q) ??
    rows.find((r) => q.split(" ").filter(Boolean).every((t) => normName(r.name).includes(t))) ??
    (rows.length === 1 ? rows[0] : null);
  return hit ?? null;
}

/**
 * Baris entitas LENGKAP utk output agregasi (tanpa id internal: customerNo/vendorNo,
 * nama, email, telepon, saldo) — model yang membandingkan dengan output .list
 * tidak akan merasa kekurangan data → tak memanggil .list lagi (hemat putaran).
 */
function publicInfo(row: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, ...rest } = row;
  return rest;
}

/** ambil faktur penjualan pelanggan (customerNo) — SEMUA halaman; opts.limit = cukup N teratas */
async function customerInvoices(
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  customerNo: string,
  opts: { limit?: number; period?: { from: string; to: string } } = {}
): Promise<{ rows: Array<Record<string, unknown>>; total: number; truncated: boolean }> {
  // catatan (diverifikasi ke API asli): filter pakai VALUE LANGSUNG filter.customerNo=CSBY-0005.
  // Bentuk objek {customerNo:{op,value}} DITOLAK ("Pelanggan tidak tepat"), argumen top-level
  // customerNo="…" diabaikan (tidak memfilter) → baris pelanggan lain bisa bocor.
  const base = {
    filter: {
      customerNo,
      ...(opts.period ? { transDate: { op: "BETWEEN", value: [opts.period.from, opts.period.to] } } : {}),
    },
    sort: "id|desc",
  };
  const fetched =
    opts.limit !== undefined
      ? await (async () => {
          const res = await execute("salesInvoice.list", { ...base, pageSize: opts.limit, page: 1 });
          const rows = asArray(res);
          const meta = metaOf(res);
          return { rows, total: meta.total || rows.length, truncated: false };
        })()
      : await listAllPages(execute, "salesInvoice.list", base);
  // scoping defensif by customerNo (API asli sudah memfilter; bila mock mengabaikan filter,
  // saring manual — dan 0 cocok berarti memang tak ada faktur, JANGAN kembalikan baris mentah)
  const cno = String(customerNo);
  const rows = fetched.rows.filter(
    (r) => String(r.customerNo ?? "") === cno || String((r.customer as Record<string, unknown>)?.customerNo ?? "") === cno
  );
  return { rows, total: fetched.total, truncated: fetched.truncated };
}

/** faktur BELUM LUNAS — filter.outstanding=true di server (approvalStatus ≠ lunas), semua halaman */
async function customerUnpaidInvoices(
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  customerNo: string
): Promise<{ rows: Array<Record<string, unknown>>; total: number; truncated: boolean }> {
  // diverifikasi ke API asli: filter.customerNo + filter.outstanding=true (value langsung)
  // mengembalikan hanya faktur belum lunas — padahal approvalStatus semuanya APPROVED.
  const fetched = await listAllPages(execute, "salesInvoice.list", {
    filter: { customerNo, outstanding: true },
    sort: "id|desc",
  });
  const cno = String(customerNo);
  const rows = fetched.rows.filter(
    (r) => String(r.customerNo ?? "") === cno || String((r.customer as Record<string, unknown>)?.customerNo ?? "") === cno
  );
  return { rows, total: fetched.total, truncated: fetched.truncated };
}

/**
 * Periode dd/mm/yyyy utk tool ringkasan — default BULAN BERJALAN
 * (selaras dgn deskripsi tool & system prompt; dulu defaultnya "hari ini"
 * padahal deskripsi bilang bulan berjalan). toDate kosong → akhir bulan dari fromDate.
 */
function periodOf(args: Record<string, unknown>): { from: string; to: string } {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const monthStart = `01/${p(now.getMonth() + 1)}/${now.getFullYear()}`;
  const endOfMonthOf = (from: string): string => {
    const m = from.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return from;
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    if (mm < 1 || mm > 12) return from;
    const last = new Date(yyyy, mm, 0).getDate();
    return `${p(last)}/${p(mm)}/${yyyy}`;
  };
  const from = String(args.fromDate ?? monthStart);
  const to = String(args.toDate ?? endOfMonthOf(from));
  return { from, to };
}

/** periode OPSIONAL — null bila keduanya kosong ("selama ini" = tanpa filter tanggal) */
function optionalPeriod(args: Record<string, unknown>): { from: string; to: string } | null {
  if (!args.fromDate && !args.toDate) return null;
  return periodOf(args);
}

/** nomor tanggal dd/mm/yyyy → YYYYMMDD utk sorting/filtering client-side */
function dmyNum(v: unknown): number {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(v ?? ""));
  return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0;
}
const byTransDateDesc = (a: Record<string, unknown>, b: Record<string, unknown>) => dmyNum(b.transDate) - dmyNum(a.transDate);
/** normalisasi nama utk pencocokan klien: huruf kecil, tanpa tanda baca, spasi rapat */
const normName = (v: unknown) =>
  String(v ?? "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

/** filter outstanding + periode transDate opsional (fromDate/toDate dd/mm/yyyy) utk summary piutang/utang */
function outstandingPeriodFilter(args: Record<string, unknown>): Record<string, unknown> {
  const filter: Record<string, unknown> = { outstanding: true };
  const from = args.fromDate ? String(args.fromDate) : "";
  const to = args.toDate ? String(args.toDate) : from;
  if (from && to) filter.transDate = { op: "BETWEEN", value: [from, to] };
  return filter;
}

/** echo periode bila fromDate+toDate terisi (utk label jawaban "posisi per 31/12/2017") */
function periodEcho(args: Record<string, unknown>): { fromDate: string; toDate: string } | null {
  const from = args.fromDate ? String(args.fromDate) : "";
  const to = args.toDate ? String(args.toDate) : from;
  return from && to ? { fromDate: from, toDate: to } : null;
}

/** cari pemasok by nama → baris pertama yg cocok (atau null) — mirror findCustomer */
async function findVendor(
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  name: string
): Promise<Record<string, unknown> | null> {
  const rows = asArray(await execute("vendor.list", { keywords: name, pageSize: 10 }));
  const q = normName(name);
  const hit =
    rows.find((r) => normName(r.name).includes(q) || normName(r.vendorNo) === q) ??
    rows.find((r) => q.split(" ").filter(Boolean).every((t) => normName(r.name).includes(t))) ??
    (rows.length === 1 ? rows[0] : null);
  return hit ?? null;
}

/** faktur pembelian pemasok (vendorNo), urut id desc — SEMUA halaman; opts.limit = N teratas */
async function vendorInvoices(
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  vendorNo: string,
  opts: { limit?: number; period?: { from: string; to: string } } = {}
): Promise<{ rows: Array<Record<string, unknown>>; total: number; truncated: boolean }> {
  // filter vendorNo value langsung — diverifikasi live ke API asli (60ms, terekstrak benar)
  const base = {
    filter: {
      vendorNo,
      ...(opts.period ? { transDate: { op: "BETWEEN", value: [opts.period.from, opts.period.to] } } : {}),
    },
    sort: "id|desc",
  };
  const fetched =
    opts.limit !== undefined
      ? await (async () => {
          const res = await execute("purchaseInvoice.list", { ...base, pageSize: opts.limit, page: 1 });
          const rows = asArray(res);
          const meta = metaOf(res);
          return { rows, total: meta.total || rows.length, truncated: false };
        })()
      : await listAllPages(execute, "purchaseInvoice.list", base);
  const vno = String(vendorNo);
  // scoping defensif (mock boleh abaikan filter) — sama dgn customerInvoices
  const rows = fetched.rows.filter(
    (r) => String(r.vendorNo ?? "") === vno || String((r.vendor as Record<string, unknown>)?.vendorNo ?? "") === vno
  );
  return { rows, total: fetched.total, truncated: fetched.truncated };
}

/** faktur pembelian BELUM DIBAYAR — filter.outstanding=true (diverifikasi live), semua halaman */
async function vendorUnpaidInvoices(
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  vendorNo: string
): Promise<{ rows: Array<Record<string, unknown>>; total: number; truncated: boolean }> {
  const fetched = await listAllPages(execute, "purchaseInvoice.list", {
    filter: { vendorNo, outstanding: true },
    sort: "id|desc",
  });
  const vno = String(vendorNo);
  const rows = fetched.rows.filter(
    (r) => String(r.vendorNo ?? "") === vno || String((r.vendor as Record<string, unknown>)?.vendorNo ?? "") === vno
  );
  return { rows, total: fetched.total, truncated: fetched.truncated };
}

/** eksekusi fn per item dgn batas konkurensi — utk detail faktur (topSelling) */
async function mapPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

/** detail kadang gagal transient (rate-limit) — retry agar 1 faktur hilang tak mengubah hasil agregasi */
async function executeWithRetry(
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  tool: string,
  args: Record<string, unknown>,
  attempts = 3
): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await execute(tool, args);
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function runAggregation(
  tool: string,
  args: Record<string, unknown>,
  ctx: ProviderCtx,
  execute: (tool: string, args: Record<string, unknown>) => Promise<unknown>
): Promise<unknown> {
  switch (tool) {
    case "customer.lastOrderByName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const customer = await findCustomer(execute, name);
      if (!customer) return { error: `pelanggan "${name}" tidak ditemukan` };
      const invoices = await customerInvoices(execute, String(customer.customerNo ?? ""));
      const rows = [...invoices.rows].sort(byTransDateDesc);
      return {
        customer: publicInfo(customer),
        lastOrder: rows[0] ?? null,
      };
    }
    case "customer.unpaidByName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const customer = await findCustomer(execute, name);
      if (!customer) return { error: `pelanggan "${name}" tidak ditemukan` };
      const { rows: unpaid, truncated } = await customerUnpaidInvoices(execute, String(customer.customerNo ?? ""));
      const totalUnpaid = unpaid.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      return {
        customer: publicInfo(customer),
        totalUnpaid,
        countUnpaid: unpaid.length,
        unpaid: unpaid.slice(0, 20),
        ...(truncated ? { truncated } : {}),
      };
    }
    case "customer.summaryByName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const customer = await findCustomer(execute, name);
      if (!customer) return { error: `pelanggan "${name}" tidak ditemukan` };
      const period = optionalPeriod(args);
      const inv = await customerInvoices(execute, String(customer.customerNo ?? ""), { period: period ?? undefined });
      const total = inv.rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      const up = await customerUnpaidInvoices(execute, String(customer.customerNo ?? ""));
      const totalUnpaid = up.rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      const truncated = inv.truncated || up.truncated;
      return {
        customer: publicInfo(customer),
        ...(period ? { period: { fromDate: period.from, toDate: period.to } } : {}),
        summary: {
          invoiceCount: inv.rows.length,
          totalSales: total,
          unpaidCount: up.rows.length,
          totalUnpaid,
          ...(truncated ? { truncated } : {}),
        },
        lastOrder: inv.rows[0] ?? null,
      };
    }
    case "customer.salesByName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const customer = await findCustomer(execute, name);
      if (!customer)
        return {
          error: `pelanggan "${name}" tidak ditemukan`,
          hint: "Bila nama ini adalah PEMASOK (kita yang membeli darinya), gunakan vendor.purchasesByName.",
        };
      const period = optionalPeriod(args);
      const inv = await customerInvoices(execute, String(customer.customerNo ?? ""), { period: period ?? undefined });
      const rows = inv.rows;
      const total = rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      return {
        customer: publicInfo(customer),
        period: period ? { fromDate: period.from, toDate: period.to } : "semua",
        summary: { invoiceCount: rows.length, totalSales: total, ...(inv.truncated ? { truncated: true } : {}) },
        invoices: rows.slice(0, 20).map((r) => ({
          number: r.number,
          transDate: r.transDate,
          totalAmount: r.totalAmount,
          status: r.approvalStatus ?? r.status ?? null,
        })),
      };
    }
    case "customer.itemsByName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const customer = await findCustomer(execute, name);
      if (!customer)
        return {
          error: `pelanggan "${name}" tidak ditemukan`,
          hint: "Bila nama ini adalah PEMASOK (kita membeli darinya), gunakan vendor.itemsByName.",
        };
      const period = optionalPeriod(args);
      const inv = await customerInvoices(execute, String(customer.customerNo ?? ""), { period: period ?? undefined });
      const rows = inv.rows.slice(0, 100);
      type ItemAgg = { itemName: string; quantity: number; amount: number; invoiceCount: number };
      const items = new Map<string, ItemAgg>();
      let detailErrors = 0;
      await mapPool(rows, 4, async (r) => {
        try {
          const d = await executeWithRetry(execute, "salesInvoice.detail", { id: r.id });
          const iv = (Array.isArray(d) ? d[0] : d) as Record<string, unknown> | null;
          const lines = Array.isArray(iv?.detailItem) ? (iv.detailItem as Array<Record<string, unknown>>) : [];
          for (const it of lines) {
            const itemObj = (it.item ?? {}) as Record<string, unknown>;
            const nm = String(it.detailName ?? itemObj.name ?? "").trim();
            if (!nm) continue;
            const g = items.get(nm) ?? { itemName: nm, quantity: 0, amount: 0, invoiceCount: 0 };
            g.quantity += Number(it.quantity) || 0;
            g.amount += Number(it.totalPrice) || 0;
            g.invoiceCount += 1;
            items.set(nm, g);
          }
        } catch {
          detailErrors += 1;
        }
      });
      const list = [...items.values()].sort((a, b) => b.amount - a.amount);
      const scanTruncated = inv.rows.length > rows.length;
      return {
        customer: publicInfo(customer),
        period: period ? { fromDate: period.from, toDate: period.to } : "semua",
        summary: {
          invoicesScanned: rows.length,
          invoiceCount: inv.rows.length,
          itemCount: list.length,
          totalQuantity: list.reduce((s, i) => s + i.quantity, 0),
          totalAmount: list.reduce((s, i) => s + i.amount, 0),
          detailErrors,
          ...(scanTruncated ? { scanTruncated: true } : {}),
          ...(inv.truncated ? { listTruncated: true } : {}),
        },
        items: list,
      };
    }
    case "salesInvoice.summary": {
      const { from, to } = periodOf(args);
      const all = await listAllPages(execute, "salesInvoice.list", {
        filter: { transDate: { op: "BETWEEN", value: [from, to] } },
        sort: "id|desc",
      });
      const rows = all.rows;
      const total = rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      // N teratas by amount — rows urut id|desc, "faktur terbesar" tak boleh terlewat
      const topByAmount = [...rows]
        .sort((a, b) => (Number(b.totalAmount) || 0) - (Number(a.totalAmount) || 0))
        .slice(0, 10)
        .map((r) => ({ number: r.number, transDate: r.transDate, totalAmount: r.totalAmount, customerName: (r.customer as Record<string, unknown> | undefined)?.name ?? null }));
      // pelanggan terbesar (akumulasi per pelanggan) — utk "siapa pelanggan terbesarnya"
      const byCust = new Map<string, { customerName: string; total: number; invoiceCount: number }>();
      for (const r of rows) {
        const nm = String((r.customer as Record<string, unknown> | undefined)?.name ?? r.customerNo ?? "");
        if (!nm) continue;
        const g = byCust.get(nm) ?? { customerName: nm, total: 0, invoiceCount: 0 };
        g.total += Number(r.totalAmount) || 0;
        g.invoiceCount += 1;
        byCust.set(nm, g);
      }
      const topByCustomer = [...byCust.values()].sort((a, b) => b.total - a.total).slice(0, 3);
      return {
        period: { fromDate: from, toDate: to },
        summary: {
          invoiceCount: rows.length,
          totalSales: total,
          average: rows.length ? Math.round(total / rows.length) : 0,
          ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
        },
        topByAmount,
        topByCustomer,
        invoices: rows.slice(0, 20),
      };
    }
    case "purchaseInvoice.summary": {
      const { from, to } = periodOf(args);
      const all = await listAllPages(execute, "purchaseInvoice.list", {
        filter: { transDate: { op: "BETWEEN", value: [from, to] } },
        sort: "id|desc",
      });
      const rows = all.rows;
      const total = rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      const topByAmount = [...rows]
        .sort((a, b) => (Number(b.totalAmount) || 0) - (Number(a.totalAmount) || 0))
        .slice(0, 10)
        .map((r) => ({
          number: r.number,
          transDate: r.transDate,
          totalAmount: r.totalAmount,
          vendorName: (r.vendor as Record<string, unknown> | undefined)?.name ?? null,
        }));
      return {
        period: { fromDate: from, toDate: to },
        summary: {
          invoiceCount: rows.length,
          totalPurchase: Math.trunc(total),
          average: rows.length ? Math.round(total / rows.length) : 0,
          ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
        },
        topByAmount,
        invoices: rows.slice(0, 20),
      };
    }
    case "invoice.biggestBoth": {
      const topOf = (
        rows: Array<Record<string, unknown>>,
        partyKey: "customer" | "vendor"
      ) => {
        const best = [...rows].sort((a, b) => (Number(b.totalAmount) || 0) - (Number(a.totalAmount) || 0))[0];
        if (!best) return null;
        const party = (best[partyKey] ?? {}) as Record<string, unknown>;
        return {
          number: String(best.number ?? ""),
          transDate: best.transDate,
          totalAmount: Number(best.totalAmount) || 0,
          partyName: String(party.name ?? (partyKey === "customer" ? best.customerNo : best.vendorNo) ?? ""),
        };
      };
      const [sales, purchase] = await Promise.all([
        listAllPages(execute, "salesInvoice.list", { sort: "id|desc" }),
        listAllPages(execute, "purchaseInvoice.list", { sort: "id|desc" }),
      ]);
      return {
        sales: topOf(sales.rows, "customer"),
        purchase: topOf(purchase.rows, "vendor"),
        ...(sales.truncated || purchase.truncated ? { truncated: true } : {}),
      };
    }
    case "salesInvoice.summaryMulti": {
      const mk = async (fd: unknown, td: unknown, label: unknown) => {
        const from = String(fd ?? "");
        const to = String(td ?? "");
        const all = await listAllPages(execute, "salesInvoice.list", {
          filter: { transDate: { op: "BETWEEN", value: [from, to] } },
          sort: "id|desc",
        });
        const rows = all.rows;
        const total = rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
        const paidCount = rows.filter((r) => {
          const st = String(r.statusName ?? "").toLowerCase();
          return st.includes("lunas") && !st.includes("belum");
        }).length;
        const customerCount = new Set(
          rows.map((r) => String(r.customerName ?? r.customerId ?? JSON.stringify(r.customer ?? "")))
        ).size;
        return {
          label: String(label ?? `${from}-${to}`),
          fromDate: from,
          toDate: to,
          invoiceCount: rows.length,
          totalSales: total,
          average: rows.length ? Math.round(total / rows.length) : 0,
          customerCount,
          paidCount,
        };
      };
      const p1 = await mk(args.fromDate1, args.toDate1, args.label1);
      const p2 = await mk(args.fromDate2, args.toDate2, args.label2);
      return {
        periods: [p1, p2],
        combined: { totalSales: p1.totalSales + p2.totalSales, invoiceCount: p1.invoiceCount + p2.invoiceCount },
        diff: {
          totalSales: Math.abs(p1.totalSales - p2.totalSales),
          average: Math.abs(p1.average - p2.average),
          invoiceCount: Math.abs(p1.invoiceCount - p2.invoiceCount),
        },
      };
    }
    case "purchaseInvoice.summaryMulti": {
      const mk = async (fd: unknown, td: unknown, label: unknown) => {
        const from = String(fd ?? "");
        const to = String(td ?? "");
        const all = await listAllPages(execute, "purchaseInvoice.list", {
          filter: { transDate: { op: "BETWEEN", value: [from, to] } },
          sort: "id|desc",
        });
        const rows = all.rows;
        const total = rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
        return {
          label: String(label ?? `${from}-${to}`),
          fromDate: from,
          toDate: to,
          invoiceCount: rows.length,
          totalPurchaseRaw: total,
          totalPurchase: Math.trunc(total),
          average: rows.length ? Math.round(total / rows.length) : 0,
        };
      };
      const p1 = await mk(args.fromDate1, args.toDate1, args.label1);
      const p2 = await mk(args.fromDate2, args.toDate2, args.label2);
      const diffRaw = Math.abs(p1.totalPurchaseRaw - p2.totalPurchaseRaw);
      return {
        periods: [p1, p2],
        combined: {
          totalPurchase: Math.trunc(p1.totalPurchaseRaw + p2.totalPurchaseRaw),
          invoiceCount: p1.invoiceCount + p2.invoiceCount,
        },
        diff: {
          totalPurchase: Math.trunc(diffRaw),
          average: Math.abs(p1.average - p2.average),
          invoiceCount: Math.abs(p1.invoiceCount - p2.invoiceCount),
        },
      };
    }
    case "fixedAsset.summary": {
      const year = Math.trunc(Number(args.year)) || 0;
      const all = await listAllPages(execute, "fixedAsset.list", {});
      const rows = year ? all.rows.filter((r) => String(r.transDate ?? "").endsWith("/" + year)) : [];
      return {
        year,
        count: rows.length,
        items: rows.slice(0, 10).map((r) => ({
          number: r.number ?? null,
          transDate: r.transDate ?? null,
          description: r.description ?? r.assetName ?? null,
          quantity: Number(r.quantity) || 1,
        })),
        ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
      };
    }
    case "journalVoucher.yearSummary": {
      const all = await listAllPages(execute, "journalVoucher.list", {});
      const byYear = new Map<number, { year: number; count: number; totalAmount: number }>();
      for (const r of all.rows) {
        const ds = String(r.transDate ?? "");
        const year = Number(ds.slice(-4));
        if (!year || year < 1900 || year > 2200) continue;
        const g = byYear.get(year) ?? { year, count: 0, totalAmount: 0 };
        g.count += 1;
        g.totalAmount += Number(r.totalAmount) || 0;
        byYear.set(year, g);
      }
      const years = [...byYear.values()].sort((a, b) => b.count - a.count || a.year - b.year);
      return {
        years,
        top: years[0] ?? null,
        totalJournals: all.rows.length,
        ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
      };
    }
    case "item.zeroStock": {
      const all = await listAllPages(execute, "item.list", {});
      const qty = (r: Record<string, unknown>) => Number(r.quantity) || 0;
      const zeros = all.rows.filter((r) => qty(r) === 0);
      const minQty = all.rows.length ? Math.min(...all.rows.map(qty)) : 0;
      return {
        zeroCount: zeros.length,
        minQuantity: minQty,
        items: zeros.map((r) => ({
          no: r.no ?? r.number ?? null,
          name: r.name ?? r.itemName ?? null,
          quantity: 0,
        })),
        ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
      };
    }
    case "item.topStock": {
      const limit = Math.max(1, Math.min(50, Number(args.limit ?? 10) || 10));
      const all = await listAllPages(execute, "item.list", {});
      const sorted = [...all.rows].sort((a, b) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0));
      return {
        limit,
        itemKindCount: all.rows.length,
        items: sorted.slice(0, limit).map((r) => ({
          no: r.no ?? r.number ?? null,
          name: r.name ?? r.itemName ?? null,
          quantity: Number(r.quantity) || 0,
        })),
        ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
      };
    }
    case "item.stockOverview": {
      const all = await listAllPages(execute, "item.list", {});
      const totalQuantity = all.rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
      let warehouses: string[] = [];
      let warehouseTruncated = false;
      try {
        const w = await listAllPages(execute, "warehouse.list", {});
        warehouses = w.rows.map((r) => String(r.name ?? r.warehouseName ?? "")).filter(Boolean);
        warehouseTruncated = w.truncated;
      } catch {
        warehouses = [];
      }
      return {
        itemCount: all.rows.length,
        totalQuantity,
        warehouseCount: warehouses.length,
        warehouses: warehouses.slice(0, 20),
        ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
        ...(warehouseTruncated ? { warehouseTruncated: true } : {}),
      };
    }
    case "autoNumber.summary": {
      const all = await listAllPages(execute, "autoNumber.list", {});
      return {
        count: all.rows.length,
        items: all.rows.slice(0, 10).map((r) => ({ name: r.name ?? r.description ?? null })),
        ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
      };
    }
    case "journalVoucher.summary": {
      const period = optionalPeriod(args);
      const all = await listAllPages(execute, "journalVoucher.list", {});
      const rows = period
        ? all.rows.filter((r) => {
            const t = dmyNum(r.transDate);
            return t >= dmyNum(period.from) && t <= dmyNum(period.to);
          })
        : all.rows;
      const total = rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      const topByAmount = [...rows]
        .sort((a, b) => (Number(b.totalAmount) || 0) - (Number(a.totalAmount) || 0))
        .slice(0, 5)
        .map((r) => ({ number: r.number, transDate: r.transDate, totalAmount: r.totalAmount }));
      return {
        ...(period ? { period: { fromDate: period.from, toDate: period.to } } : { period: "semua" }),
        summary: {
          journalCount: rows.length,
          totalAmount: Math.trunc(total),
          ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
        },
        topByAmount,
      };
    }
    case "salesReturn.summary": {
      const period = optionalPeriod(args);
      const all = await listAllPages(execute, "salesReturn.list", {});
      const rows = period
        ? all.rows.filter((r) => {
            const t = dmyNum(r.transDate);
            return t >= dmyNum(period.from) && t <= dmyNum(period.to);
          })
        : all.rows;
      const total = rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      return {
        ...(period ? { period: { fromDate: period.from, toDate: period.to } } : { period: "semua" }),
        summary: {
          returnCount: rows.length,
          totalAmount: Math.trunc(total),
          ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
        },
      };
    }
    case "purchaseReturn.summary": {
      const period = optionalPeriod(args);
      const all = await listAllPages(execute, "purchaseReturn.list", {});
      const rows = period
        ? all.rows.filter((r) => {
            const t = dmyNum(r.transDate);
            return t >= dmyNum(period.from) && t <= dmyNum(period.to);
          })
        : all.rows;
      const total = rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      return {
        ...(period ? { period: { fromDate: period.from, toDate: period.to } } : { period: "semua" }),
        summary: {
          returnCount: rows.length,
          totalAmount: Math.trunc(total),
          ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
        },
      };
    }
    case "vendor.lastPurchaseByName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const vendor = await findVendor(execute, name);
      if (!vendor) return { error: `pemasok "${name}" tidak ditemukan` };
      const invoices = await vendorInvoices(execute, String(vendor.vendorNo ?? ""));
      const rows = [...invoices.rows].sort(byTransDateDesc);
      return {
        vendor: publicInfo(vendor),
        lastPurchase: rows[0] ?? null,
      };
    }
    case "vendor.purchasesByName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const vendor = await findVendor(execute, name);
      if (!vendor)
        return {
          error: `pemasok "${name}" tidak ditemukan`,
          hint: "Bila nama ini adalah PELANGGAN (kita yang menjual kepadanya), gunakan customer.salesByName.",
        };
      const period = optionalPeriod(args);
      const inv = await vendorInvoices(execute, String(vendor.vendorNo ?? ""), { period: period ?? undefined });
      const rows = inv.rows;
      const total = rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      return {
        vendor: publicInfo(vendor),
        period: period ? { fromDate: period.from, toDate: period.to } : "semua",
        summary: { invoiceCount: rows.length, totalPurchase: total, ...(inv.truncated ? { truncated: true } : {}) },
        invoices: rows.slice(0, 20).map((r) => ({
          number: r.number,
          transDate: r.transDate,
          totalAmount: r.totalAmount,
          status: r.approvalStatus ?? r.status ?? null,
        })),
      };
    }
    case "vendor.itemsByName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const vendor = await findVendor(execute, name);
      if (!vendor)
        return {
          error: `pemasok "${name}" tidak ditemukan`,
          hint: "Bila nama ini adalah PELANGGAN (kita menjual kepadanya), gunakan customer.itemsByName.",
        };
      const period = optionalPeriod(args);
      const inv = await vendorInvoices(execute, String(vendor.vendorNo ?? ""), { period: period ?? undefined });
      const rows = inv.rows.slice(0, 100);
      type ItemAgg = { itemName: string; quantity: number; amount: number; invoiceCount: number };
      const items = new Map<string, ItemAgg>();
      let detailErrors = 0;
      await mapPool(rows, 4, async (r) => {
        try {
          const d = await executeWithRetry(execute, "purchaseInvoice.detail", { id: r.id });
          const iv = (Array.isArray(d) ? d[0] : d) as Record<string, unknown> | null;
          const lines = Array.isArray(iv?.detailItem) ? (iv.detailItem as Array<Record<string, unknown>>) : [];
          for (const it of lines) {
            const itemObj = (it.item ?? {}) as Record<string, unknown>;
            const nm = String(it.detailName ?? itemObj.name ?? "").trim();
            if (!nm) continue;
            const g = items.get(nm) ?? { itemName: nm, quantity: 0, amount: 0, invoiceCount: 0 };
            g.quantity += Number(it.quantity) || 0;
            g.amount += Number(it.totalPrice) || 0;
            g.invoiceCount += 1;
            items.set(nm, g);
          }
        } catch {
          detailErrors += 1;
        }
      });
      const list = [...items.values()].sort((a, b) => b.amount - a.amount);
      const scanTruncated = inv.rows.length > rows.length;
      return {
        vendor: publicInfo(vendor),
        period: period ? { fromDate: period.from, toDate: period.to } : "semua",
        summary: {
          invoicesScanned: rows.length,
          invoiceCount: inv.rows.length,
          itemCount: list.length,
          totalQuantity: list.reduce((s, i) => s + i.quantity, 0),
          totalAmount: list.reduce((s, i) => s + i.amount, 0),
          detailErrors,
          ...(scanTruncated ? { scanTruncated: true } : {}),
          ...(inv.truncated ? { listTruncated: true } : {}),
        },
        items: list,
      };
    }
    case "vendor.unpaidByName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const vendor = await findVendor(execute, name);
      if (!vendor) return { error: `pemasok "${name}" tidak ditemukan` };
      const { rows: unpaid, truncated } = await vendorUnpaidInvoices(execute, String(vendor.vendorNo ?? ""));
      const totalUnpaid = unpaid.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      return {
        vendor: publicInfo(vendor),
        totalUnpaid,
        countUnpaid: unpaid.length,
        unpaid: unpaid.slice(0, 20),
        ...(truncated ? { truncated } : {}),
      };
    }
    case "vendor.summaryByName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const vendor = await findVendor(execute, name);
      if (!vendor) return { error: `pemasok "${name}" tidak ditemukan` };
      const period = optionalPeriod(args);
      const inv = await vendorInvoices(execute, String(vendor.vendorNo ?? ""), { period: period ?? undefined });
      const total = inv.rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      const up = await vendorUnpaidInvoices(execute, String(vendor.vendorNo ?? ""));
      const totalUnpaid = up.rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      const truncated = inv.truncated || up.truncated;
      return {
        vendor: publicInfo(vendor),
        ...(period ? { period: { fromDate: period.from, toDate: period.to } } : {}),
        summary: {
          invoiceCount: inv.rows.length,
          totalPurchase: total,
          unpaidCount: up.rows.length,
          totalUnpaid,
          ...(truncated ? { truncated } : {}),
        },
        lastPurchase: inv.rows[0] ?? null,
      };
    }
    case "salesInvoice.perCustomer": {
      const period = optionalPeriod(args);
      const all = await listAllPages(execute, "salesInvoice.list", {
        ...(period ? { filter: { transDate: { op: "BETWEEN", value: [period.from, period.to] } } } : {}),
        sort: "id|desc",
      });
      const rows = all.rows;
      type Group = { customerNo: string; name: string; invoiceCount: number; total: number };
      const groups = new Map<string, Group>();
      for (const r of rows) {
        const cust = (r.customer ?? {}) as Record<string, unknown>;
        const cno = String(r.customerNo ?? cust.customerNo ?? "");
        const key = cno || String(cust.name ?? "") || "tanpa-kode";
        const g =
          groups.get(key) ?? { customerNo: cno, name: String(cust.name ?? cno), invoiceCount: 0, total: 0 };
        g.invoiceCount += 1;
        g.total += Number(r.totalAmount) || 0;
        groups.set(key, g);
      }
      const customers = [...groups.values()].sort((a, b) => b.total - a.total);
      const totalSales = customers.reduce((s, g) => s + g.total, 0);
      const smallest = customers.length ? customers[customers.length - 1] : null;
      const limit = Math.min(20, Math.max(0, Number(args.limit) || 0));
      return {
        period: period ? { fromDate: period.from, toDate: period.to } : "semua",
        summary: {
          customerCount: customers.length,
          invoiceCount: rows.length,
          totalSales,
          ...(smallest ? { smallest: { name: smallest.name, invoiceCount: smallest.invoiceCount, total: smallest.total } } : {}),
          ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
        },
        ...(limit ? { limit } : {}),
        customers: customers.slice(0, limit || 20),
      };
    }
    case "purchaseInvoice.perVendor": {
      const period = optionalPeriod(args);
      const all = await listAllPages(execute, "purchaseInvoice.list", {
        ...(period ? { filter: { transDate: { op: "BETWEEN", value: [period.from, period.to] } } } : {}),
        sort: "id|desc",
      });
      const rows = all.rows;
      type Group = { vendorNo: string; name: string; invoiceCount: number; total: number };
      const groups = new Map<string, Group>();
      for (const r of rows) {
        const vend = (r.vendor ?? {}) as Record<string, unknown>;
        const vno = String(r.vendorNo ?? vend.vendorNo ?? "");
        const key = vno || String(vend.name ?? "") || "tanpa-kode";
        const g = groups.get(key) ?? { vendorNo: vno, name: String(vend.name ?? vno), invoiceCount: 0, total: 0 };
        g.invoiceCount += 1;
        g.total += Number(r.totalAmount) || 0;
        groups.set(key, g);
      }
      const vendors = [...groups.values()].sort((a, b) => b.total - a.total);
      const totalPurchase = vendors.reduce((s, g) => s + g.total, 0);
      const smallest = vendors.length ? vendors[vendors.length - 1] : null;
      const limit = Math.min(20, Math.max(0, Number(args.limit) || 0));
      return {
        period: period ? { fromDate: period.from, toDate: period.to } : "semua",
        summary: {
          vendorCount: vendors.length,
          invoiceCount: rows.length,
          totalPurchase,
          ...(smallest ? { smallest: { name: smallest.name, invoiceCount: smallest.invoiceCount, total: smallest.total } } : {}),
          ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
        },
        ...(limit ? { limit } : {}),
        vendors: vendors.slice(0, limit || 20),
      };
    }
    case "item.topSelling": {
      const { from, to } = periodOf(args);
      const limit = Math.max(1, Math.min(50, Number(args.limit ?? 10) || 10));
      const all = await listAllPages(execute, "salesInvoice.list", {
        filter: { transDate: { op: "BETWEEN", value: [from, to] } },
        sort: "id|desc",
      });
      const rows = all.rows;
      // detail per faktur: 59KB/row di API asli → batasi 100 faktur terakhir, konkurensi 6
      const SCAN_CAP = 100;
      const scanned = rows.slice(0, SCAN_CAP);
      const agg = new Map<string, { itemName: string; quantity: number; amount: number }>();
      let detailErrors = 0;
      await mapPool(scanned, 4, async (r) => {
        try {
          const d = await executeWithRetry(execute, "salesInvoice.detail", { id: r.id });
          // API asli membalas objek faktur; mock membalas array 1 baris
          const inv = (Array.isArray(d) ? d[0] : d) as Record<string, unknown> | null;
          const items = Array.isArray(inv?.detailItem) ? (inv.detailItem as Array<Record<string, unknown>>) : [];
          for (const it of items) {
            const itemObj = (it.item ?? {}) as Record<string, unknown>;
            const nm = String(it.detailName ?? itemObj.name ?? "").trim();
            if (!nm) continue;
            const g = agg.get(nm) ?? { itemName: nm, quantity: 0, amount: 0 };
            g.quantity += Number(it.quantity) || 0;
            g.amount += Number(it.totalPrice) || 0;
            agg.set(nm, g);
          }
        } catch {
          detailErrors += 1;
        }
      });
      const items = [...agg.values()]
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, limit)
        .map((g) => ({
          ...g,
          // harga rata-rata terjual — matikan kebutuhan get-selling-price per barang
          avgUnitPrice: g.quantity > 0 ? Math.round(g.amount / g.quantity) : null,
        }));
      const scanTruncated = rows.length > scanned.length;
      return {
        period: { fromDate: from, toDate: to },
        summary: {
          invoicesInPeriod: rows.length,
          invoicesScanned: scanned.length,
          detailErrors,
          itemCount: agg.size,
          ...(scanTruncated ? { scanTruncated: true } : {}),
          ...(all.truncated ? { listTruncated: true, totalOnServer: all.total } : {}),
        },
        items,
      };
    }
    case "receivables.summary": {
      const limit = Math.max(1, Math.min(50, Number(args.limit ?? 10) || 10));
      const all = await listAllPages(execute, "salesInvoice.list", {
        filter: outstandingPeriodFilter(args),
        sort: "id|desc",
      });
      type Group = { customerNo: string; name: string; invoiceCount: number; total: number };
      const groups = new Map<string, Group>();
      for (const r of all.rows) {
        const cust = (r.customer ?? {}) as Record<string, unknown>;
        const cno = String(r.customerNo ?? cust.customerNo ?? "");
        const key = cno || String(cust.name ?? "") || "tanpa-kode";
        const g = groups.get(key) ?? { customerNo: cno, name: String(cust.name ?? cno), invoiceCount: 0, total: 0 };
        g.invoiceCount += 1;
        g.total += Number(r.totalAmount) || 0;
        groups.set(key, g);
      }
      const customers = [...groups.values()].sort((a, b) => b.total - a.total);
      const totalReceivables = customers.reduce((s, g) => s + g.total, 0);
      // faktur jatuh tempo paling dekat (urut dd/mm/yyyy ASLI — sort server salah utk format ini)
      let earliestDue: Record<string, unknown> | null = null;
      let minDue = Number.MAX_SAFE_INTEGER;
      for (const r of all.rows) {
        const n = dmyNum(r.dueDate);
        if (n > 0 && n < minDue) {
          minDue = n;
          earliestDue = {
            number: r.number ?? null,
            dueDate: r.dueDate ?? null,
            totalAmount: r.totalAmount ?? null,
            customerName: (r.customer as Record<string, unknown> | undefined)?.name ?? null,
            customerNo: r.customerNo ?? null,
          };
        }
      }
      const period = periodEcho(args);
      return {
        ...(period ? { period } : {}),
        ...(earliestDue ? { earliestDue } : {}),
        summary: {
          totalReceivables,
          invoiceCount: all.rows.length,
          customerCount: customers.length,
          ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
        },
        customers: customers.slice(0, limit),
      };
    }
    case "payables.summary": {
      const limit = Math.max(1, Math.min(50, Number(args.limit ?? 10) || 10));
      const all = await listAllPages(execute, "purchaseInvoice.list", {
        filter: outstandingPeriodFilter(args),
        sort: "id|desc",
      });
      type Group = { vendorNo: string; name: string; invoiceCount: number; total: number };
      const groups = new Map<string, Group>();
      for (const r of all.rows) {
        const vend = (r.vendor ?? {}) as Record<string, unknown>;
        const vno = String(r.vendorNo ?? vend.vendorNo ?? "");
        const key = vno || String(vend.name ?? "") || "tanpa-kode";
        const g = groups.get(key) ?? { vendorNo: vno, name: String(vend.name ?? vno), invoiceCount: 0, total: 0 };
        g.invoiceCount += 1;
        g.total += Number(r.totalAmount) || 0;
        groups.set(key, g);
      }
      const vendors = [...groups.values()].sort((a, b) => b.total - a.total);
      const totalPayables = vendors.reduce((s, g) => s + g.total, 0);
      const period = periodEcho(args);
      return {
        ...(period ? { period } : {}),
        summary: {
          totalPayables,
          invoiceCount: all.rows.length,
          vendorCount: vendors.length,
          ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
        },
        vendors: vendors.slice(0, limit),
      };
    }
    case "arap.summary": {
      const limit = Math.max(1, Math.min(50, Number(args.limit ?? 5) || 5));
      const [ar, ap] = await Promise.all([
        listAllPages(execute, "salesInvoice.list", { filter: outstandingPeriodFilter(args), sort: "id|desc" }),
        listAllPages(execute, "purchaseInvoice.list", { filter: outstandingPeriodFilter(args), sort: "id|desc" }),
      ]);
      const groupSum = (rows: Record<string, unknown>[], party: "customer" | "vendor") => {
        const groups = new Map<string, { name: string; invoiceCount: number; total: number }>();
        for (const r of rows) {
          const obj = (r[party] ?? {}) as Record<string, unknown>;
          const no = String(r[`${party}No`] ?? obj[`${party}No`] ?? "");
          const key = no || String(obj.name ?? "") || "tanpa-kode";
          const g = groups.get(key) ?? { name: String(obj.name ?? no), invoiceCount: 0, total: 0 };
          g.invoiceCount += 1;
          g.total += Number(r.totalAmount) || 0;
          groups.set(key, g);
        }
        return [...groups.values()].sort((a, b) => b.total - a.total);
      };
      const customers = groupSum(ar.rows, "customer");
      const vendors = groupSum(ap.rows, "vendor");
      const totalReceivables = customers.reduce((s, g) => s + g.total, 0);
      const totalPayables = vendors.reduce((s, g) => s + g.total, 0);
      const diff = totalPayables - totalReceivables;
      return {
        receivables: {
          total: totalReceivables,
          invoiceCount: ar.rows.length,
          customerCount: customers.length,
          customers: customers.slice(0, limit),
        },
        payables: {
          total: totalPayables,
          invoiceCount: ap.rows.length,
          vendorCount: vendors.length,
          vendors: vendors.slice(0, limit),
        },
        larger: diff === 0 ? "sama" : diff > 0 ? "utang" : "piutang",
        diff: Math.trunc(Math.abs(diff)),
        ...(ar.truncated ? { arTruncated: true, arTotalOnServer: ar.total } : {}),
        ...(ap.truncated ? { apTruncated: true, apTotalOnServer: ap.total } : {}),
      };
    }
    case "invoice.statusCounts": {
      const side = String(args.side ?? "sales") === "purchase" ? "purchase" : "sales";
      const tool = side === "purchase" ? "purchaseInvoice.list" : "salesInvoice.list";
      const period = optionalPeriod(args);
      const all = await listAllPages(execute, tool, {
        ...(period ? { filter: { transDate: { op: "BETWEEN", value: [period.from, period.to] } } } : {}),
        sort: "id|desc",
      });
      let paid = 0;
      let unpaid = 0;
      for (const r of all.rows) {
        const st = String(r.statusName ?? r.status ?? "").toLowerCase();
        if (st.includes("lunas") && !st.includes("belum")) paid += 1;
        else unpaid += 1;
      }
      return {
        side,
        scope: period ? { fromDate: period.from, toDate: period.to } : "semua",
        invoiceCount: all.rows.length,
        paid,
        unpaid,
        ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
      };
    }
    case "party.yoySummary": {
      const party = String(args.party ?? "customer") === "vendor" ? "vendor" : "customer";
      const name = String(args.name ?? "").trim();
      const y1 = Number(args.year1) || 0;
      const y2 = Number(args.year2) || 0;
      if (!name) throw new Error("name wajib diisi");
      if (!y1 || !y2) throw new Error("year1 & year2 wajib diisi");
      const range = (y: number) => ({ from: `01/01/${y}`, to: `31/12/${y}` });
      const sum = (rows: Array<Record<string, unknown>>) => rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      const finish = (
        entity: Record<string, unknown>,
        a: { rows: Array<Record<string, unknown>>; truncated: boolean },
        b: { rows: Array<Record<string, unknown>>; truncated: boolean },
        unit: "penjualan" | "pembelian"
      ) => {
        const t1 = sum(a.rows);
        const t2 = sum(b.rows);
        return {
          party,
          unit,
          entity: publicInfo(entity),
          years: [
            { year: y1, invoiceCount: a.rows.length, total: t1 },
            { year: y2, invoiceCount: b.rows.length, total: t2 },
          ],
          direction: t2 > t1 ? "naik" : t2 < t1 ? "turun" : "sama",
          diff: Math.trunc(Math.abs(t2 - t1)),
          ...(a.truncated || b.truncated ? { truncated: true } : {}),
        };
      };
      if (party === "vendor") {
        const vendor = await findVendor(execute, name);
        if (!vendor) return { error: `pemasok "${name}" tidak ditemukan` };
        const vno = String(vendor.vendorNo ?? "");
        const [a, b] = await Promise.all([
          vendorInvoices(execute, vno, { period: range(y1) }),
          vendorInvoices(execute, vno, { period: range(y2) }),
        ]);
        return finish(vendor, a, b, "pembelian");
      }
      const customer = await findCustomer(execute, name);
      if (!customer) return { error: `pelanggan "${name}" tidak ditemukan` };
      const cno = String(customer.customerNo ?? "");
      const [a, b] = await Promise.all([
        customerInvoices(execute, cno, { period: range(y1) }),
        customerInvoices(execute, cno, { period: range(y2) }),
      ]);
      return finish(customer, a, b, "penjualan");
    }
    case "return.summaryBoth": {
      const period = optionalPeriod(args);
      const count = async (tool: string) => {
        const all = await listAllPages(execute, tool, {});
        const rows = period
          ? all.rows.filter((r) => {
              const t = dmyNum(r.transDate);
              return t >= dmyNum(period.from) && t <= dmyNum(period.to);
            })
          : all.rows;
        return {
          returnCount: rows.length,
          totalAmount: Math.trunc(rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0)),
          truncated: all.truncated,
        };
      };
      const [sr, pr] = await Promise.all([count("salesReturn.list"), count("purchaseReturn.list")]);
      const diff = pr.totalAmount - sr.totalAmount;
      return {
        ...(period ? { period: { fromDate: period.from, toDate: period.to } } : { period: "semua" }),
        salesReturn: sr,
        purchaseReturn: pr,
        larger: diff === 0 ? "sama" : diff > 0 ? "purchaseReturn" : "salesReturn",
        diff: Math.trunc(Math.abs(diff)),
        ...(sr.truncated || pr.truncated ? { truncated: true } : {}),
      };
    }
    case "salesReceipt.yearCount": {
      const year = Number(args.year) || 0;
      if (!year) throw new Error("year wajib diisi");
      const all = await listAllPages(execute, "salesReceipt.list", { sort: "id|desc" });
      const rows = all.rows
        .filter((r) => Math.floor(dmyNum(r.transDate) / 10000) === year)
        .sort((a, b) => dmyNum(b.transDate) - dmyNum(a.transDate));
      return {
        year,
        scope: "transDate",
        count: rows.length,
        receipts: rows.slice(0, 20).map((r) => ({
          number: String(r.number ?? ""),
          transDate: r.transDate,
          totalAmount: Number(r.totalAmount) || 0,
        })),
        ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
      };
    }
    case "deliveryOrder.yearCount": {
      const year = Number(args.year) || 0;
      if (!year) throw new Error("year wajib diisi");
      const all = await listAllPages(execute, "deliveryOrder.list", { sort: "id|desc" });
      const rows = all.rows
        .filter((r) => Math.floor(dmyNum(r.transDate) / 10000) === year)
        .sort((a, b) => dmyNum(b.transDate) - dmyNum(a.transDate));
      return {
        year,
        scope: "transDate",
        count: rows.length,
        deliveries: rows.slice(0, 20).map((r) => ({
          number: String(r.number ?? ""),
          transDate: r.transDate,
          description: String(r.description ?? ""),
        })),
        ...(all.truncated ? { truncated: true, totalOnServer: all.total } : {}),
      };
    }
    case "gl.plSummary": {
      const { from, to } = periodOf(args);
      // SATU panggilan get-pl memuat seluruh akun P&L periode ini.
      // Baris isParent=true = agregat anak → hitung hanya leaf (isParent=false).
      const raw = await execute("glaccount.get-pl-account-amount", { fromDate: from, toDate: to });
      const rows = asArray(raw);
      const CATS = ["REVENUE", "COST_OF_GOOD_SOLD", "EXPENSE", "OTHER_INCOME", "OTHER_EXPENSE"] as const;
      const sums: Record<string, number> = { REVENUE: 0, COST_OF_GOOD_SOLD: 0, EXPENSE: 0, OTHER_INCOME: 0, OTHER_EXPENSE: 0 };
      const byCat = new Map<string, Array<{ accountNo: string; accountName: string; amount: number }>>();
      for (const r of rows) {
        if (r.isParent === true) continue;
        const cat = String(r.accountType ?? "");
        if (!(CATS as readonly string[]).includes(cat)) continue;
        const amount = Number(r.amount) || 0;
        sums[cat] += amount;
        const list = byCat.get(cat) ?? [];
        list.push({ accountNo: String(r.accountNo ?? ""), accountName: String(r.accountName ?? ""), amount });
        byCat.set(cat, list);
      }
      const top = (cat: string) =>
        (byCat.get(cat) ?? [])
          .filter((a) => a.amount !== 0)
          .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
          .slice(0, 5);
      const grossProfit = sums.REVENUE - sums.COST_OF_GOOD_SOLD;
      const netProfit =
        sums.REVENUE - sums.COST_OF_GOOD_SOLD - sums.EXPENSE + sums.OTHER_INCOME - sums.OTHER_EXPENSE;
      return {
        period: { fromDate: from, toDate: to },
        accountCount: rows.length,
        summary: {
          revenue: Math.round(sums.REVENUE),
          costOfGoodsSold: Math.round(sums.COST_OF_GOOD_SOLD),
          grossProfit: Math.round(grossProfit),
          operatingExpense: Math.round(sums.EXPENSE),
          otherIncome: Math.round(sums.OTHER_INCOME),
          otherExpense: Math.round(sums.OTHER_EXPENSE),
          netProfit: Math.round(netProfit),
        },
        topAccounts: {
          revenue: top("REVENUE"),
          costOfGoodsSold: top("COST_OF_GOOD_SOLD"),
          operatingExpense: top("EXPENSE"),
          otherIncome: top("OTHER_INCOME"),
          otherExpense: top("OTHER_EXPENSE"),
        },
      };
    }
    case "gl.bsSummary": {
      const p2 = (n: number) => String(n).padStart(2, "0");
      const now = new Date();
      const asOfDate = String(args.asOfDate ?? `${p2(now.getDate())}/${p2(now.getMonth() + 1)}/${now.getFullYear()}`);
      const raw = await execute("glaccount.get-bs-account-amount", { asOfDate });
      const rows = asArray(raw);
      const sections = { aset: 0, kewajiban: 0, modal: 0, lainnya: 0 };
      const typeSums = new Map<string, { amount: number; section: string }>();
      const leaves: Array<{ accountNo: string; accountName: string; accountType: string; amount: number; section: string }> = [];
      for (const r of rows) {
        if (r.isParent === true) continue;
        const type = String(r.accountType ?? "");
        const amount = Number(r.amount) || 0;
        const section = bsSection(type);
        sections[section] += amount;
        const t = typeSums.get(type) ?? { amount: 0, section };
        t.amount += amount;
        typeSums.set(type, t);
        leaves.push({ accountNo: String(r.accountNo ?? ""), accountName: String(r.accountName ?? ""), accountType: type, amount, section });
      }
      const top = (sec: string) =>
        leaves
          .filter((a) => a.section === sec && a.amount !== 0)
          .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
          .slice(0, 8);
      const byType = [...typeSums.entries()]
        .map(([accountType, v]) => ({ accountType, section: v.section, amount: Math.round(v.amount) }))
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
      return {
        period: { asOfDate },
        accountCount: rows.length,
        summary: {
          totalAssets: Math.round(sections.aset),
          totalLiabilities: Math.round(sections.kewajiban),
          totalEquity: Math.round(sections.modal),
          ...(sections.lainnya !== 0 ? { unclassified: Math.round(sections.lainnya) } : {}),
        },
        byType,
        topAccounts: {
          assets: top("aset"),
          liabilities: top("kewajiban"),
          equity: top("modal"),
        },
      };
    }
    case "item.byName": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const rows = asArray(
        await execute("item.list", { keywords: name, fields: "id,no,name,quantity", pageSize: 10 })
      );
      const q = name.toLowerCase().replace(/\s+/g, " ");
      const hit =
        rows.find(
          (r) => String(r.name ?? "").toLowerCase().replace(/\s+/g, " ").includes(q) || String(r.no ?? "").toLowerCase().includes(q)
        ) ?? rows[0];
      if (!hit) return { error: `barang "${name}" tidak ditemukan` };
      const no = String(hit.no ?? "");
      const [priceRes, stockRes] = await Promise.all([
        execute("item.get-selling-price", { no }).catch(() => null),
        execute("item.get-stock", { no }).catch(() => null),
      ]);
      const first = (v: unknown): Record<string, unknown> | null => {
        const a = asArray(v);
        if (a.length) return a[0];
        if (v && typeof v === "object") return v as Record<string, unknown>;
        return null;
      };
      const numIn = (row: Record<string, unknown> | null, keys: string[]): number | null => {
        if (!row) return null;
        for (const k of keys) {
          const raw = row[k];
          if (raw !== undefined && raw !== null && Number.isFinite(Number(raw))) return Number(raw);
        }
        return null;
      };
      const priceRow = first(priceRes);
      const stockRow = first(stockRes);
      const sellingPrice = numIn(priceRow, ["price", "sellingPrice", "amount", "value"]);
      const stock = numIn(stockRow, ["stock", "stockQuantity", "quantity", "balance"]) ?? numIn(hit, ["quantity"]);
      const alternatives = rows.filter((r) => r !== hit).slice(0, 4);
      return {
        item: publicInfo(hit),
        sellingPrice,
        stock,
        ...(priceRow && typeof priceRow.currencyCode === "string" ? { currencyCode: priceRow.currencyCode } : {}),
        ...(alternatives.length ? { alternatives: alternatives.map(publicInfo) } : {}),
      };
    }
    case "item.buyers": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const period = optionalPeriod(args);
      const periodFilter = period ? { transDate: { op: "BETWEEN", value: [period.from, period.to] } } : undefined;
      const all = await listAllPages(execute, "salesInvoice.list", {
        ...(periodFilter ? { filter: periodFilter } : {}),
        sort: "id|desc",
      });
      const rows = all.rows;
      const SCAN_CAP = 100;
      const scanned = rows.slice(0, SCAN_CAP);
      // cocokkan tanpa spasi — "Iphone 5 16 GB" == "iphone 5 16gb" (argumen model sering beda spasi)
      const q = name.toLowerCase().replace(/\s+/g, "");
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
      type Buyer = { customerNo: string; name: string; quantity: number; amount: number; invoiceCount: number };
      type ScanLine = { qty: number; amt: number; exact: boolean };
      const scans: Array<{ cno: string; cname: string; lines: ScanLine[] }> = [];
      let detailErrors = 0;
      const failed: Record<string, unknown>[] = [];
      const scanOne = async (r: Record<string, unknown>) => {
        const d = await executeWithRetry(execute, "salesInvoice.detail", { id: r.id });
        const inv = (Array.isArray(d) ? d[0] : d) as Record<string, unknown> | null;
        const items = Array.isArray(inv?.detailItem) ? (inv.detailItem as Array<Record<string, unknown>>) : [];
        const lines: ScanLine[] = [];
        for (const it of items) {
          const itemObj = (it.item ?? {}) as Record<string, unknown>;
          const nm = String(it.detailName ?? itemObj.name ?? "").trim();
          if (!nm) continue;
          const nmN = norm(nm);
          if (!nmN.includes(q)) continue;
          lines.push({ qty: Number(it.quantity) || 0, amt: Number(it.totalPrice) || 0, exact: nmN === q });
        }
        if (!lines.length) return;
        const cust = (r.customer ?? (inv?.customer as Record<string, unknown>) ?? {}) as Record<string, unknown>;
        const cno = String(r.customerNo ?? cust.customerNo ?? "");
        const cname = String(cust.name ?? r.customerName ?? cno);
        scans.push({ cno, cname, lines });
      };
      await mapPool(scanned, 4, async (r) => {
        try {
          await scanOne(r);
        } catch {
          failed.push(r);
        }
      });
      // retry satu per satu utk faktur yang gagal diambil detailnya (glitch antrean) — jangan sampai 1 faktur bikin hasil kosong
      for (const r of failed) {
        try {
          await scanOne(r);
        } catch {
          detailErrors += 1;
        }
      }
      if (detailErrors > 0) console.warn(`[aggregation] item.buyers "${name}": ${detailErrors} detail faktur gagal diambil — hasil mungkin tidak lengkap`);
      // exact match dulu — substring longgar ("Anti Gores Iphone 6" vs "…6S Plus") membuat total bengkak
      const anyExact = scans.some((s) => s.lines.some((l) => l.exact));
      const buyers = new Map<string, Buyer>();
      let matchedInvoices = 0;
      for (const sc of scans) {
        const use = anyExact ? sc.lines.filter((l) => l.exact) : sc.lines;
        if (!use.length) continue;
        matchedInvoices += 1;
        const key = sc.cno || sc.cname || "tanpa-kode";
        const g = buyers.get(key) ?? { customerNo: sc.cno, name: sc.cname, quantity: 0, amount: 0, invoiceCount: 0 };
        for (const l of use) {
          g.quantity += l.qty;
          g.amount += l.amt;
        }
        g.invoiceCount += 1;
        buyers.set(key, g);
      }
      const list = [...buyers.values()].sort((a, b) => b.amount - a.amount);
      const totalQty = list.reduce((s, b) => s + b.quantity, 0);
      const totalAmt = list.reduce((s, b) => s + b.amount, 0);
      const scanTruncated = rows.length > scanned.length;
      return {
        item: name,
        ...(period ? { period: { fromDate: period.from, toDate: period.to } } : {}),
        summary: {
          invoicesInPeriod: rows.length,
          invoicesScanned: scanned.length,
          matchedInvoices,
          buyerCount: list.length,
          totalQuantity: totalQty,
          totalAmount: totalAmt,
          avgUnitPrice: totalQty > 0 ? Math.round(totalAmt / totalQty) : null,
          detailErrors,
          ...(scanTruncated ? { scanTruncated: true } : {}),
          ...(all.truncated ? { listTruncated: true, totalOnServer: all.total } : {}),
        },
        buyers: list,
      };
    }
    case "item.suppliers": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const period = optionalPeriod(args);
      const periodFilter = period ? { transDate: { op: "BETWEEN", value: [period.from, period.to] } } : undefined;
      const all = await listAllPages(execute, "purchaseInvoice.list", {
        ...(periodFilter ? { filter: periodFilter } : {}),
        sort: "id|desc",
      });
      const rows = all.rows;
      const SCAN_CAP = 100;
      const scanned = rows.slice(0, SCAN_CAP);
      const q = name.toLowerCase().replace(/\s+/g, "");
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
      type Sup = { vendorNo: string; name: string; quantity: number; amount: number; invoiceCount: number };
      type ScanLineSup = { qty: number; amt: number; exact: boolean };
      const scans: Array<{ vno: string; vname: string; lines: ScanLineSup[] }> = [];
      let detailErrors = 0;
      const failed: Record<string, unknown>[] = [];
      const scanOne = async (r: Record<string, unknown>) => {
        const d = await executeWithRetry(execute, "purchaseInvoice.detail", { id: r.id });
        const inv = (Array.isArray(d) ? d[0] : d) as Record<string, unknown> | null;
        const items = Array.isArray(inv?.detailItem) ? (inv.detailItem as Array<Record<string, unknown>>) : [];
        const lines: ScanLineSup[] = [];
        for (const it of items) {
          const itemObj = (it.item ?? {}) as Record<string, unknown>;
          const nm = String(it.detailName ?? itemObj.name ?? "").trim();
          if (!nm) continue;
          const nmN = norm(nm);
          if (!nmN.includes(q)) continue;
          lines.push({ qty: Number(it.quantity) || 0, amt: Number(it.totalPrice) || 0, exact: nmN === q });
        }
        if (!lines.length) return;
        const ven = (r.vendor ?? (inv?.vendor as Record<string, unknown>) ?? {}) as Record<string, unknown>;
        const vno = String(r.vendorNo ?? ven.vendorNo ?? "");
        const vname = String(ven.name ?? r.vendorName ?? vno);
        scans.push({ vno, vname, lines });
      };
      await mapPool(scanned, 4, async (r) => {
        try {
          await scanOne(r);
        } catch {
          failed.push(r);
        }
      });
      // retry satu per satu utk faktur yang gagal diambil detailnya (glitch antrean) — jangan sampai 1 faktur bikin hasil salah
      for (const r of failed) {
        try {
          await scanOne(r);
        } catch {
          detailErrors += 1;
        }
      }
      if (detailErrors > 0) console.warn(`[aggregation] item.suppliers "${name}": ${detailErrors} detail faktur gagal diambil — hasil mungkin tidak lengkap`);
      const anyExact = scans.some((s) => s.lines.some((l) => l.exact));
      const suppliers = new Map<string, Sup>();
      let matchedInvoices = 0;
      for (const sc of scans) {
        const use = anyExact ? sc.lines.filter((l) => l.exact) : sc.lines;
        if (!use.length) continue;
        matchedInvoices += 1;
        const key = sc.vno || sc.vname || "tanpa-kode";
        const g = suppliers.get(key) ?? { vendorNo: sc.vno, name: sc.vname, quantity: 0, amount: 0, invoiceCount: 0 };
        for (const l of use) {
          g.quantity += l.qty;
          g.amount += l.amt;
        }
        g.invoiceCount += 1;
        suppliers.set(key, g);
      }
      const list = [...suppliers.values()].sort((a, b) => b.amount - a.amount);
      const totalQty = list.reduce((s, b) => s + b.quantity, 0);
      const totalAmt = list.reduce((s, b) => s + b.amount, 0);
      const scanTruncated = rows.length > scanned.length;
      return {
        item: name,
        ...(period ? { period: { fromDate: period.from, toDate: period.to } } : {}),
        summary: {
          invoicesInPeriod: rows.length,
          invoicesScanned: scanned.length,
          matchedInvoices,
          supplierCount: list.length,
          totalQuantity: totalQty,
          totalAmount: totalAmt,
          avgUnitPrice: totalQty > 0 ? Math.round(totalAmt / totalQty) : null,
          detailErrors,
          ...(scanTruncated ? { scanTruncated: true } : {}),
          ...(all.truncated ? { listTruncated: true, totalOnServer: all.total } : {}),
        },
        suppliers: list,
      };
    }
    case "item.invoices": {
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("name wajib diisi");
      const type = String(args.type ?? "sale") === "purchase" ? "purchase" : "sale";
      const period = optionalPeriod(args);
      const listName = type === "purchase" ? "purchaseInvoice.list" : "salesInvoice.list";
      const detailName = type === "purchase" ? "purchaseInvoice.detail" : "salesInvoice.detail";
      const entity = String(args.entity ?? "").trim();
      const filter: Record<string, unknown> = {};
      if (period) filter.transDate = { op: "BETWEEN", value: [period.from, period.to] };
      let partyLabel = type === "purchase" ? "pemasok" : "pelanggan";
      if (entity) {
        if (type === "purchase") {
          const v = await findVendor(execute, entity);
          if (!v)
            return {
              error: `pemasok "${entity}" tidak ditemukan`,
              hint: "Bila nama ini adalah PELANGGAN, pakai type=\"sale\".",
            };
          filter.vendorNo = String(v.vendorNo ?? "");
        } else {
          const c = await findCustomer(execute, entity);
          if (!c)
            return {
              error: `pelanggan "${entity}" tidak ditemukan`,
              hint: "Bila nama ini adalah PEMASOK, pakai type=\"purchase\".",
            };
          filter.customerNo = String(c.customerNo ?? "");
        }
      }
      const all = await listAllPages(execute, listName, {
        ...(Object.keys(filter).length ? { filter } : {}),
        sort: "id|desc",
      });
      const rows = all.rows.slice(0, 100);
      const q = name.toLowerCase().replace(/\s+/g, "");
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
      type InvRow = {
        number: string;
        transDate: unknown;
        party: string;
        totalAmount: unknown;
        itemQuantity: number;
        itemAmount: number;
      };
      type InvLine = { qty: number; amt: number; exact: boolean };
      const scans: Array<{ r: Record<string, unknown>; party: string; lines: InvLine[] }> = [];
      let detailErrors = 0;
      await mapPool(rows, 4, async (r) => {
        try {
          const d = await executeWithRetry(execute, detailName, { id: r.id });
          const inv = (Array.isArray(d) ? d[0] : d) as Record<string, unknown> | null;
          const items = Array.isArray(inv?.detailItem) ? (inv.detailItem as Array<Record<string, unknown>>) : [];
          const lines: InvLine[] = [];
          for (const it of items) {
            const itemObj = (it.item ?? {}) as Record<string, unknown>;
            const nm = String(it.detailName ?? itemObj.name ?? "").trim();
            if (!nm) continue;
            const nmN = norm(nm);
            if (!nmN.includes(q)) continue;
            lines.push({ qty: Number(it.quantity) || 0, amt: Number(it.totalPrice) || 0, exact: nmN === q });
          }
          if (!lines.length) return;
          const partyObj = (type === "purchase" ? (r.vendor ?? inv?.vendor) : (r.customer ?? inv?.customer)) ?? {};
          const party = String((partyObj as Record<string, unknown>).name ?? r.customerName ?? r.vendorName ?? "");
          scans.push({ r, party, lines });
        } catch {
          detailErrors += 1;
        }
      });
      const anyExact = scans.some((s) => s.lines.some((l) => l.exact));
      const matched: InvRow[] = [];
      for (const sc of scans) {
        const use = anyExact ? sc.lines.filter((l) => l.exact) : sc.lines;
        if (!use.length) continue;
        matched.push({
          number: String(sc.r.number ?? ""),
          transDate: sc.r.transDate,
          party: sc.party,
          totalAmount: sc.r.totalAmount,
          itemQuantity: use.reduce((s, l) => s + l.qty, 0),
          itemAmount: use.reduce((s, l) => s + l.amt, 0),
        });
      }
      matched.sort((a, b) => String(b.transDate ?? "").localeCompare(String(a.transDate ?? "")));
      const scanTruncated = all.rows.length > rows.length;
      return {
        item: name,
        type,
        ...(entity ? { entity } : {}),
        ...(period ? { period: { fromDate: period.from, toDate: period.to } } : {}),
        partyLabel,
        summary: {
          invoicesInPeriod: all.rows.length,
          invoicesScanned: rows.length,
          matchedInvoices: matched.length,
          totalItemQuantity: matched.reduce((s, i) => s + i.itemQuantity, 0),
          totalItemAmount: matched.reduce((s, i) => s + i.itemAmount, 0),
          detailErrors,
          ...(scanTruncated ? { scanTruncated: true } : {}),
          ...(all.truncated ? { listTruncated: true, totalOnServer: all.total } : {}),
        },
        invoices: matched.slice(0, 30),
      };
    }
    case "finance.overview": {
      const { from, to } = periodOf(args);
      const periodFilter = { filter: { transDate: { op: "BETWEEN", value: [from, to] } }, sort: "id|desc" };
      // rekursif ke tool agregasi yang sudah teruji — tanpa duplikasi logika
      const [pl, bs, sales, purchase] = await Promise.all([
        runAggregation("gl.plSummary", { fromDate: from, toDate: to }, ctx, execute),
        runAggregation("gl.bsSummary", { asOfDate: to }, ctx, execute),
        listAllPages(execute, "salesInvoice.list", periodFilter),
        listAllPages(execute, "purchaseInvoice.list", periodFilter),
      ]);
      const plO = pl as { summary: unknown; topAccounts: unknown };
      const bsO = bs as { summary: unknown };
      const sum = (rows: Array<Record<string, unknown>>) =>
        rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0);
      return {
        period: { fromDate: from, toDate: to },
        labaRugi: plO.summary,
        posisiKeuangan: bsO.summary,
        topAccounts: plO.topAccounts,
        penjualan: {
          invoiceCount: sales.rows.length,
          totalSales: sum(sales.rows),
          ...(sales.truncated ? { truncated: true } : {}),
        },
        pembelian: {
          invoiceCount: purchase.rows.length,
          totalPurchase: sum(purchase.rows),
          ...(purchase.truncated ? { truncated: true } : {}),
        },
      };
    }
    case "cashflow.summary": {
      const { from, to } = periodOf(args);
      const periodFilter = { filter: { transDate: { op: "BETWEEN", value: [from, to] } }, sort: "id|desc" };
      // daftar mungkin tak mengembalikan totalAmount di modul tertentu → minta kandidat kolom
      // (Accurate membuang kolom yang tak berlaku; mock menyaring sendiri — aman dua arah)
      const FIELDS = "id,number,transDate,totalAmount,amount,paidAmount,description";
      const amt = (r: Record<string, unknown>): number =>
        Number(r.totalAmount ?? r.amount ?? r.paidAmount ?? r.total ?? 0) || 0;
      const [receipts, pp, exp, oth] = await Promise.all([
        listAllPages(execute, "salesReceipt.list", { fields: FIELDS, ...periodFilter }),
        listAllPages(execute, "purchasePayment.list", { fields: FIELDS, ...periodFilter }),
        listAllPages(execute, "expense.list", { fields: FIELDS, ...periodFilter }),
        listAllPages(execute, "otherPayment.list", { fields: FIELDS, ...periodFilter }),
      ]);
      const tag = (rows: Array<Record<string, unknown>>, source: string) =>
        rows.map((r) => ({ source, number: r.number, transDate: r.transDate, amount: amt(r), description: r.description ?? null }));
      const inEntries = tag(receipts.rows, "penerimaan penjualan");
      const outEntries = [
        ...tag(pp.rows, "pembayaran pembelian"),
        ...tag(exp.rows, "biaya/expense"),
        ...tag(oth.rows, "pengeluaran lain"),
      ];
      const totalCashIn = inEntries.reduce((s, e) => s + e.amount, 0);
      const totalCashOut = outEntries.reduce((s, e) => s + e.amount, 0);
      const group = (entries: typeof inEntries) => {
        const m = new Map<string, { source: string; count: number; total: number }>();
        for (const e of entries) {
          const g = m.get(e.source) ?? { source: e.source, count: 0, total: 0 };
          g.count += 1;
          g.total += e.amount;
          m.set(e.source, g);
        }
        return [...m.values()];
      };
      return {
        period: { fromDate: from, toDate: to },
        summary: {
          totalCashIn,
          totalCashOut,
          netCashFlow: totalCashIn - totalCashOut,
          cashInCount: inEntries.length,
          cashOutCount: outEntries.length,
        },
        breakdown: { masuk: group(inEntries), keluar: group(outEntries) },
        cashIn: inEntries.slice(0, 10),
        cashOut: [...outEntries].sort((a, b) => b.amount - a.amount).slice(0, 10),
        note: "Transfer antar rekening sendiri tidak dihitung sebagai kas masuk/keluar.",
      };
    }
    default:
      throw new Error(`tool agregasi tidak dikenal: ${tool}`);
  }
}
