/**
 * Skill layer Accurate — HEURISTIC ROUTER deterministik (tanpa LLM).
 *
 * Urutan dalam transformToRoute: heuristik dulu → LLM router → tool loop.
 * Heuristik hanya mengembalikan Route bila YAKIN (regex ketat + guard ambigu).
 * Miss → jatuh ke LLM router (perilaku lama tidak berubah).
 *
 * Manfaat: routing <1ms, 0 token, hasil konsisten berapa pun model LLM-nya.
 * Jawaban akhir disusun formatter template (bukan LLM) → angka selalu dari data.
 */

const MONTHS: Record<string, number> = {
  januari: 1, jan: 1, februari: 2, pebruari: 2, feb: 2, maret: 3, mar: 3,
  april: 4, apr: 4, mei: 5, juni: 6, jun: 6, juli: 7, jul: 7,
  agustus: 8, agu: 8, september: 9, sep: 9, oktober: 10, okt: 10, okto: 10,
  november: 10 + 1, nov: 11, desember: 12, des: 12,
};
const QUARTER: Record<string, [number, number]> = {
  i: [1, 3], ii: [4, 6], iii: [7, 9], iv: [10, 12], "1": [1, 3], "2": [4, 6], "3": [7, 9], "4": [10, 12],
};

const p2 = (n: number) => String(n).padStart(2, "0");
const allRange = { fromDate: "01/01/1950", toDate: "31/12/2100" };
const endOfMonth = (y: number, m: number) => `${p2(new Date(y, m, 0).getDate())}/${p2(m)}/${y}`;

export interface PeriodArgs {
  fromDate?: string;
  toDate?: string;
  asOfDate?: string;
}

/** parse periode dari teks. default = TANPA tanggal (biar tool pakai defaultnya). */
function parsePeriod(msg: string): PeriodArgs {
  const m = msg.toLowerCase();
  if (/\b(selama ini|sepanjang masa|seluruh periode|semua periode|selama tahun berjalan|tanpa batas|sepanjang waktu)\b/.test(m))
    return { ...allRange };

  // per 31/12/2016 | per tanggal 31/12/2016 | pada 31/12/2016
  const perDate = m.match(/\b(?:per|pada|tanggal)\s+(?:tanggal\s+)?(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (perDate) {
    const d = `${p2(+perDate[1])}/${p2(+perDate[2])}/${perDate[3]}`;
    return { fromDate: d, toDate: d, asOfDate: d };
  }
  // rentang dua tanggal: dari 01/01/2016 sampai 31/03/2016
  const rangeDates = m.match(/\bdari\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(?:sampai|hingga|ke|s\.d\.)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (rangeDates) {
    return {
      fromDate: `${p2(+rangeDates[1])}/${p2(+rangeDates[2])}/${rangeDates[3]}`,
      toDate: `${p2(+rangeDates[4])}/${p2(+rangeDates[5])}/${rangeDates[6]}`,
    };
  }
  // kuartal
  const q = m.match(/\bkuartal\s+(i{1,3}v?|iv|1|2|3|4)\s+(20\d{2})\b/);
  if (q && QUARTER[q[1]]) {
    const [m1, m2] = QUARTER[q[1]];
    return { fromDate: `01/${p2(m1)}/${q[2]}`, toDate: endOfMonth(+q[2], m2) };
  }
  // bulan X tahun Y | X Y (bln name)
  const month = m.match(/\b(?:bulan\s+)?([a-z]+)\s+(20\d{2})\b/);
  if (month && MONTHS[month[1]]) {
    const mm = MONTHS[month[1]];
    return { fromDate: `01/${p2(mm)}/${month[2]}`, toDate: endOfMonth(+month[2], mm) };
  }
  // "bulan ini" / "tahun ini"
  if (/\bbulan ini\b/.test(m)) {
    const now = new Date();
    return { fromDate: `01/${p2(now.getMonth() + 1)}/${now.getFullYear()}`, toDate: endOfMonth(now.getFullYear(), now.getMonth() + 1) };
  }
  // tahun Y → asOf 31/12 utk neraca; utk summary pakai range tahun
  const year = m.match(/\b(20\d{2})\b/);
  if (year) {
    return { fromDate: `01/01/${year[1]}`, toDate: `31/12/${year[1]}`, asOfDate: `31/12/${year[1]}` };
  }
  return {};
}

function periodArgs(p: PeriodArgs, kind: "range" | "asOf" = "range"): Record<string, unknown> {
  if (kind === "asOf") return p.asOfDate ? { asOfDate: p.asOfDate } : {};
  const out: Record<string, unknown> = {};
  if (p.fromDate) out.fromDate = p.fromDate;
  if (p.toDate) out.toDate = p.toDate;
  return out;
}

/* ───────────────── guard: pertanyaan ambigu/majemuk → miss ───────────────── */

function isAmbiguous(msg: string): boolean {
  const m = msg.toLowerCase();
  // ≥2 kata tanya → pertanyaan majemuk/berantai
  const questionWords = m.match(/\b(berapa|siapa|kapan|apa saja|mana|yang mana)\b/g) ?? [];
  if (questionWords.length >= 2) return true;
  if (/\b(apa saja|dan mana|mana yang lebih|yang mana)\b/.test(m) && questionWords.length >= 1 && /,|dan /.test(m)) return true;
  // komparatif / dua periode
  if (/\b(bandingkan|dibandingkan|dibanding|berbanding|perbandingan|selisih|kenaikan|penurunan|naik|turun|masing-masing|kedua|keduanya|atau\b)[^?]*/.test(m) && /20\d{2}|\bpenjualan\b|\bpembelian\b/.test(m)) return true;
  if (/\bvs\b/.test(m)) return true;
  const years = new Set(m.match(/20\d{2}/g) ?? []);
  if (years.size >= 2) return true;
  // dua objek laporan berbeda dipisah "dan"
  if (/\bdan\b/.test(m)) {
    const objs = ["penjualan", "pembelian", "piutang", "utang", "laba", "rugi", "aset", "neraca", "kas", "stok", "gudang", "jurnal", "retur"].filter((o) => m.includes(o));
    if (objs.length >= 2) return true;
  }
  // saldo kartu master (bukan outstanding) → butuh detail entitas, bukan agregasi
  if (/\bsaldo\b|\bkartu\b/.test(m)) return true;
  // fakturnya paling banyak → perCustomer urut nilai, bukan urut jumlah
  if (/fakturnya paling banyak|paling banyak faktur|jumlah faktur terbanyak/.test(m)) return true;
  // data master penuh (stok/urutan) → item.list, bukan agregasi topSelling
  if (/\bstok\b|\bstock\b/.test(m)) return true;
  // "terkecil/paling sedikit" — agregasi selalu urut menurun → biarkan loop yang sort naik
  if (/\bterkecil\b|\bpaling kecil\b|\bpaling sedikit\b|\bterendah\b|\bpaling rendah\b/.test(m)) return true;
  // status pembayaran spesifik → butuh scan status, bukan summary
  if (/\blunas\b|belum lunas|jatuh tempo|tertunggak/.test(m)) return true;
  if (/\bpertama\b/.test(m)) return true;
  return false;
}

/* ───────────────── ekstraksi nama entitas ───────────────── */

const ENTITY_RE = /\b(?:dari|untuk|ke|pada|oleh)?\s*(pelanggan|pemasok|vendor|supplier|konsumen|mitra)\s+(?<n>[^?!]{2,120}?)(?=\s*[?!]|\s*$)/i;
const NAME_STOP = /^(mana|siapa|apa|terbesar|terbanyak|terkecil|tersebut|itu|saya|kami|anda|dengan|yang|ini|adalah|para|semua|saya)\b/i;

function cleanEntityName(raw: string): string | null {
  let n = raw
    .replace(/\s+/g, " ")
    // potong di frasa relatif: "… yang isinya barang X" / "… yang memuat barang X"
    .replace(/\b(?:yang\s+)?(?:isinya|memuat|mengandung|berisi|termuat)\b.*$/i, "")
    .replace(
      /\b(tahun|kuartal|bulan|periode|pada|selama|sepanjang|masa|ini|semua|seluruh|yang belum|lunas|dari|sampai|hingga|sepanjang masa|selama ini|ke|dan|ada|berapa|total|sekarang|saat ini|hingga kini)\b.*$/i,
      ""
    )
    .replace(/[.,;:!?]+$/g, "")
    .trim();
  n = n.replace(/^(?:dari|untuk|ke|pada|yaitu|adalah)\s+/i, "").replace(/[.,;:!?]+$/g, "").trim();
  if (n.length < 2) return null;
  if (NAME_STOP.test(n)) return null;
  if (/^\d+$/.test(n)) return null;
  return n;
}

function extractEntity(msg: string): { party: string; name: string } | null {
  const hit = ENTITY_RE.exec(msg);
  if (!hit?.groups) return null;
  const name = cleanEntityName(hit.groups.n);
  if (!name) return null;
  return { party: hit[1].toLowerCase(), name };
}

/* ───────────────── utama ───────────────── */

/**
 * skip = pola dikenali PASTI tak punya 1 tool agregasi → caller langsung ke
 * tool loop TANPA LLM router (hemat 1-3 dtk + token, bebas model).
 * null = miss → LLM router seperti biasa.
 */
function skipPattern(msg: string): boolean {
  const m = msg.toLowerCase();
  // status pembayaran spesifik (lunas/belum/jatuh tempo) → scan status, bukan summary
  if (/\blunas\b|belum bayar|jatuh tempo|tertunggak/.test(m)) return true;
  // saldo/kartu master → butuh .list balance per entitas, bukan agregasi outstanding
  if (/\bsaldo\b|\bkartu\b/.test(m)) return true;
  // daftar/count modul niche: "…yang tercatat/terdaftar/di sistem"
  if (/\btercatat\b|\bterdaftar\b|\bdi sistem\b|\byang ada\b/.test(m)) {
    // kecuali frasa ringkasan faktur/pembelian/laporan resmi
    if (!/(total\s+(?:nilai\s+)?penjualan|total\s+(?:nilai\s+)?pembelian|laporan\s+keuangan|laporan\s+laba|rata[-\s]?rata)/.test(m))
      return true;
  }
  return false;
}

export type HeurResult = { kind: "route"; tool: string; args: Record<string, unknown> } | { kind: "skip" };

/**
 * Route presisi yang mendahului skipPattern & guard ambigu — untuk pola yang
 * PASTI punya jawaban deterministik dari SATU tool agregasi:
 * - top-3 piutang/utang (lolos skip "belum lunas" & ambigu "berapa … dan berapa")
 * - jatuh tempo paling dekat (sort server salah utk dd/mm/yyyy → earliestDue klien)
 * - faktur terbesar sepanjang masa (tanpa periode; dua sisi → invoice.biggestBoth)
 * - dua periode total/selisih/count/rata-rata → summaryMulti (server yg hitung)
 * - tri bulanan (total + jumlah faktur + pelanggan terbesar) → summary + topByCustomer
 */
function preciseRoute(msg: string): { tool: string; args: Record<string, unknown> } | null {
  const m = msg.toLowerCase().trim();
  if (!m || m.length > 600) return null;

  // aset tetap dibeli tahun X → fixedAsset.summary (hitung transDate per tahun, presisi semua halaman)
  const faYear = m.match(/\baset\s+tetap\b[^.?!]*\bdibeli(?:\s+pada)?\s+tahun\s+(20\d{2})/);
  if (faYear) return { tool: "fixedAsset.summary", args: { year: Number(faYear[1]) } };

  // tahun dengan jurnal umum TERBANYAK → yearSummary (grouping transDate, bukan nomor JV)
  if (/\bjurnal\b/.test(m) && /\btahun\s+berapa\b/.test(m) && /(paling\s+banyak|terbanyak)/.test(m)) {
    return { tool: "journalVoucher.yearSummary", args: {} };
  }

  // stok paling sedikit → item.zeroStock (SEMUA item qty 0, presisi semua halaman)
  if (/\bstok\w*\b|\bstock\b/.test(m) && /(paling\s+sedikit|paling\s+kecil|terkecil|terendah|paling\s+rendah)/.test(m)) {
    return { tool: "item.zeroStock", args: {} };
  }

  // jenis barang + total stok + gudang → item.stockOverview (jumlah & total presisi, termasuk jumlah gudang)
  if (/gudang/.test(m) && /(stok\w*|jenis\s+barang)/.test(m) && /berapa|jumlah|total/.test(m)) {
    return { tool: "item.stockOverview", args: {} };
  }

  // aturan penomoran otomatis / auto number → autoNumber.summary (hitung presisi, bukan perkiraan model)
  if (/(penomoran\s+otomatis|nomor\s+otomatis|auto[\s-]?number)/.test(m) && /berapa|jumlah|terdaftar/.test(m)) {
    return { tool: "autoNumber.summary", args: {} };
  }

  // piutang + utang usaha dalam satu pertanyaan (tanpa periode) → arap.summary (kedua total + selisih presisi)
  if (
    /\bpiutang\b/.test(m) &&
    /\b(?:utang|hutang)\b/.test(m) &&
    !/\btahun\b|\bbulan\b|20\d{2}|\bperiode\b|\bdari\s+transaksi\b/.test(m) &&
    /berapa|total|lebih\s+besar|kedua|selisih/.test(m)
  ) {
    return { tool: "arap.summary", args: {} };
  }

  // retur penjualan + retur pembelian dalam satu pertanyaan → return.summaryBoth (presisi, bukan dua panggilan model)
  if (/\bretur\s+penjualan\b/.test(m) && /\bretur\s+pembelian\b/.test(m) && /berapa|total|besar|selisih/.test(m)) {
    return { tool: "return.summaryBoth", args: {} };
  }

  // bukti penerimaan penjualan tahun X → salesReceipt.yearCount (hitung transDate presisi, bukan nomor)
  const srYear = m.match(/\btahun\s+(20\d{2})/);
  if (
    srYear &&
    /berapa|jumlah/.test(m) &&
    /(bukti\s+penerimaan\s+penjualan|penerimaan\s+penjualan|kwitansi\s+penerimaan|sales\s*receipt|sales\s*receipt)/.test(m)
  ) {
    return { tool: "salesReceipt.yearCount", args: { year: Number(srYear[1]) } };
  }

  // surat jalan tahun X → deliveryOrder.yearCount (hitung transDate presisi, bukan list + hitung manual)
  if (srYear && /berapa|jumlah/.test(m) && /surat\s+jalan/.test(m)) {
    return { tool: "deliveryOrder.yearCount", args: { year: Number(srYear[1]) } };
  }

  // stok paling banyak/terbanyak (barang) → item.topStock (urut quantity presisi; stockOverview tak menyebut nama)
  if (
    /\bstok\w*\b|\bstock\b/.test(m) &&
    /(paling\s+banyak|terbanyak|paling\s+besar|terbesar|paling\s+tinggi|tertinggi)/.test(m) &&
    !/(paling\s+sedikit|terkecil|terendah|paling\s+rendah)/.test(m) &&
    !/\bgudang\b/.test(m)
  ) {
    return { tool: "item.topStock", args: { limit: /\btiga\b/.test(m) ? 3 : 10 } };
  }

  // jumlah faktur lunas/belum lunas (global 1 tahun, tanpa entitas/top) → invoice.statusCounts (hitung presisi)
  if (
    /\blunas\b/.test(m) &&
    /\bfaktur\b/.test(m) &&
    /berapa|jumlah/.test(m) &&
    !/\bbulan\b|\bkuartal\b|\bperiode\b|\bmaret\b|\bpekan\b|\bminggu\b|\bjatuh\s+tempo\b|\bpiutang\b|\butang\b|\bhutang\b|\bpelanggan\b|\bpemasok\b|\bcustomer\b|\bvendors?\b|\btiga\b|\bterbesar\b|\bterbanyak\b/.test(m)
  ) {
    const side = /\bpembelian\b|\bpurchase\b/.test(m) ? "purchase" : "sales";
    const lunasYears = [...m.matchAll(/\btahun\s+(20\d{2})\b/g)].map((x) => x[1]);
    if (lunasYears.length === 1) {
      const y = lunasYears[0];
      return { tool: "invoice.statusCounts", args: { side, fromDate: `01/01/${y}`, toDate: `31/12/${y}` } };
    }
    if (lunasYears.length === 0) return { tool: "invoice.statusCounts", args: { side } };
    // ≥2 tahun → jatuh ke aturan berikutnya (summaryMulti dua periode dst.)
  }

  // penjualan/pembelian pelanggan/pemasok naik/turun dari tahun X ke tahun Y → party.yoySummary (total per tahun presisi)
  const yoyM = m.match(/\bdari\s+tahun\s+(20\d{2})\s+ke\s+(?:tahun\s+)?(20\d{2})/);
  if (yoyM && /(naik|turun|berubah|dibanding)/.test(m)) {
    const ent = extractEntity(m);
    const name = ent?.name.replace(/\s+(?:naik|turun|berubah|dibanding(?:kan)?)\b.*$/, "").trim();
    if (ent && name) {
      return {
        tool: "party.yoySummary",
        args: { party: ent.party === "pemasok" || ent.party === "vendor" || ent.party === "supplier" ? "vendor" : "customer", name, year1: Number(yoyM[1]), year2: Number(yoyM[2]) },
      };
    }
  }

  // rata-rata satuan pembelian barang X (sepanjang masa) → item.suppliers (avg dihitung formatter/JSON, jangan model)
  const avgItem = m.match(/\brata[-\s]?rata\s+(?:harga\s+)?satuan\s+(?:pembelian|harga\s+beli)\s+(?:barang\s+)?(.+?)(?:\s+sepanjang\s+masa)?(?:\s*saja)?\s*[?!.]*$/);
  if (avgItem && avgItem[1].trim().length >= 3) {
    return { tool: "item.suppliers", args: { name: avgItem[1].trim() } };
  }

  // top-3 piutang/utang belum lunas
  if (/\btiga\s+(?:pelanggan|customer|pemasok|vendor)\b/.test(m)) {
    if (/\bpiutang\b/.test(m)) return { tool: "receivables.summary", args: { limit: 3 } };
    if (/\butang\b/.test(m)) return { tool: "payables.summary", args: { limit: 3 } };
  }

  // jatuh tempo paling dekat di antara yang belum lunas
  if (/\bjatuh tempo\w*\b/.test(m) && /\bpaling dekat\b|\bterdekat\b/.test(m)) {
    return { tool: "receivables.summary", args: { limit: 10 } };
  }

  // faktur penjualan/pembelian terbesar (tanpa periode) — dua sisi → invoice.biggestBoth (urut presisi server; model pernah salah urut)
  const twoSide = /\bfaktur\s+penjualan\s+terbesar\b/.test(m) && /\bfaktur\s+pembelian\s+terbesar\b/.test(m);
  if (twoSide && !/\btahun\b|\bbulan\b|\b20\d{2}\b/.test(m)) {
    return { tool: "invoice.biggestBoth", args: {} };
  }
  if (!twoSide) {
    const bigInv = m.match(/\bfaktur\s+(penjualan|pembelian)\s+terbesar\b/);
    if (bigInv && !/\btahun\b|\bbulan\b|\b20\d{2}\b/.test(m)) {
      return { tool: bigInv[1] === "penjualan" ? "salesInvoice.summary" : "purchaseInvoice.summary", args: { ...allRange } };
    }
  }

  // dua periode (total / selisih / jumlah faktur / rata-rata / pelanggan aktif / faktur lunas penjualan; total & selisih pembelian)
  const multi = multiPeriodArgs(m);
  if (
    multi &&
    /(total\s+(?:nilai\s+)?penjualan|total\s+(?:nilai\s+)?pembelian|selisih[^.?!]*penjualan|selisih[^.?!]*pembelian|berapa\s+(?:faktur|jumlah\s+faktur)\s+penjualan\s+bulan|rata[-\s]?rata[^.?!]*penjualan|pelanggan\s+aktif[^.?!]*penjualan|berapa\s+faktur\s+penjualan\s+lunas)/.test(m)
  ) {
    const tool = /\bpembelian\b/.test(m) && !/\bpenjualan\b/.test(m) ? "purchaseInvoice.summaryMulti" : "salesInvoice.summaryMulti";
    return { tool, args: multi };
  }

  // tri bulanan: "total penjualan bulan X, ada berapa faktur, dan siapa pelanggan terbesarnya?"
  const tri = m.match(/\btotal\s+penjualan\s+bulan\s+([a-z]+)\s+(20\d{2})\b/);
  if (tri && MONTHS[tri[1]] && /\bsiapa\b/.test(m)) {
    const mm = MONTHS[tri[1]];
    return {
      tool: "salesInvoice.summary",
      args: { fromDate: `01/${p2(mm)}/${tri[2]}`, toDate: endOfMonth(+tri[2], mm) },
    };
  }
  return null;
}

/** ekstrak DUA periode pertama dari pesan: "bulan Nov 2016 dan bulan Des 2016" | "tahun 2016 dan 2017" */
function multiPeriodArgs(m: string): Record<string, unknown> | null {
  const periods: { label: string; from: string; to: string }[] = [];
  const seen = new Set<string>();
  for (const hit of m.matchAll(/\b(?:bulan\s+)?([a-z]+)\s+(20\d{2})\b/g)) {
    const mm = MONTHS[hit[1]];
    if (!mm) continue;
    const key = `${mm}/${hit[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = `${hit[1][0].toUpperCase()}${hit[1].slice(1)} ${hit[2]}`;
    periods.push({ label, from: `01/${p2(mm)}/${hit[2]}`, to: endOfMonth(+hit[2], mm) });
    if (periods.length >= 2) break;
  }
  if (periods.length < 2) {
    const years: string[] = [];
    for (const hit of m.matchAll(/\btahun\s+(20\d{2})\b/g)) if (!years.includes(hit[1])) years.push(hit[1]);
    if (years.length < 2) return null;
    return {
      fromDate1: `01/01/${years[0]}`, toDate1: `31/12/${years[0]}`, label1: `tahun ${years[0]}`,
      fromDate2: `01/01/${years[1]}`, toDate2: `31/12/${years[1]}`, label2: `tahun ${years[1]}`,
    };
  }
  return {
    fromDate1: periods[0].from, toDate1: periods[0].to, label1: periods[0].label,
    fromDate2: periods[1].from, toDate2: periods[1].to, label2: periods[1].label,
  };
}

export function heuristicRoute(msg: string): HeurResult | null {
  const precise = preciseRoute(msg);
  if (precise) return { kind: "route", ...precise };
  if (skipPattern(msg)) return { kind: "skip" };
  const r = tryRoute(msg);
  return r ? { kind: "route", ...r } : null;
}

function tryRoute(msg: string): { tool: string; args: Record<string, unknown> } | null {
  const m = msg.toLowerCase().trim();
  if (!m || m.length > 600) return null;
  if (isAmbiguous(msg)) return null;
  const period = parsePeriod(m);
  const range = periodArgs(period, "range");

  /* — jurnal umum: jumlah & total (dihitung server; jangan journalVoucher.list manual) — */
  if (/\bjurnal\b/.test(m)) {
    return { tool: "journalVoucher.summary", args: { ...range } };
  }
  /* — retur penjualan / retur pembelian (satu sisi; dua sisi = ambigu, sudah null di atas) — */
  const retS = /\bretur\s+penjualan\b/.test(m);
  const retP = /\bretur\s+pembelian\b/.test(m);
  if (retS !== retP) {
    return { tool: retS ? "salesReturn.summary" : "purchaseReturn.summary", args: { ...range } };
  }

  /* — hubungan barang ↔ pihak — */
  // "berapa total unit X yang terjual" → item.buyers (summary.totalQuantity) — jangan item.byName (itu stok)
  const totUnit = m.match(/(?:^|[^\w])berapa\s+(?:total\s+)?(?:unit|jumlah)\s+(?<n>[^?,.!]+?)\s+yang\s+terjual\b/);
  if (totUnit?.groups?.n) {
    return { tool: "item.buyers", args: { name: cleanItemName(totUnit.groups.n), ...range } };
  }
  // "berapa nilai penjualan total barang X sepanjang masa" → item.buyers (total presisi; nama di-pin dari kalimat, model sering nambah argumen tanggal sendiri)
  const nilaiJual = m.match(/^(?:berapa\s+)?nilai\s+penjualan\s+total\s+barang\s+([^?,.!]+?)\s*(?:sepanjang\s+masa)?\s*[?!.]*$/);
  if (nilaiJual?.[1]) {
    const nmJual = cleanItemName(nilaiJual[1]);
    if (nmJual.length >= 3) return { tool: "item.buyers", args: { name: nmJual, ...range } };
  }
  // pembeli barang X → item.buyers
  const buyers = m.match(/\b(?:pernah membeli|membeli|membelinya)[^.?!]*\bbarang\s+(?<n>[^.?!]+)/i) ?? m.match(/\bbarang\s+(?<n>[^.?!]+?)\s+(?:dibeli|dipesan oleh|diterima)\b/i);
  const buyName = (buyers as RegExpMatchArray | null)?.groups?.n ?? (buyers ? (buyers as RegExpMatchArray)[1] : undefined);
  if (buyName && !/pemasok|vendor|supplier/i.test(buyName) && /pelanggan|pembeli|siapa/.test(m) && !/^(apa|apa saja|semua|ini|itu|yang)\b/i.test(buyName.trim())) {
    return { tool: "item.buyers", args: { name: cleanItemName(buyName), ...range } };
  }
  // barang disuplai/dari pemasok X → vendor.itemsByName (prioritas atas item.suppliers)
  const venItems = extractEntity(msg);
  if (venItems && /barang|produk/i.test(m) && /\b(disuplai|dari|dibeli dari|pemasok|vendor|supplier)\b/i.test(m) && /\bbarang\s+apa\s+saja|barang\s+apa\s+yang\b/i.test(m)) {
    const tool = venItems.party.match(/pelanggan|konsumen/) ? "customer.itemsByName" : "vendor.itemsByName";
    return { tool, args: { name: venItems.name, ...range } };
  }
  // pemasok yang memasok barang X → item.suppliers
  const suppl = m.match(/\b(?:memasok|mensupply|memasoknya|pemasok\s+mana|suplier\s+mana|supplier\s+mana|menyuplai)[^.?!]*\bbarang\s+(?<n>[^.?!]+)/i);
  if (suppl?.groups?.n) {
    return { tool: "item.suppliers", args: { name: cleanItemName(suppl.groups.n), ...range } };
  }
  // faktur memuat/mengandung barang X → item.invoices
  const inFaktur = m.match(/\b(?:memuat|mengandung|isinya|berisi|termuat)\b[^?!]*\bbarang\s+(?<n>[^.?!]+)/i);
  if (inFaktur?.groups?.n) {
    const isPurchase = /\bpembelian\b|\bdari\s+(?:pemasok|vendor|supplier)\b|\bbeli\b/i.test(m);
    const args: Record<string, unknown> = { name: cleanItemName(inFaktur.groups.n), type: isPurchase ? "purchase" : "sale" };
    if (isPurchase) {
      const v = extractEntity(msg);
      if (v && !v.party.match(/pelanggan|konsumen/)) args.entity = v.name;
    }
    return { tool: "item.invoices", args };
  }
  // barang apa saja yang dibeli/disuplai pihak X → itemsByName
  if (/barang\s+apa\s+saja/i.test(m) && venItems) {
    const tool = venItems.party.match(/pelanggan|konsumen/) ? "customer.itemsByName" : "vendor.itemsByName";
    return { tool, args: { name: venItems.name, ...range } };
  }

  /* — ranking — */
  if (/\b(paling laris|terlaris|paling banyak terjual|paling besar nilainya|penjualannya paling besar|top\s*selling)\b/.test(m) && /barang|produk|item/i.test(m)) {
    const args: Record<string, unknown> = { ...range };
    const lim = m.match(/\btiga\b/) ? 3 : m.match(/\blima\b/) ? 5 : m.match(/\bdua\b/) ? 2 : undefined;
    if (lim) args.limit = lim;
    return { tool: "item.topSelling", args };
  }
  /* — "cari N pelanggan/pemasok" — user hanya minta N baris — */
  // tanpa limit, perCustomer menjawab semua pelanggan + total + terkecil (kepanjangan)
  const wordNum: Record<string, number> = { dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10 };
  const nParty =
    m.match(/\b(?:cari|temukan|tampilkan|sebutkan|daftar|urutkan|pilih|ambil|tunjukkan|siapa)\b[^.?!]*\b(\d{1,2}|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\b\s*(?:pelanggan|customer|pembeli|pemasok|vendor|supplier)\b/) ??
    m.match(/\b(\d{1,2}|dua|tiga|empat|lima)\b\s+(?:pelanggan|customer|pembeli|pemasok|vendor|supplier)\b[^.?!]*\b(?:terbesar|terbanyak|paling\s+banyak)\b/);
  if (nParty && !/\bpiutang\b|\butang\b|\bhutang\b|\bbelum\s+lunas\b|\bjatuh\s+tempo\b|\bbarang\b|\bproduk\b|\bretur\b/.test(m)) {
    const n = Number(nParty[1]) || wordNum[nParty[1]] || 0;
    const partyChunk = m.slice(nParty.index ?? 0, (nParty.index ?? 0) + nParty[0].length);
    const isVendor = /pemasok|vendor|supplier/.test(partyChunk);
    if (n >= 1 && n <= 20) {
      return { tool: isVendor ? "purchaseInvoice.perVendor" : "salesInvoice.perCustomer", args: { limit: n, ...range } };
    }
  }

  // pelanggan bertransaksi tahun Y → count via perCustomer
  if (/\bpelanggan\b[^?!]*\bbertransaksi\b/.test(m)) {
    return { tool: "salesInvoice.perCustomer", args: { ...range } };
  }
  if (/\bpemasok\b[^?!]*\bbertransaksi\b/.test(m)) {
    return { tool: "purchaseInvoice.perVendor", args: { ...range } };
  }
  // penjualan terbesar per pelanggan
  if (
    /(?:siapa|pelanggan mana|pelanggan apa|urutkan|daftar|sebutkan)[^.?!]*\bpelanggan\b/.test(m) &&
    /(terbesar|terbanyak|paling banyak|terkecil|penjualan terbesar|penjualan terbanyak)/.test(m) &&
    !/\bbarang\b/.test(m)
  ) {
    return { tool: "salesInvoice.perCustomer", args: { ...range } };
  }
  if (
    /(?:siapa|pemasok mana|pemasok apa|urutkan|daftar|sebutkan)[^.?!]*\bpemasok\b/.test(m) &&
    /(terbesar|terbanyak|paling banyak|terkecil)/.test(m)
  ) {
    return { tool: "purchaseInvoice.perVendor", args: { ...range } };
  }

  /* — entitas bernama — */
  const ent = extractEntity(msg);
  if (ent) {
    const isCust = !!ent.party.match(/pelanggan|konsumen/);
    const partyWord = isCust ? "pelanggan" : "pemasok";
    // piutang belum dibayar / utang belum dibayar
    if (/\b(belum dibayar|piutang belum|utang belum|belum bayar|terutang|menunggak)\b/.test(m)) {
      return { tool: isCust ? "customer.unpaidByName" : "vendor.unpaidByName", args: { name: ent.name } };
    }
    // faktur/pembelian terakhir
    if (/\b(terakhir|terbaru|kapan)\b/.test(m)) {
      return { tool: isCust ? "customer.lastOrderByName" : "vendor.lastPurchaseByName", args: { name: ent.name } };
    }
    // barang (bila belum kena rules barang di atas)
    if (/\bbarang\b|\bproduk\b/.test(m) && !/berapa\s+unit|berapa\s+nilai|unit\b/.test(m)) {
      return { tool: isCust ? "customer.itemsByName" : "vendor.itemsByName", args: { name: ent.name, ...range } };
    }
    // ringkasan penjualan/pembelian pihak X
    if (isCust && /\b(penjualan|faktur|pesanan|penjualan sepanjang|tagihan)\b/.test(m)) {
      return { tool: "customer.summaryByName", args: { name: ent.name, ...range } };
    }
    if (!isCust && /\b(pembelian|beli|faktur|pesanan)\b/.test(m)) {
      return { tool: "vendor.summaryByName", args: { name: ent.name, ...range } };
    }
    void partyWord;
  }

  /* — ringkasan umum — */
  // dokumen non-faktur (retur, surat pesanan, penawaran, surat jalan, dst) → modul lain, miss
  const otherDocs = /\b(retur|surat\s+pesanan|penawaran|penerimaan\s+barang|surat\s+jalan|quotation|receipt|permintaan\s+pembelian|pr\s+penjualan|do\s+pengiriman)\b/i.test(m);
  // piutang usaha
  if (!otherDocs && /\bpiutang\b/.test(m) && !/\bpelanggan\b/.test(m) && !/per pelanggan|nama pelanggan/.test(m)) {
    return { tool: "receivables.summary", args: { ...range } };
  }
  // utang usaha
  if (!otherDocs && /\butang\b/.test(m) && !/\bpemasok\b|\bvendor\b/.test(m) && !/per pemasok|nama pemasok/.test(m)) {
    return { tool: "payables.summary", args: { ...range } };
  }
  // laba rugi
  if (/\b(laba|rugi|profit)\b/.test(m) && !/\bdan\b/.test(m)) {
    return { tool: "gl.plSummary", args: { ...range } };
  }
  // posisi keuangan / neraca
  if (/\b(posisi keuangan|neraca|balance\s*sheet|total aset|jumlah aset)\b/.test(m)) {
    return { tool: "gl.bsSummary", args: periodArgs(period, "asOf") };
  }
  // arus kas
  if (/\barus kas\b|\bcash\s*flow\b/.test(m)) {
    return { tool: "cashflow.summary", args: { ...range } };
  }
  // laporan keuangan lengkap
  if (/\blaporan keuangan\b/.test(m) && !/\bdan\b/.test(m)) {
    return { tool: "finance.overview", args: { ...range } };
  }
  // ringkasan penjualan — wajib frasa faktur/total penjualan (bukan retur/surat pesanan)
  if (!otherDocs && /\bpenjualan\b/.test(m) && !/\bbarang\b|\bstok\b|\bsiapa\b/.test(m)) {
    if (/(faktur\s+penjualan|total\s+(?:nilai\s+)?penjualan|jumlah\s+(?:faktur\s+)?penjualan|berapa\s+(?:total\s+)?penjualan|rata[-\s]?rata[^.?!]*penjualan|rekap[^.?!]*penjualan|ringkas[^.?!]*penjualan)/.test(m)) {
      // "faktur penjualan mana yang terbesar" tanpa periode → sepanjang data (bukan bulan berjalan)
      const args = Object.keys(range).length === 0 && /faktur/.test(m) && /(terbesar|terbanyak|paling besar|tertinggi)/.test(m) ? { ...allRange } : { ...range };
      return { tool: "salesInvoice.summary", args };
    }
  }
  // ringkasan pembelian — wajib frasa faktur/total pembelian
  if (!otherDocs && /\bpembelian\b/.test(m) && !/\bbarang\b|\bstok\b|\bsiapa\b/.test(m)) {
    if (/(faktur\s+pembelian|total\s+(?:nilai\s+)?pembelian|jumlah\s+(?:faktur\s+)?pembelian|berapa\s+(?:total\s+)?pembelian|rata[-\s]?rata[^.?!]*pembelian|rekap[^.?!]*pembelian|ringkas[^.?!]*pembelian)/.test(m)) {
      const args = Object.keys(range).length === 0 && /faktur/.test(m) && /(terbesar|terbanyak|paling besar|tertinggi)/.test(m) ? { ...allRange } : { ...range };
      return { tool: "purchaseInvoice.summary", args };
    }
  }

  return null;
}

function cleanItemName(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\b(yang|dari|pada|untuk|adalah|itu|tersebut|selama|sepanjang|masa|ini|tahun|bulan|periode)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
