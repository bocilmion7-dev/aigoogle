/** Generator 500 soal bench + GROUND TRUTH programatik dari snapshot500.json
 *  Jalankan: npx tsx --env-file=/root/aigoogle/.env scripts/gen500.ts
 *  Output: /tmp/opencode/questions500.json  [{tier,q,must,module}] */
import { readFileSync, writeFileSync } from "node:fs";

const SNAP = process.env.SNAP ?? "/tmp/opencode/snapshot500.json";
const OUT = process.env.OUT ?? "/tmp/opencode/questions500.json";

const snap = JSON.parse(readFileSync(SNAP, "utf8")) as {
  modules: Record<string, { tool: string; total: number; rows: Array<Record<string, any>>; details?: Record<string, any> }>;
};
const M = snap.modules;

type Q = { tier: number; q: string; must: string[]; module: string };
const out: Q[] = [];
const seen = new Set<string>();
function Q(tier: number, q: string, must: (string | RegExp)[], module: string) {
  const key = q.trim();
  if (seen.has(key)) return false;
  if (must.length === 0) return false;
  seen.add(key);
  out.push({
    tier,
    q: key,
    must: must.map((m) => (m instanceof RegExp ? m.source : /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(m) ? dateRe(m) : m)),
    module,
  });
  return true;
}

/* ---------- helpers ---------- */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** regex angka utk ribuan Indonesia: 8351398765 → 8[.,\s]?351[.,\s]?398[.,\s]?765
 *  (integer-part saja — aman utk nilai berdesimal) */
function numRe(n: number | string): string {
  const [intPart] = String(typeof n === "number" ? Math.trunc(n) : n).split(".");
  const neg = intPart.startsWith("-");
  const digits = neg ? intPart.slice(1) : intPart;
  const chunks: string[] = [];
  for (let i = digits.length; i > 0; i -= 3) {
    const s = digits.slice(Math.max(0, i - 3), i);
    chunks.unshift(s.replace(/\d/g, (d) => d + "[.,\\s]?"));
  }
  const body = chunks.join("[.,\\s]?");
  const lead = /(?<!\d)$/.test("") ? "" : "";
  return (neg ? "-?" : "") + lead + body.replace(/\[\.\\s\]\?$/, "") + "(?!\\d)";
}
/** angka kecil (count) — chunked seperti numRe (izinkan "11.784") tapi tetap tolak
 *  digit/tanggal/ribuan tetangga; ekor izinkan koma/kurung titik akhir kalimat ("ada 7, …")
 *  namun tolak "7-8"/"7.500" (pemisah diikuti digit). */
const cntRe = (n: number) => `(?<![\\d/.,-])${numRe(n)}(?![.,/-]\\d)`;
const nameRe = (s: string) => `(?i)`.replace("(?i)", "") + esc(s); // re.I dipakai di checker
const factRe = (s: string) => esc(s).replace(/\\\./g, "[.\\s]?");

function dmy(d: string): { y: number; m: number; d: number } | null {
  const x = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(d ?? "").trim());
  if (!x) return null;
  return { d: +x[1], m: +x[2], y: +x[3] };
}
function inRange(d: string, from?: { y: number; m: number }, to?: { y: number; m: number }): boolean {
  const t = dmy(d);
  if (!t) return false;
  const v = t.y * 100 + t.m;
  const f = from ? from.y * 100 + from.m : -Infinity;
  const tt = to ? to.y * 100 + to.m : Infinity;
  return v >= f && v <= tt;
}
const P = (y: number, m1 = 1, m2 = 12) => ({ from: { y, m: m1 }, to: { y, m: m2 } });
const dstr = (y: number, m: number, d: number) =>
  `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
const isoOf = (d: string) => {
  const t = dmy(d);
  return t ? `${t.y}-${String(t.m).padStart(2, "0")}` : "";
};

/* ---------- siapkan data ---------- */
const siRows = M["sales-invoice"].rows;
const piRows = M["purchase-invoice"].rows;
const siDet = (M["sales-invoice"].details ?? {}) as Record<string, any>;
const piDet = (M["purchase-invoice"].details ?? {}) as Record<string, any>;
const customers = M["customer"].rows as Array<Record<string, any>>;
const vendors = M["vendor"].rows as Array<Record<string, any>>;
const items = M["item"].rows as Array<Record<string, any>>;

const sum = (rows: Array<Record<string, any>>, f = "totalAmount") => rows.reduce((s, r) => s + (Number(r[f]) || 0), 0);
const periodSI = (r: any, p?: { from: { y: number; m: number }; to: { y: number; m: number } }) =>
  !p || inRange(r.transDate, p.from, p.to);
const periodPI = periodSI;

function fmtRp(n: number): string {
  return new Intl.NumberFormat("id-ID").format(Math.trunc(n));
}
function rpRe(n: number): string {
  return numRe(Math.trunc(n));
}
/** nilai berdesimal → GT terima versi trunc ATAU round (model berbeda gaya pembulatan) */
const rpRe2 = (n: number) => `(?:${numRe(Math.trunc(n))}|${numRe(Math.round(n))})`;

/** tanggal fleksibel: '14/10/2026' diterima juga sbg '14 Oktober 2026' / '14 Okt 2026' /
 *  '14-10-2026' / '14.10.2026' (model sering menulis nama bulan) — HANYA utk string dmy. */
const MONTH_ALT = [
  "", "januari|jan", "februari|feb", "maret|mar", "april|apr", "mei", "juni|jun",
  "juli|jul", "agustus|agu|agt", "september|sep", "oktober|okt", "november|nov", "desember|des",
];
function dateRe(s: string): string {
  const x = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!x) return s;
  const [, d, m, y] = x;
  const names = MONTH_ALT[+m] ?? "";
  const month = names ? `(?:0?${+m}|${names})` : `0?${+m}`;
  return `(?<!\\d)0?${+d}[\\s./-]?${month}[\\s./-]?${y}`;
}

/** detail item utk faktur id */
type ItemLine = { name: string; qty: number; amt: number };
function lines(det: Record<string, any>): ItemLine[] {
  const arr = Array.isArray(det?.detailItem) ? det.detailItem : [];
  return arr.map((it: any) => ({
    name: String(it?.detailName ?? it?.item?.name ?? "").trim(),
    qty: Number(it?.quantity) || 0,
    amt: Number(it?.totalPrice) || 0,
  }));
}
const siLinesById = new Map<number, ItemLine[]>();
for (const [id, det] of Object.entries(siDet)) siLinesById.set(Number(id), lines(det));
const piLinesById = new Map<number, ItemLine[]>();
for (const [id, det] of Object.entries(piDet)) piLinesById.set(Number(id), lines(det));

/** agregasi pembelian per item nama → {qty, amt, vendors:Set} */
const purchByItem = new Map<string, { qty: number; amt: number; facs: { no: string; date: string; vendor: string }[] }>();
for (const r of piRows) {
  const ls = piLinesById.get(Number(r.id)) ?? [];
  for (const l of ls) {
    if (!l.name) continue;
    const g = purchByItem.get(l.name) ?? { qty: 0, amt: 0, facs: [] };
    g.qty += l.qty;
    g.amt += l.amt;
    g.facs.push({ no: r.number, date: r.transDate, vendor: String(r.vendor?.name ?? "") });
    purchByItem.set(l.name, g);
  }
}
const sellByItem = new Map<string, { qty: number; amt: number; facs: { no: string; date: string; cust: string }[] }>();
for (const r of siRows) {
  const ls = siLinesById.get(Number(r.id)) ?? [];
  for (const l of ls) {
    if (!l.name) continue;
    const g = sellByItem.get(l.name) ?? { qty: 0, amt: 0, facs: [] };
    g.qty += l.qty;
    g.amt += l.amt;
    g.facs.push({ no: r.number, date: r.transDate, cust: String(r.customer?.name ?? "") });
    sellByItem.set(l.name, g);
  }
}

/* ================= T1 — ringkas fast-path (150) ================= */
const periods1: { label: string; p?: any; from?: { y: number; m: number }; to?: { y: number; m: number } }[] = [
  { label: "selama ini" },
  { label: "tahun 2016", from: { y: 2016, m: 1 }, to: { y: 2016, m: 12 } },
  { label: "tahun 2017", from: { y: 2017, m: 1 }, to: { y: 2017, m: 12 } },
  { label: "bulan November 2016", from: { y: 2016, m: 11 }, to: { y: 2016, m: 11 } },
  { label: "bulan Oktober 2016", from: { y: 2016, m: 10 }, to: { y: 2016, m: 10 } },
  { label: "bulan September 2016", from: { y: 2016, m: 9 }, to: { y: 2016, m: 9 } },
  { label: "bulan Desember 2016", from: { y: 2016, m: 12 }, to: { y: 2016, m: 12 } },
  { label: "kuartal I 2017", from: { y: 2017, m: 1 }, to: { y: 2017, m: 3 } },
];
// a) penjualan per periode: total & jumlah faktur
for (const pr of periods1) {
  const rows = siRows.filter((r) => periodSI(r, pr.from && { from: pr.from, to: pr.to! }));
  if (rows.length === 0) continue;
  const t = sum(rows);
  Q(1, `Berapa total penjualan ${pr.label}?`, [rpRe(t)], "sales-invoice");
  Q(1, `Ada berapa faktur penjualan ${pr.label}?`, [cntRe(rows.length)], "sales-invoice");
}
// b) pembelian per periode
for (const pr of periods1) {
  const rows = piRows.filter((r) => periodPI(r, pr.from && { from: pr.from, to: pr.to! }));
  if (rows.length === 0) continue;
  const t = sum(rows);
  Q(1, `Berapa total pembelian ${pr.label}?`, [rpRe(t)], "purchase-invoice");
  Q(1, `Ada berapa faktur pembelian ${pr.label}?`, [cntRe(rows.length)], "purchase-invoice");
}
// c) laba rugi utk tiap tahun yang ada di data
const years = new Set<number>();
for (const r of [...siRows, ...piRows]) {
  const t = dmy(r.transDate);
  if (t) years.add(t.y);
}
for (const y of [...years].sort()) {
  const p = { from: { y, m: 1 }, to: { y, m: 12 } };
  const rows = siRows.filter((r) => periodSI(r, p));
  if (rows.length < 2) continue;
  Q(1, `Berapa total penjualan tahun ${y}?`, [rpRe(sum(rows))], "sales-invoice");
  Q(1, `Berapa laba bersih tahun ${y}?`, [rpRe(sum(rows) * 0)], "n/a"); // placeholder dibuang — lihat filter akhir
}
// d) neraca / pl via agregasi (diambil dari ringkasan lama — dihitung ulang utk dua tanggal akhir tahun utama)
const yTop = [...years].sort((a, b) => b - a).slice(0, 3).sort();
for (const y of yTop) {
  const asOf = dstr(y, 12, 31);
  Q(1, `Berapa total aset per tanggal ${asOf}?`, ["(placeholder-aset-)"], "glaccount"); // placeholder — diganti blok khusus di bawah
}
out.splice((o) => false ? 0 : 0); // no-op

// e) ringkas status pembayaran faktur jual
{
  const lunas = siRows.filter((r) => r.statusName === "Lunas").length;
  const belum = siRows.filter((r) => r.statusName !== "Lunas").length;
  Q(1, "Ada berapa faktur penjualan yang sudah lunas?", [cntRe(lunas)], "sales-invoice");
  Q(1, "Ada berapa faktur penjualan yang belum lunas?", [cntRe(belum)], "sales-invoice");
  const lunasP = piRows.filter((r) => r.statusName === "Lunas" || r.approvalStatus === "APPROVED" && r.statusName === "Lunas").length;
  if (lunasP > 0) Q(1, "Ada berapa faktur pembelian yang lunas?", [cntRe(lunasP)], "purchase-invoice");
}
// f) jumlah master data
Q(1, "Ada berapa pelanggan terdaftar?", [cntRe(customers.length)], "customer");
Q(1, "Ada berapa pemasok terdaftar?", [cntRe(vendors.length)], "vendor");
Q(1, "Ada berapa jenis barang terdaftar?", [cntRe(items.length)], "item");

// g) jumlah modul (dari inventory) — count dari rows
const modulCount: [string, string][] = [
  ["glaccount", "akun perkiraan"],
  ["fixed-asset", "aset tetap"],
  ["journal-voucher", "jurnal umum"],
  ["item-adjustment", "penyesuaian barang"],
  ["other-payment", "pembayaran lain"],
  ["item-transfer", "transfer barang"],
  ["sales-order", "surat pesanan penjualan"],
  ["purchase-order", "surat pesanan pembelian"],
  ["sales-receipt", "penerimaan penjualan"],
  ["sales-return", "retur penjualan"],
  ["purchase-return", "retur pembelian"],
  ["delivery-order", "surat jalan"],
  ["purchase-payment", "pembayaran pemasok"],
  ["bank-transfer", "transfer bank"],
  ["expense", "biaya"],
  ["employee", "karyawan"],
  ["receive-item", "penerimaan barang"],
  ["other-deposit", "penerimaan lain"],
  ["tax", "jenis pajak"],
  ["unit", "satuan barang"],
  ["warehouse", "gudang"],
  ["item-category", "kategori barang"],
  ["vendor-category", "kategori pemasok"],
  ["customer-category", "kategori pelanggan"],
  ["currency", "mata uang"],
  ["department", "departemen"],
  ["project", "proyek"],
  ["payment-term", "termin pembayaran"],
  ["sales-quotation", "penawaran penjualan"],
  ["purchase-requisition", "permintaan pembelian"],
  ["branch", "cabang"],
  ["fob", "FOB"],
  ["roll-over", "roll over"],
  ["price-category", "kategori harga"],
  ["salesman-commission", "komisi salesman"],
  ["stock-opname-order", "perintah stock opname"],
  ["stock-opname-result", "hasil stock opname"],
];
for (const [mod, label] of modulCount) {
  const rows = M[mod]?.rows ?? [];
  if (rows.length === 0) continue;
  Q(1, `Ada berapa ${label} yang tercatat di sistem?`, [cntRe(rows.length)], mod);
}
// h) daftar pendek (nama) utk modul kecil
const shortLists: [string, string, string][] = [
  ["unit", "satuan barang", "Satuan barang apa saja yang terdaftar di sistem?"],
  ["warehouse", "gudang", "Gudang apa saja yang ada di sistem?"],
  ["currency", "mata uang", "Mata uang apa saja yang terdaftar di sistem?"],
  ["customer-category", "kategori pelanggan", "Kategori pelanggan apa saja yang ada?"],
  ["vendor-category", "kategori pemasok", "Kategori pemasok apa saja yang ada?"],
  ["item-category", "kategori barang", "Kategori barang apa saja yang ada?"],
  ["branch", "cabang", "Cabang apa saja yang ada di perusahaan ini?"],
  ["department", "departemen", "Departemen apa saja yang ada di perusahaan ini?"],
];
for (const [mod, label, question] of shortLists) {
  const rows = (M[mod]?.rows ?? []) as Array<Record<string, any>>;
  if (rows.length === 0 || rows.length > 12) continue;
  const names = rows.map((r) => String(r.name ?? r.code ?? "")).filter(Boolean);
  if (names.length < 2) continue;
  Q(1, question, names.slice(0, 6).map((n) => esc(n)), mod);
}
// i) pajak: rate utk jenis pajak PPN
{
  const rows = (M["tax"]?.rows ?? []) as Array<Record<string, any>>;
  const ppn = rows.find((t) => Number(t.rate) > 0);
  if (ppn) Q(1, `Berapa persen tarif pajak PPN yang terdaftar?`, [cntRe(Number(ppn.rate))], "tax");
}
// j) top selling ringkas
{
  const best = [...sellByItem.entries()].sort((a, b) => b[1].qty - a[1].qty)[0];
  if (best) Q(1, "Barang apa yang paling banyak terjual sepanjang masa (berdasarkan unit)?", [esc(best[0])], "item");
}
// k) piutang & utang global (ringkas)
{
  const pi = siRows.filter((r) => r.statusName !== "Lunas");
  const ut = piRows.filter((r) => r.statusName !== "Lunas");
  const piT = sum(pi);
  const utT = sum(ut);
  Q(1, "Berapa total piutang usaha saat ini?", [rpRe(piT), cntRe(pi.length)], "sales-invoice");
  Q(1, "Berapa total utang usaha saat ini?", [rpRe(utT), cntRe(ut.length)], "purchase-invoice");
}
// l) cash / finance — pakai agregasi finance.overview? tidak — hitung kasar: lewati (di blok agregasi bawah)

/* ============ T1 tambahan: pertanyaan agregasi ringan ============ */
// jumlah pelanggan bertransaksi per tahun (dari faktur)
for (const y of yTop) {
  const p = { from: { y, m: 1 }, to: { y, m: 12 } };
  const custs = new Set(siRows.filter((r) => periodSI(r, p)).map((r) => String(r.customerNo ?? "")));
  if (custs.size >= 3)
    Q(1, `Ada berapa pelanggan yang bertransaksi penjualan tahun ${y}?`, [cntRe(custs.size)], "sales-invoice");
  const vens = new Set(piRows.filter((r) => periodPI(r, p)).map((r) => String(r.vendor?.vendorNo ?? "")));
  if (vens.size >= 3)
    Q(1, `Ada berapa pemasok yang bertransaksi pembelian tahun ${y}?`, [cntRe(vens.size)], "purchase-invoice");
}

/* ================= T2 — ranking & entitas (130) ================= */
function perCust(p?: { from: { y: number; m: number }; to: { y: number; m: number } }) {
  const m = new Map<string, { name: string; total: number; n: number }>();
  for (const r of siRows) {
    if (!periodSI(r, p)) continue;
    const k = String(r.customerNo ?? "");
    const g = m.get(k) ?? { name: String(r.customer?.name ?? k), total: 0, n: 0 };
    g.total += Number(r.totalAmount) || 0;
    g.n += 1;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}
function perVendor(p?: { from: { y: number; m: number }; to: { y: number; m: number } }) {
  const m = new Map<string, { name: string; total: number; n: number }>();
  for (const r of piRows) {
    if (!periodPI(r, p)) continue;
    const k = String(r.vendor?.vendorNo ?? "");
    const g = m.get(k) ?? { name: String(r.vendor?.name ?? k), total: 0, n: 0 };
    g.total += Number(r.totalAmount) || 0;
    g.n += 1;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}
const pAll: any = undefined;
const p16: any = P(2016);
const p17: any = P(2017);

// a) pelanggan penjualan terbesar (all / 2016 / 2017)
for (const [label, p] of [["selama ini", pAll], ["tahun 2016", p16], ["tahun 2017", p17]] as const) {
  const pc = perCust(p);
  if (pc.length >= 3) {
    Q(2, `Siapa pelanggan dengan penjualan terbesar ${label}?`, [esc(pc[0].name)], "sales-invoice");
    Q(2, `Siapa saja tiga pelanggan dengan penjualan terbesar ${label}?`, [esc(pc[0].name), esc(pc[1].name), esc(pc[2].name)], "sales-invoice");
    Q(2, `Berapa total penjualan dari pelanggan ${pc[0].name} ${label}?`, [rpRe(pc[0].total)], "sales-invoice");
    Q(2, `Siapa pelanggan dengan penjualan TERKECIL ${label}?`, [esc(pc[pc.length - 1].name)], "sales-invoice");
    Q(2, `Pelanggan mana yang fakturnya paling banyak ${label}?`, [esc([...pc].sort((a, b) => b.n - a.n)[0].name)], "sales-invoice");
  }
}
// b) pemasok pembelian terbesar
for (const [label, p] of [["selama ini", pAll], ["tahun 2016", p16], ["tahun 2017", p17]] as const) {
  const pv = perVendor(p);
  if (pv.length >= 3) {
    Q(2, `Siapa pemasok dengan pembelian terbesar ${label}?`, [esc(pv[0].name)], "purchase-invoice");
    Q(2, `Siapa saja tiga pemasok dengan pembelian terbesar ${label}?`, [esc(pv[0].name), esc(pv[1].name), esc(pv[2].name)], "purchase-invoice");
    Q(2, `Berapa total pembelian dari pemasok ${pv[0].name} ${label}?`, [rpRe(pv[0].total)], "purchase-invoice");
  }
}
// c) faktur terbesar jual & beli
{
  const top = [...siRows].sort((a, b) => Number(b.totalAmount) - Number(a.totalAmount))[0];
  Q(2, "Faktur penjualan mana yang nilainya terbesar?", [factRe(top.number), rpRe(top.totalAmount)], "sales-invoice");
  const topP = [...piRows].sort((a, b) => Number(b.totalAmount) - Number(a.totalAmount))[0];
  Q(2, "Faktur pembelian mana yang nilainya terbesar?", [factRe(topP.number), rpRe(topP.totalAmount)], "purchase-invoice");
}
// d) faktur jatuh tempo terdekat (belum lunas)
{
  const unb = siRows.filter((r) => r.statusName !== "Lunas" && r.dueDate);
  unb.sort((a, b) => (dmy(a.dueDate)!.y * 10000 + dmy(a.dueDate)!.m * 100 + dmy(a.dueDate)!.d) - (dmy(b.dueDate)!.y * 10000 + dmy(b.dueDate)!.m * 100 + dmy(b.dueDate)!.d));
  if (unb.length) {
    const due = unb[0].dueDate.split("/").join("[\\s./-]?");
    Q(2, "Faktur penjualan mana yang jatuh temponya paling dekat di antara yang belum lunas?", [new RegExp(due, "i")], "sales-invoice");
  }
}
// e) summary/unpaid/last per entitas pilihan (5 pelanggan + 5 pemasok teratas)
const topCusts = perCust(pAll).slice(0, 6);
const topVens = perVendor(pAll).slice(0, 5);
for (const c of topCusts) {
  const mine = siRows.filter((r) => String(r.customer?.name ?? "") === c.name);
  const unpaid = mine.filter((r) => r.statusName !== "Lunas");
  Q(2, `Berapa total penjualan sepanjang masa untuk pelanggan ${c.name}?`, [rpRe(c.total)], "sales-invoice");
  Q(2, `Ada berapa faktur penjualan untuk pelanggan ${c.name}?`, [cntRe(c.n)], "sales-invoice");
  if (unpaid.length)
    Q(2, `Berapa piutang belum dibayar dari pelanggan ${c.name}?`, [rpRe(sum(unpaid)), cntRe(unpaid.length)], "sales-invoice");
  const dates = mine.map((r) => r.transDate).sort((a, b) => {
    const A = dmy(a)!, B = dmy(b)!;
    return A.y - B.y || A.m - B.m || A.d - B.d;
  });
  if (dates.length) Q(2, `Kapan faktur penjualan terakhir dari pelanggan ${c.name}?`, [esc(dates[dates.length - 1])], "sales-invoice");
}
for (const v of topVens) {
  const mine = piRows.filter((r) => String(r.vendor?.name ?? "") === v.name);
  const unpaid = mine.filter((r) => r.statusName !== "Lunas");
  Q(2, `Berapa total pembelian sepanjang masa dari pemasok ${v.name}?`, [rpRe(v.total)], "purchase-invoice");
  Q(2, `Ada berapa faktur pembelian dari pemasok ${v.name}?`, [cntRe(v.n)], "purchase-invoice");
  if (unpaid.length)
    Q(2, `Berapa utang belum dibayar ke pemasok ${v.name}?`, [rpRe(sum(unpaid)), cntRe(unpaid.length)], "purchase-invoice");
}
// f) stok barang terbanyak & terdikit
{
  const its = [...items].sort((a, b) => Number(b.quantity) - Number(a.quantity));
  Q(2, "Barang mana yang stoknya paling banyak?", [esc(String(its[0].name)), cntRe(Number(its[0].quantity))], "item");
  Q(2, "Barang mana yang stoknya paling sedikit?", [esc(String(its[its.length - 1].name))], "item");
  Q(2, "Apa saja tiga barang dengan stok terbanyak?", its.slice(0, 3).map((i) => esc(String(i.name))), "item");
}
// g) top selling per tahun (unit tertinggi & nilai tertinggi)
for (const y of yTop) {
  const p: any = P(y);
  const agg = new Map<string, { q: number; a: number }>();
  for (const r of siRows) {
    if (!periodSI(r, p)) continue;
    for (const l of siLinesById.get(Number(r.id)) ?? []) {
      if (!l.name) continue;
      const g = agg.get(l.name) ?? { q: 0, a: 0 };
      g.q += l.qty;
      g.a += l.amt;
      agg.set(l.name, g);
    }
  }
  if (agg.size < 3) continue;
  const byQ = [...agg.entries()].sort((a, b) => b[1].q - a[1].q)[0];
  const byA = [...agg.entries()].sort((a, b) => b[1].a - a[1].a)[0];
  Q(2, `Barang apa yang paling banyak terjual tahun ${y} berdasarkan unit?`, [esc(byQ[0]), cntRe(byQ[1].q)], "item");
  Q(2, `Barang apa yang penjualannya paling besar nilai tahun ${y}?`, [esc(byA[0]), rpRe(byA[1].a)], "item");
}
// h) customer.balance terbesar (piutang per master)
{
  const top = [...customers].sort((a, b) => Number(b.balance) - Number(a.balance))[0];
  Q(2, "Pelanggan mana yang memiliki saldo (piutang) paling besar di kartu pelanggan?", [esc(String(top.name)), rpRe(Number(top.balance))], "customer");
  const topV = [...vendors].sort((a, b) => Number(b.balance) - Number(a.balance))[0];
  Q(2, "Pemasok mana yang memiliki saldo (utang) paling besar di kartu pemasok?", [esc(String(topV.name)), rpRe(Number(topV.balance))], "vendor");
}
// i) rata2 penjualan per faktur
for (const [label, p] of [["tahun 2016", p16], ["tahun 2017", p17]] as const) {
  const rows = siRows.filter((r) => periodSI(r, p));
  if (rows.length) Q(2, `Berapa rata-rata nilai penjualan per faktur ${label}?`, [rpRe(Math.round(sum(rows) / rows.length))], "sales-invoice");
}

/* ================= T3 — relasi 3–4 tabel (120) ================= */
// a) item buyers utk item populer
const topSellItems = [...sellByItem.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 22);
for (const [name, g] of topSellItems) {
  const custAgg = new Map<string, number>();
  for (const f of g.facs) custAgg.set(f.cust, (custAgg.get(f.cust) ?? 0) + 1);
  const topBuyer = [...custAgg.entries()].sort((a, b) => b[1] - a[1])[0];
  const buyersNames = [...custAgg.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => esc(n));
  Q(3, `Siapa saja pelanggan yang pernah membeli barang ${name}?`, buyersNames.length ? buyersNames : [esc(name)], "sales-invoice");
  Q(3, `Berapa total unit ${name} yang terjual sepanjang masa?`, [cntRe(g.qty)], "sales-invoice");
  if (topBuyer) Q(3, `Pelanggan mana yang paling sering membeli ${name}?`, [esc(topBuyer[0])], "sales-invoice");
}
// b) item suppliers utk item populer pembelian
const topPurchItems = [...purchByItem.entries()].sort((a, b) => b[1].amt - a[1].amt).slice(0, 16);
for (const [name, g] of topPurchItems) {
  const venAgg = new Map<string, number>();
  for (const f of g.facs) venAgg.set(f.vendor, (venAgg.get(f.vendor) ?? 0) + 1);
  const topSup = [...venAgg.entries()].sort((a, b) => b[1] - a[1])[0];
  Q(3, `Pemasok mana yang memasok barang ${name}?`, topSup ? [esc(topSup[0])] : [esc(name)], "purchase-invoice");
  Q(3, `Berapa total unit pembelian barang ${name} sepanjang masa?`, [cntRe(g.qty)], "purchase-invoice");
}
// c) faktur penjualan memuat item (nomor faktur periode spesifik)
{
  let n = 0;
  for (const [name, g] of topSellItems) {
    if (n >= 18) break;
    for (const f of g.facs) {
      const t = dmy(f.date);
      if (!t) continue;
      if (t.y !== 2016) continue;
      Q(3, `Faktur penjualan bulan ${new Date(0).toLocaleDateString("id-ID")}`.length ? `Faktur penjualan tanggal ${f.date} mana yang memuat barang ${name}?` : "", [factRe(f.no)], "sales-invoice");
      n += 1;
      break; // satu faktur per item utk jaga jumlah
    }
  }
}
// d) faktur pembelian per pemasok mengandung item tertentu
{
  let n = 0;
  for (const v of topVens) {
    const rowsF = piRows.filter((r) => String(r.vendor?.name ?? "") === v.name);
    for (const r of rowsF) {
      const ls = piLinesById.get(Number(r.id)) ?? [];
      const big = ls.filter((l) => l.amt > 0).sort((a, b) => b.amt - a.amt)[0];
      if (!big) continue;
      if (Q(3, `Faktur pembelian mana dari pemasok ${v.name} yang isinya barang ${big.name}?`, [factRe(r.number)], "purchase-invoice")) n += 1;
      if (n >= 14) break;
    }
    if (n >= 14) break;
  }
}
// e) barang yang dibeli pelanggan tertentu / barang dari pemasok tertentu
{
  let n = 0;
  for (const c of topCusts) {
    const names = new Set<string>();
    for (const r of siRows) {
      if (String(r.customer?.name ?? "") !== c.name) continue;
      for (const l of siLinesById.get(Number(r.id)) ?? []) if (l.name) names.add(l.name);
    }
    if (names.size >= 3) {
      const chosen = [...names].slice(0, 6);
      if (Q(3, `Barang apa saja yang dibeli dari pelanggan ${c.name} selama ini?`, chosen.slice(0, 5).map(esc), "sales-invoice")) n += 1;
    }
    if (n >= 12) break;
  }
  n = 0;
  for (const v of topVens) {
    const names = new Set<string>();
    for (const r of piRows) {
      if (String(r.vendor?.name ?? "") !== v.name) continue;
      for (const l of piLinesById.get(Number(r.id)) ?? []) if (l.name) names.add(l.name);
    }
    if (names.size >= 3) {
      const chosen = [...names].slice(0, 6);
      if (Q(3, `Barang apa saja yang disuplai pemasok ${v.name} ke kita?`, chosen.slice(0, 5).map(esc), "purchase-invoice")) n += 1;
    }
    if (n >= 10) break;
  }
}
// f) qty item utk pelanggan tertentu + rata2 unit
{
  let n = 0;
  for (const [name, g] of topSellItems) {
    if (n >= 20) break;
    const perC = new Map<string, { q: number; a: number }>();
    for (const f of g.facs) {
      // cari dari detail utk akurasi qty per pelanggan
      const rows = siRows.filter((r) => r.number === f.no);
      for (const r of rows) {
        for (const l of siLinesById.get(Number(r.id)) ?? []) {
          if (l.name !== name) continue;
          const key = String(r.customer?.name ?? "");
          const gg = perC.get(key) ?? { q: 0, a: 0 };
          gg.q += l.qty;
          gg.a += l.amt;
          perC.set(key, gg);
        }
      }
    }
    const top = [...perC.entries()].sort((a, b) => b[1].q - a[1].q)[0];
    if (top && top[1].q > 0) {
      if (Q(3, `Berapa unit ${name} yang dibeli ${top[0]} sepanjang masa?`, [cntRe(top[1].q)], "sales-invoice")) n += 1;
      if (n < 20 && Q(3, `Berapa nilai penjualan total barang ${name} sepanjang masa?`, [rpRe(g.amt)], "sales-invoice")) n += 1;
    }
  }
  n = 0;
  for (const [name, g] of topPurchItems) {
    if (n >= 10) break;
    const avg = g.qty > 0 ? Math.trunc(g.amt / g.qty) : 0;
    if (avg > 0 && Q(3, `Berapa harga rata-rata satuan pembelian barang ${name} sepanjang masa?`, [rpRe(avg)], "purchase-invoice")) n += 1;
  }
}
// g) surat jalan / penerimaan / retur per pelanggan (list rows)
{
  const doRows = M["delivery-order"]?.rows ?? [];
  const custDO = new Set(doRows.map((r) => String(r.customerNo ?? "")).filter(Boolean));
  if (doRows.length && custDO.size)
    Q(3, "Ada berapa surat jalan pengiriman yang tercatat?", [cntRe(doRows.length)], "delivery-order");
  const srRows = M["sales-receipt"]?.rows ?? [];
  if (srRows.length) Q(3, "Ada berapa bukti penerimaan penjualan (sales receipt) yang tercatat?", [cntRe(srRows.length)], "sales-receipt");
  const sret = M["sales-return"]?.rows ?? [];
  if (sret.length) {
    Q(3, "Ada berapa retur penjualan yang tercatat?", [cntRe(sret.length)], "sales-return");
    Q(3, "Berapa total nilai retur penjualan?", [rpRe(sum(sret))], "sales-return");
  }
  const pret = M["purchase-return"]?.rows ?? [];
  if (pret.length) {
    Q(3, "Ada berapa retur pembelian yang tercatat?", [cntRe(pret.length)], "purchase-return");
    Q(3, "Berapa total nilai retur pembelian?", [rpRe(sum(pret))], "purchase-return");
  }
}
// h) journal-voucher per tahun & nilai
{
  const rows = M["journal-voucher"]?.rows ?? [];
  const byYear = new Map<number, typeof rows>();
  for (const r of rows) {
    const t = dmy(r.transDate);
    if (!t) continue;
    const arr = byYear.get(t.y) ?? [];
    arr.push(r);
    byYear.set(t.y, arr);
  }
  for (const [y, arr] of [...byYear.entries()].sort()) {
    if (arr.length < 5) continue;
    Q(3, `Ada berapa jurnal umum tahun ${y}?`, [cntRe(arr.length)], "journal-voucher");
    if (sum(arr) > 0) Q(3, `Berapa total nilai jurnal umum tahun ${y}?`, [rpRe(sum(arr))], "journal-voucher");
  }
}
// i) fixed-asset
{
  const rows = M["fixed-asset"]?.rows ?? [];
  if (rows.length) {
    Q(3, "Ada berapa aset tetap yang tercatat?", [cntRe(rows.length)], "fixed-asset");
    const qty = rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
    if (qty > 0) Q(3, "Berapa total jumlah unit seluruh aset tetap?", [cntRe(qty)], "fixed-asset");
  }
}
// j) expense
{
  const rows = M["expense"]?.rows ?? [];
  if (rows.length >= 3) {
    Q(3, "Ada berapa transaksi biaya (expense) yang tercatat?", [cntRe(rows.length)], "expense");
    const dates = rows.map((r) => r.transDate).filter(Boolean).sort((a, b) => {
      const A = dmy(a)!, B = dmy(b)!;
      return A.y - B.y || A.m - B.m || A.d - B.d;
    });
    if (dates.length) Q(3, "Kapan transaksi biaya yang paling baru?", [esc(dates[dates.length - 1])], "expense");
  }
}

/* ================= T4 — komparatif (60) ================= */
for (const yA of yTop) {
  const yB = yTop.find((y) => y > yA);
  if (!yB) break;
  const pA: any = P(yA);
  const pB: any = P(yB);
  const sA = siRows.filter((r) => periodSI(r, pA));
  const sB = siRows.filter((r) => periodSI(r, pB));
  const bA = piRows.filter((r) => periodPI(r, pA));
  const bB = piRows.filter((r) => periodPI(r, pB));
  if (sA.length && sB.length) {
    Q(4, `Berapa total penjualan tahun ${yA} dan tahun ${yB}?`, [rpRe(sum(sA)), rpRe(sum(sB))], "sales-invoice");
    Q(4, `Berapa selisih total penjualan tahun ${yA} dengan tahun ${yB}?`, [rpRe(Math.abs(sum(sA) - sum(sB)))], "sales-invoice");
    Q(4, `Penjualan tahun ${yA} lebih besar atau tahun ${yB}? Sebutkan kedua angkanya.`, [rpRe(sum(sA)), rpRe(sum(sB))], "sales-invoice");
    Q(4, `Ada berapa faktur penjualan tahun ${yA} berbanding tahun ${yB}?`, [cntRe(sA.length), cntRe(sB.length)], "sales-invoice");
  }
  if (bA.length && bB.length) {
    Q(4, `Berapa total pembelian tahun ${yA} dan tahun ${yB}?`, [rpRe(sum(bA)), rpRe(sum(bB))], "purchase-invoice");
    Q(4, `Berapa selisih total pembelian tahun ${yA} dengan tahun ${yB}?`, [rpRe(Math.abs(sum(bA) - sum(bB)))], "purchase-invoice");
  }
  // pelanggan turun/naik utk 2 entitas yang jelas
  const pcA = perCust(pA);
  const pcB = perCust(pB);
  const mB = new Map(pcB.map((c) => [c.name, c.total]));
  const drops = pcA.filter((c) => (mB.get(c.name) ?? 0) < c.total && (mB.get(c.name) ?? 0) >= 0 && c.total > 1000000);
  for (const d of drops.slice(0, 3)) {
    const before = d.total;
    const after = mB.get(d.name) ?? 0;
    Q(4, `Penjualan pelanggan ${d.name} turun dari tahun ${yA} ke ${yB}? Sebutkan angkanya.`, [rpRe(before), rpRe(after)], "sales-invoice");
  }
  const risen = pcA.filter((c) => (mB.get(c.name) ?? 0) > c.total && c.total > 0);
  for (const d of risen.slice(0, 2)) {
    Q(4, `Penjualan pelanggan ${d.name} naik dari tahun ${yA} ke ${yB}? Sebutkan angkanya.`, [rpRe(d.total), rpRe(mB.get(d.name) ?? 0)], "sales-invoice");
  }
}
// piutang vs utang
{
  const piT = sum(siRows.filter((r) => r.statusName !== "Lunas"));
  const utT = sum(piRows.filter((r) => r.statusName !== "Lunas"));
  Q(4, "Mana yang lebih besar: piutang usaha atau utang usaha? Sebutkan kedua angkanya dan selisihnya.", [rpRe(piT), rpRe(utT), rpRe(Math.abs(piT - utT))], "sales-invoice");
}
// jumlah pemasok vs pelanggan
Q(4, "Mana yang lebih banyak: pelanggan atau pemasok? Sebutkan kedua jumlahnya.", [cntRe(customers.length), cntRe(vendors.length)], "customer");

/* ================= T5 — majemuk (40) ================= */
{
  // komposisi majemuk — sub-jawaban ≥2
  const pc16 = perCust(p16);
  const pc17 = perCust(p17);
  if (pc16.length && pc17.length) {
    Q(5, `Siapa pelanggan penjualan terbesar tahun 2016 dan siapa pelanggan terbesar tahun 2017?`, [esc(pc16[0].name), esc(pc17[0].name)], "sales-invoice");
    Q(5, `Berapa penjualan pelanggan terbesar tahun 2016 dan berapa penjualan pelanggan terbesar tahun 2017?`, [rpRe(pc16[0].total), rpRe(pc17[0].total)], "sales-invoice");
  }
  const pv16 = perVendor(p16);
  const pv17 = perVendor(p17);
  if (pv16.length && pv17.length) {
    Q(5, `Siapa pemasok pembelian terbesar tahun 2016 dan siapa pemasok terbesar tahun 2017?`, [esc(pv16[0].name), esc(pv17[0].name)], "purchase-invoice");
  }
  const s16 = siRows.filter((r) => periodSI(r, p16));
  const s17 = siRows.filter((r) => periodSI(r, p17));
  if (s16.length && s17.length) {
    Q(5, `Berapa jumlah faktur penjualan tahun 2016 dan tahun 2017?`, [cntRe(s16.length), cntRe(s17.length)], "sales-invoice");
    Q(5, `Berapa total penjualan tahun 2016, siapa pelanggan terbesarnya, dan berapa nilainya?`, [rpRe(sum(s16)), esc(perCust(p16)[0].name), rpRe(perCust(p16)[0].total)], "sales-invoice");
  }
  // utang + piutang + selisih utk top entitas
  const piT = sum(siRows.filter((r) => r.statusName !== "Lunas"));
  const utT = sum(piRows.filter((r) => r.statusName !== "Lunas"));
  Q(5, "Berapa total piutang usaha, berapa total utang usaha, dan mana yang lebih besar?", [rpRe(piT), rpRe(utT)], "sales-invoice");
  // item terlaris + qty + unit value
  for (const y of yTop.slice(0, 2)) {
    const p: any = P(y);
    const agg = new Map<string, { q: number; a: number }>();
    for (const r of siRows) {
      if (!periodSI(r, p)) continue;
      for (const l of siLinesById.get(Number(r.id)) ?? []) {
        if (!l.name) continue;
        const g = agg.get(l.name) ?? { q: 0, a: 0 };
        g.q += l.qty;
        g.a += l.amt;
        agg.set(l.name, g);
      }
    }
    if (agg.size < 3) continue;
    const byQ = [...agg.entries()].sort((a, b) => b[1].q - a[1].q)[0];
    Q(5, `Barang apa yang paling laris tahun ${y}, berapa unit terjual, dan berapa nilainya?`, [esc(byQ[0]), cntRe(byQ[1].q), rpRe(byQ[1].a)], "item");
  }
  // faktur terbesar jual + beli + siapa pihaknya
  {
    const tS = [...siRows].sort((a, b) => Number(b.totalAmount) - Number(a.totalAmount))[0];
    const tP = [...piRows].sort((a, b) => Number(b.totalAmount) - Number(a.totalAmount))[0];
    Q(5, "Faktur penjualan terbesar dan faktur pembelian terbesar — sebutkan nomor dan nilainya.", [factRe(tS.number), rpRe(tS.totalAmount), factRe(tP.number), rpRe(tP.totalAmount)], "sales-invoice");
    Q(5, `Faktur penjualan terbesar berasal dari pelanggan mana dan bernilai berapa?`, [esc(String(tS.customer?.name ?? "")), rpRe(tS.totalAmount)], "sales-invoice");
    Q(5, `Faktur pembelian terbesar dari pemasok mana dan bernilai berapa?`, [esc(String(tP.vendor?.name ?? "")), rpRe(tP.totalAmount)], "purchase-invoice");
  }
  // top customer: total + jumlah faktur + piutangnya
  const c0 = topCusts[0];
  if (c0) {
    const mine = siRows.filter((r) => String(r.customer?.name ?? "") === c0.name);
    const unpaid = mine.filter((r) => r.statusName !== "Lunas");
    Q(5, `Pelanggan ${c0.name}: berapa total penjualan, ada berapa faktur, dan berapa piutangnya?`, [rpRe(c0.total), cntRe(c0.n), unpaid.length ? rpRe(sum(unpaid)) : rpRe(0)], "sales-invoice");
  }
  // stok total + jumlah barang + gudang
  const totalStock = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  Q(5, "Ada berapa jenis barang, berapa total seluruh stok, dan berapa gudang?", [cntRe(items.length), cntRe(totalStock), cntRe((M["warehouse"]?.rows ?? []).length)], "item");
  // penjualan + pembelian tahun sama → laba kasar pendek
  for (const y of yTop.slice(0, 2)) {
    const p: any = P(y);
    const s = siRows.filter((r) => periodSI(r, p));
    const b = piRows.filter((r) => periodPI(r, p));
    if (s.length && b.length)
      Q(5, `Berapa total penjualan dan total pembelian tahun ${y}?`, [rpRe(sum(s)), rpRe(sum(b))], "sales-invoice");
  }
}

/* ============ TAMBAL T1 — bulanan penuh + piutang/utang tahunan ============ */
const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const monthSet = new Set<string>(); // "2016-09"
for (const r of siRows) {
  const t = dmy(r.transDate);
  if (t) monthSet.add(`${t.y}-${String(t.m).padStart(2, "0")}`);
}
const monthList = [...monthSet].sort(); // bulan dgn penjualan
for (const ym of monthList) {
  const [ys, ms] = ym.split("-");
  const y = +ys,
    m = +ms;
  const p: any = { from: { y, m }, to: { y, m } };
  const rows = siRows.filter((r) => periodSI(r, p));
  const bulan = `${monthNames[m - 1]} ${y}`;
  if (rows.length) {
    Q(1, `Berapa total penjualan bulan ${bulan}?`, [rpRe(sum(rows))], "sales-invoice");
    Q(1, `Ada berapa faktur penjualan bulan ${bulan}?`, [cntRe(rows.length)], "sales-invoice");
  }
  const brows = piRows.filter((r) => periodPI(r, p));
  if (brows.length) {
    Q(1, `Berapa total pembelian bulan ${bulan}?`, [rpRe(sum(brows))], "purchase-invoice");
    Q(1, `Ada berapa faktur pembelian bulan ${bulan}?`, [cntRe(brows.length)], "purchase-invoice");
  }
}
// piutang & utang per tahun + jumlah fakturnya + rata2 per faktur per tahun
for (const y of [...years].sort()) {
  const p: any = P(y);
  const siY = siRows.filter((r) => periodSI(r, p));
  const piY = piRows.filter((r) => periodPI(r, p));
  const unS = siY.filter((r) => r.statusName !== "Lunas");
  const unP = piY.filter((r) => r.statusName !== "Lunas");
  if (unS.length) {
    Q(1, `Berapa total piutang usaha dari transaksi tahun ${y}?`, [rpRe(sum(unS))], "sales-invoice");
    Q(1, `Ada berapa faktur penjualan tahun ${y} yang belum lunas?`, [cntRe(unS.length)], "sales-invoice");
  }
  if (unP.length) {
    Q(1, `Berapa total utang usaha dari transaksi tahun ${y}?`, [rpRe(sum(unP))], "purchase-invoice");
    Q(1, `Ada berapa faktur pembelian tahun ${y} yang belum lunas?`, [cntRe(unP.length)], "purchase-invoice");
  }
  if (siY.length) Q(1, `Berapa rata-rata nilai penjualan per faktur tahun ${y}?`, [rpRe(Math.round(sum(siY) / siY.length))], "sales-invoice");
  if (piY.length) Q(1, `Berapa rata-rata nilai pembelian per faktur tahun ${y}?`, [rpRe(Math.round(sum(piY) / piY.length))], "purchase-invoice");
  const lunas = siY.filter((r) => r.statusName === "Lunas");
  if (lunas.length) Q(1, `Ada berapa faktur penjualan lunas pada tahun ${y}?`, [cntRe(lunas.length)], "sales-invoice");
}
// retur per tahun (count + nilai)
for (const [mod, label] of [["sales-return", "retur penjualan"], ["purchase-return", "retur pembelian"]] as const) {
  const rows = M[mod]?.rows ?? [];
  const byYear = new Map<number, typeof rows>();
  for (const r of rows) {
    const t = dmy(r.transDate);
    if (!t) continue;
    (byYear.get(t.y) ?? byYear.set(t.y, []).get(t.y)!).push(r);
  }
  for (const [y, arr] of byYear) {
    if (arr.length < 3) continue;
    Q(1, `Ada berapa transaksi ${label} tahun ${y}?`, [cntRe(arr.length)], mod);
    Q(1, `Berapa total nilai ${label} tahun ${y}?`, [rpRe(sum(arr))], mod);
  }
}
// expense & fixed-asset per tahun utama
{
  const exp = M["expense"]?.rows ?? [];
  const byYear = new Map<number, typeof exp>();
  for (const r of exp) {
    const t = dmy(r.transDate);
    if (!t) continue;
    const arr = byYear.get(t.y) ?? [];
    arr.push(r);
    byYear.set(t.y, arr);
  }
  for (const [y, arr] of byYear)
    if (arr.length >= 3) Q(1, `Ada berapa transaksi biaya tahun ${y}?`, [cntRe(arr.length)], "expense");
}
{
  const fa = M["fixed-asset"]?.rows ?? [];
  const byYear = new Map<number, typeof fa>();
  for (const r of fa) {
    const t = dmy(r.transDate);
    if (!t) continue;
    const arr = byYear.get(t.y) ?? [];
    arr.push(r);
    byYear.set(t.y, arr);
  }
  for (const [y, arr] of byYear)
    if (arr.length >= 5) Q(1, `Ada berapa aset tetap yang dibeli tahun ${y}?`, [cntRe(arr.length)], "fixed-asset");
}
// sales-order / receipt / DO per tahun
for (const [mod, label] of [
  ["sales-order", "surat pesanan penjualan"],
  ["sales-receipt", "bukti penerimaan penjualan"],
  ["delivery-order", "surat jalan"],
  ["purchase-order", "surat pesanan pembelian"],
] as const) {
  const rows = M[mod]?.rows ?? [];
  if (!rows.length) continue;
  const byYear = new Map<number, number>();
  for (const r of rows) {
    const t = dmy(r.transDate);
    if (t) byYear.set(t.y, (byYear.get(t.y) ?? 0) + 1);
  }
  for (const [y, n] of byYear)
    if (n >= 3) Q(1, `Ada berapa ${label} tahun ${y}?`, [cntRe(n)], mod);
}

/* ============ TAMBAL T2 — entitas lebih banyak ============ */
for (const c of [...perCust(pAll)].slice(6, 14)) {
  const mine = siRows.filter((r) => String(r.customer?.name ?? "") === c.name);
  const unpaid = mine.filter((r) => r.statusName !== "Lunas");
  Q(2, `Berapa total penjualan sepanjang masa untuk pelanggan ${c.name}?`, [rpRe(c.total)], "sales-invoice");
  Q(2, `Ada berapa faktur penjualan untuk pelanggan ${c.name}?`, [cntRe(c.n)], "sales-invoice");
  if (unpaid.length) Q(2, `Berapa piutang belum dibayar dari pelanggan ${c.name}?`, [rpRe(sum(unpaid))], "sales-invoice");
}
for (const v of [...perVendor(pAll)].slice(5, 10)) {
  const mine = piRows.filter((r) => String(r.vendor?.name ?? "") === v.name);
  Q(2, `Berapa total pembelian sepanjang masa dari pemasok ${v.name}?`, [rpRe(v.total)], "purchase-invoice");
  Q(2, `Ada berapa faktur pembelian dari pemasok ${v.name}?`, [cntRe(v.n)], "purchase-invoice");
  const dates = mine.map((r) => r.transDate).filter(Boolean).sort((a, b) => {
    const A = dmy(a)!, B = dmy(b)!;
    return A.y - B.y || A.m - B.m || A.d - B.d;
  });
  if (dates.length) Q(2, `Kapan pembelian terakhir dari pemasok ${v.name}?`, [esc(dates[dates.length - 1])], "purchase-invoice");
}
// top pelanggan per bulan besar
for (const ym of ["2016-09", "2016-10", "2016-11", "2016-12", "2017-01", "2017-02"]) {
  const [ys, ms] = ym.split("-");
  const p: any = P(+ys, +ms, +ms);
  const pc = perCust(p);
  if (pc.length >= 2) {
    const label = `${monthNames[+ms - 1]} ${ys}`;
    Q(2, `Siapa pelanggan dengan penjualan terbesar bulan ${label}?`, [esc(pc[0].name)], "sales-invoice");
    Q(2, `Berapa total penjualan pelanggan ${pc[0].name} bulan ${label}?`, [rpRe(pc[0].total)], "sales-invoice");
  }
}
// top vendor per bulan besar
for (const ym of ["2016-10", "2016-11", "2017-01"]) {
  const [ys, ms] = ym.split("-");
  const p: any = P(+ys, +ms, +ms);
  const pv = perVendor(p);
  if (pv.length >= 2) {
    const label = `${monthNames[+ms - 1]} ${ys}`;
    Q(2, `Siapa pemasok dengan pembelian terbesar bulan ${label}?`, [esc(pv[0].name)], "purchase-invoice");
    Q(2, `Berapa total pembelian dari pemasok ${pv[0].name} bulan ${label}?`, [rpRe(pv[0].total)], "purchase-invoice");
  }
}
// penjualan top-3 pelanggan per tahun
for (const y of yTop) {
  const p: any = P(y);
  const pc = perCust(p);
  if (pc.length >= 3) {
    Q(2, `Siapa saja tiga pelanggan penjualan terbesar tahun ${y}?`, pc.slice(0, 3).map((c) => esc(c.name)), "sales-invoice");
    Q(2, `Berapa penjualan pelanggan ${pc[0].name} tahun ${y}?`, [rpRe(pc[0].total)], "sales-invoice");
  }
}
// kartu piutang: pelanggan dgn saldo >0 terbesar 5 (by balance)
{
  const withBal = customers.filter((c) => Number(c.balance) > 0).sort((a, b) => Number(b.balance) - Number(a.balance)).slice(0, 5);
  for (const c of withBal)
    Q(2, `Berapa saldo piutang pelanggan ${c.name} di kartu pelanggan?`, [rpRe(Number(c.balance))], "customer");
  const vBal = vendors.filter((v) => Number(v.balance) > 0).sort((a, b) => Number(b.balance) - Number(a.balance)).slice(0, 4);
  for (const v of vBal)
    Q(2, `Berapa saldo utang pemasok ${v.name} di kartu pemasok?`, [rpRe(Number(v.balance))], "vendor");
}
// faktur pertama & terakhir tiap tahun utk top pelanggan
for (const c of topCusts.slice(0, 5)) {
  const mine = siRows
    .filter((r) => String(r.customer?.name ?? "") === c.name)
    .sort((a, b) => {
      const A = dmy(a.transDate)!, B = dmy(b.transDate)!;
      return A.y - B.y || A.m - B.m || A.d - B.d;
    });
  if (mine.length >= 3) {
    Q(2, `Kapan faktur penjualan pertama dari pelanggan ${c.name}?`, [esc(mine[0].transDate)], "sales-invoice");
    // bila beberapa faktur berbagi tanggal PERTAMA — GT terima nilai salah satunya (tie tak stabil)
    const sameDate = mine.filter((r) => r.transDate === mine[0].transDate);
    const val =
      sameDate.length > 1
        ? `(?:${sameDate.map((r) => rpRe(r.totalAmount)).join("|")})`
        : rpRe(mine[0].totalAmount);
    Q(2, `Berapa nilai faktur penjualan pertama pelanggan ${c.name}?`, [val], "sales-invoice");
  }
}

/* ============ TAMBAL T4 — komparatif tambahan ============ */
{
  // pasangan bulanan besar (total + selisih)
  const pairs: [string, string][] = [
    ["2016-11", "2016-12"],
    ["2016-10", "2016-11"],
    ["2016-09", "2016-10"],
    ["2017-01", "2017-02"],
    ["2016-12", "2017-01"],
  ];
  const monthAgg = new Map<string, number>();
  const monthCnt = new Map<string, number>();
  for (const r of siRows) {
    const t = dmy(r.transDate);
    if (!t) continue;
    const k = `${t.y}-${String(t.m).padStart(2, "0")}`;
    monthAgg.set(k, (monthAgg.get(k) ?? 0) + (Number(r.totalAmount) || 0));
    monthCnt.set(k, (monthCnt.get(k) ?? 0) + 1);
  }
  const lbl = (k: string) => {
    const [y, m] = k.split("-");
    return `${monthNames[+m - 1]} ${y}`;
  };
  for (const [a, b] of pairs) {
    if (!monthAgg.has(a) || !monthAgg.has(b)) continue;
    const A = monthAgg.get(a)!,
      B = monthAgg.get(b)!;
    Q(4, `Berapa total penjualan bulan ${lbl(a)} dan bulan ${lbl(b)}?`, [rpRe(A), rpRe(B)], "sales-invoice");
    Q(4, `Berapa selisih total penjualan bulan ${lbl(a)} dengan bulan ${lbl(b)}?`, [rpRe(Math.abs(A - B))], "sales-invoice");
    Q(4, `Ada berapa faktur penjualan bulan ${lbl(a)} berbanding bulan ${lbl(b)}?`, [cntRe(monthCnt.get(a)!), cntRe(monthCnt.get(b)!)], "sales-invoice");
  }
  // perbandingan tahun: pelanggan aktif, rata2, lunas, utang, vendor
  for (const yA of yTop) {
    const yB = yTop.find((y) => y > yA);
    if (!yB) break;
    const pA: any = P(yA);
    const pB: any = P(yB);
    const cA = new Set(siRows.filter((r) => periodSI(r, pA)).map((r) => r.customerNo)).size;
    const cB = new Set(siRows.filter((r) => periodSI(r, pB)).map((r) => r.customerNo)).size;
    Q(4, `Ada berapa pelanggan aktif penjualan tahun ${yA} dan tahun ${yB}?`, [cntRe(cA), cntRe(cB)], "sales-invoice");
    const sA = siRows.filter((r) => periodSI(r, pA));
    const sB = siRows.filter((r) => periodSI(r, pB));
    if (sA.length && sB.length) {
      const avgA = Math.round(sum(sA) / sA.length),
        avgB = Math.round(sum(sB) / sB.length);
      Q(4, `Berapa rata-rata penjualan per faktur tahun ${yA} dan tahun ${yB}? Sebutkan juga selisihnya.`, [rpRe(avgA), rpRe(avgB), rpRe(Math.abs(avgA - avgB))], "sales-invoice");
      const lunasA = sA.filter((r) => r.statusName === "Lunas").length;
      const lunasB = sB.filter((r) => r.statusName === "Lunas").length;
      Q(4, `Ada berapa faktur penjualan lunas tahun ${yA} dan tahun ${yB}?`, [cntRe(lunasA), cntRe(lunasB)], "sales-invoice");
    }
    const unA = siRows.filter((r) => periodSI(r, pA) && r.statusName !== "Lunas");
    const unB = siRows.filter((r) => periodSI(r, pB) && r.statusName !== "Lunas");
    if (unA.length && unB.length)
      Q(4, `Berapa piutang dari transaksi tahun ${yA} dan tahun ${yB}?`, [rpRe(sum(unA)), rpRe(sum(unB))], "sales-invoice");
    // top vendor per tahun
    const pvA = perVendor(pA),
      pvB = perVendor(pB);
    if (pvA.length && pvB.length)
      Q(4, `Siapa pemasok pembelian terbesar tahun ${yA} dan siapa pemasok terbesar tahun ${yB}?`, [esc(pvA[0].name), esc(pvB[0].name)], "purchase-invoice");
    // top item per tahun (unit)
    const aggA = new Map<string, number>(),
      aggB = new Map<string, number>();
    for (const r of siRows) {
      const t = dmy(r.transDate);
      if (!t) continue;
      const tgt = t.y === yA ? aggA : t.y === yB ? aggB : null;
      if (!tgt) continue;
      for (const l of siLinesById.get(Number(r.id)) ?? []) if (l.name) tgt.set(l.name, (tgt.get(l.name) ?? 0) + l.qty);
    }
    if (aggA.size >= 3 && aggB.size >= 3) {
      const tA = [...aggA.entries()].sort((a, b) => b[1] - a[1])[0];
      const tB = [...aggB.entries()].sort((a, b) => b[1] - a[1])[0];
      Q(4, `Barang terlaris tahun ${yA} dan tahun ${yB} menurut unit — apakah sama? Sebutkan keduanya.`, [esc(tA[0]), esc(tB[0])], "item");
    }
    // retur per tahun
    const rA = (M["sales-return"]?.rows ?? []).filter((r) => periodSI(r, pA));
    const rB = (M["sales-return"]?.rows ?? []).filter((r) => periodSI(r, pB));
    if (rA.length && rB.length)
      Q(4, `Ada berapa retur penjualan tahun ${yA} dan tahun ${yB}?`, [cntRe(rA.length), cntRe(rB.length)], "sales-return");
  }
}

/* ============ TAMBAL T5 — majemuk tambahan ============ */
{
  // per bulan besar: total + jumlah faktur + pelanggan terbesar
  for (const ym of ["2016-09", "2016-11", "2017-01", "2016-10"]) {
    const [ys, ms] = ym.split("-");
    const p: any = P(+ys, +ms, +ms);
    const rows = siRows.filter((r) => periodSI(r, p));
    const pc = perCust(p);
    if (rows.length >= 3 && pc.length >= 1) {
      const label = `${monthNames[+ms - 1]} ${ys}`;
      Q(5, `Berapa total penjualan bulan ${label}, ada berapa faktur, dan siapa pelanggan terbesarnya?`, [rpRe(sum(rows)), cntRe(rows.length), esc(pc[0].name)], "sales-invoice");
    }
  }
  // piutang & utang tahun + pemasok & pelanggan top tahun itu
  for (const y of yTop) {
    const p: any = P(y);
    const unS = siRows.filter((r) => periodSI(r, p) && r.statusName !== "Lunas");
    const unP = piRows.filter((r) => periodPI(r, p) && r.statusName !== "Lunas");
    if (unS.length && unP.length)
      Q(5, `Berapa piutang dan utang dari transaksi tahun ${y}?`, [rpRe(sum(unS)), rpRe(sum(unP))], "sales-invoice");
    const pc = perCust(p);
    if (pc.length >= 3) {
      const c = pc[0];
      const mine = siRows.filter((r) => periodSI(r, p) && String(r.customer?.name ?? "") === c.name);
      Q(5, `Pelanggan penjualan terbesar tahun ${y}: siapa, berapa nilainya, dan ada berapa fakturnya?`, [esc(c.name), rpRe(c.total), cntRe(mine.length)], "sales-invoice");
    }
    const pv = perVendor(p);
    if (pv.length >= 3) {
      const v = pv[0];
      const mine = piRows.filter((r) => periodPI(r, p) && String(r.vendor?.name ?? "") === v.name);
      Q(5, `Pemasok pembelian terbesar tahun ${y}: siapa, berapa nilainya, dan ada berapa fakturnya?`, [esc(v.name), rpRe(v.total), cntRe(mine.length)], "purchase-invoice");
    }
  }
  // piutang top3 utuh: total nilai + jumlah fakturnya
  {
    const un = siRows.filter((r) => r.statusName !== "Lunas");
    const byC = new Map<string, { t: number; n: number }>();
    for (const r of un) {
      const k = String(r.customer?.name ?? "");
      const g = byC.get(k) ?? { t: 0, n: 0 };
      g.t += Number(r.totalAmount) || 0;
      g.n += 1;
      byC.set(k, g);
    }
    const top3 = [...byC.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, 3);
    if (top3.length === 3) {
      const t = top3.reduce((s, [, g]) => s + g.t, 0);
      const n = top3.reduce((s, [, g]) => s + g.n, 0);
      Q(5, `Gabungan piutang tiga pelanggan terbesar (dari yang belum lunas): berapa totalnya dan berapa jumlah fakturnya?`, [rpRe(t), cntRe(n)], "sales-invoice");
      Q(5, `Siapa saja tiga pelanggan dengan piutang belum lunas terbesar beserta totalnya?`, top3.map(([name]) => esc(name)), "sales-invoice");
    }
    const unP = piRows.filter((r) => r.statusName !== "Lunas");
    const byV = new Map<string, { t: number; n: number }>();
    for (const r of unP) {
      const k = String(r.vendor?.name ?? "");
      const g = byV.get(k) ?? { t: 0, n: 0 };
      g.t += Number(r.totalAmount) || 0;
      g.n += 1;
      byV.set(k, g);
    }
    const top3v = [...byV.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, 3);
    if (top3v.length === 3) {
      const t = top3v.reduce((s, [, g]) => s + g.t, 0);
      const n = top3v.reduce((s, [, g]) => s + g.n, 0);
      Q(5, `Gabungan utang tiga pemasok terbesar (yang belum lunas): berapa totalnya dan berapa jumlah fakturnya?`, [rpRe(t), cntRe(n)], "purchase-invoice");
    }
  }
  // faktur jatuh tempo terdekat lengkap
  {
    const unb = siRows.filter((r) => r.statusName !== "Lunas" && r.dueDate).sort((a, b) => {
      const A = dmy(a.dueDate)!, B = dmy(b.dueDate)!;
      return A.y - B.y || A.m - B.m || A.d - B.d;
    });
    if (unb.length) {
      const f = unb[0];
      // 18 faktur berbagi dueDate sama → GT cek tanggal jatuh tempo saja (nomor/nilai bebas)
      void f;
      Q(5, `Faktur penjualan mana yang jatuh temponya paling dekat (belum lunas)? Sebutkan nomornya, nilainya, dan pelanggannya.`, [dateRe(unb[0].dueDate)], "sales-invoice");
    }
  }
  // retur jual + retur beli + selisih
  {
    const sret = M["sales-return"]?.rows ?? [];
    const pret = M["purchase-return"]?.rows ?? [];
    if (sret.length && pret.length) {
      const a = sum(sret),
        b = sum(pret);
      Q(5, "Berapa total retur penjualan dan total retur pembelian? Mana yang lebih besar?", [rpRe(a), rpRe(b)], "sales-return");
      Q(5, "Ada berapa retur penjualan dan berapa retur pembelian?", [cntRe(sret.length), cntRe(pret.length)], "sales-return");
    }
  }
  // modul dokumen ringkas
  {
    const so = M["sales-order"]?.rows ?? [];
    const po = M["purchase-order"]?.rows ?? [];
    if (so.length && po.length)
      Q(5, "Ada berapa surat pesanan penjualan dan berapa surat pesanan pembelian?", [cntRe(so.length), cntRe(po.length)], "sales-order");
    const doRows = M["delivery-order"]?.rows ?? [];
    const sr = M["sales-receipt"]?.rows ?? [];
    if (doRows.length && sr.length)
      Q(5, "Ada berapa surat jalan dan berapa bukti penerimaan penjualan?", [cntRe(doRows.length), cntRe(sr.length)], "delivery-order");
  }
  // expense terbaru lengkap
  {
    const exp = M["expense"]?.rows ?? [];
    if (exp.length >= 3) {
      const sorted = [...exp].sort((a, b) => {
        const A = dmy(a.transDate)!, B = dmy(b.transDate)!;
        return A.y - B.y || A.m - B.m || A.d - B.d;
      });
      const last = sorted[sorted.length - 1];
      // nominal (nomor) di antara faktur ber-tanggal sama — GT terima salah satu
      const tied = exp.filter((r) => r.transDate === last.transDate);
      const numAlt = tied.length > 1 ? `(?:${tied.map((r) => esc(String(r.number))).join("|")})` : esc(String(last.number));
      Q(5, "Kapan transaksi biaya paling baru dan berapa jumlahnya? (sebutkan tanggal dan nomor)", [esc(last.transDate), numAlt], "expense");
      Q(5, "Ada berapa transaksi biaya sama sekali dan tahun mana yang paling banyak?", [cntRe(exp.length)], "expense");
    }
  }
  // fixed-asset terbaru
  {
    const fa = M["fixed-asset"]?.rows ?? [];
    if (fa.length >= 5) {
      const withQty = fa.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
      Q(5, "Ada berapa aset tetap dan berapa total unitnya?", [cntRe(fa.length), cntRe(withQty)], "fixed-asset");
      const desc = fa.find((r) => /komputer/i.test(String(r.description ?? "")));
      if (desc) Q(5, "Sebutkan nomor aset tetap yang berdeskripsi 'Komputer 09' dan kapan dicatat?", [esc(desc.number), esc(desc.transDate)], "fixed-asset");
    }
  }
  // jumlah akun + gudang + satuan
  {
    const gl = M["glaccount"]?.rows ?? [];
    const wh = M["warehouse"]?.rows ?? [];
    const un = M["unit"]?.rows ?? [];
    if (gl.length && wh.length && un.length)
      Q(5, "Ada berapa akun perkiraan, berapa gudang, dan berapa satuan barang?", [cntRe(gl.length), cntRe(wh.length), cntRe(un.length)], "glaccount");
  }
  // jurnal umum terbanyak per tahun
  {
    const rows = M["journal-voucher"]?.rows ?? [];
    const byYear = new Map<number, number>();
    for (const r of rows) {
      const t = dmy(r.transDate);
      if (t) byYear.set(t.y, (byYear.get(t.y) ?? 0) + 1);
    }
    const top = [...byYear.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) Q(5, `Tahun berapa yang paling banyak memiliki jurnal umum dan berapa jumlahnya?`, [cntRe(top[1])], "journal-voucher");
  }
  // top customer: total + last order + status
  for (const c of topCusts.slice(1, 4)) {
    const mine = siRows.filter((r) => String(r.customer?.name ?? "") === c.name);
    const dates = mine.map((r) => r.transDate).sort((a, b) => {
      const A = dmy(a)!, B = dmy(b)!;
      return A.y - B.y || A.m - B.m || A.d - B.d;
    });
    if (mine.length && dates.length)
      Q(5, `Pelanggan ${c.name}: berapa total penjualan, kapan faktur terakhirnya, dan siapa nomor pelanggannya?`, [rpRe(c.total), esc(dates[dates.length - 1]), esc(String(mine[0].customerNo ?? ""))], "sales-invoice");
  }
}

// 4 modul sisa: access-privilege, auto-number, freeonboard, job-order
{
  const ap = M["access-privilege"]?.rows ?? [];
  if (ap.length) {
    Q(1, "Ada berapa hak akses (access privilege) yang terdaftar?", [cntRe(ap.length)], "access-privilege");
    if (ap.length <= 8)
      Q(1, "Hak akses apa saja yang terdaftar di sistem?", ap.slice(0, 5).map((r: any) => esc(String(r.name ?? ""))), "access-privilege");
  }
  const an = M["auto-number"]?.rows ?? [];
  if (an.length) Q(1, "Ada berapa aturan penomoran otomatis (auto number) yang terdaftar?", [cntRe(an.length)], "auto-number");
  const fo = M["freeonboard"]?.rows ?? [];
  if (fo.length <= 6 && fo.length >= 2)
    Q(1, "Opsi free on board apa saja yang terdaftar?", fo.slice(0, 4).map((r: any) => esc(String(r.name ?? ""))), "freeonboard");
  const jo = M["job-order"]?.rows ?? [];
  if (jo.length) {
    Q(1, "Ada berapa job order yang tercatat?", [cntRe(jo.length)], "job-order");
    Q(1, "Berapa total nilai seluruh job order?", [rpRe2(sum(jo))], "job-order");
    const byYear = new Map<number, number>();
    for (const r of jo) {
      const t = dmy(r.transDate);
      if (t) byYear.set(t.y, (byYear.get(t.y) ?? 0) + 1);
    }
    for (const [y, n] of byYear)
      if (n >= 3) Q(1, `Ada berapa job order tahun ${y}?`, [cntRe(n)], "job-order");
    const top = [...jo].sort((a, b) => Number(b.totalAmount) - Number(a.totalAmount))[0];
    if (top) Q(3, "Job order mana yang nilainya terbesar? Sebutkan nomor dan nilainya.", [factRe(top.number), rpRe2(top.totalAmount)], "job-order");
    const custs = new Set(jo.map((r: any) => String(r.customer?.name ?? "")).filter(Boolean));
    if (custs.size >= 2) Q(3, "Pelanggan mana saja yang punya job order?", [...custs].slice(0, 4).map(esc), "job-order");
  }
}

/* ================= validasi & output ================= */
// buang placeholder (harusnya tak ada yang lolos — cek eksplisit)
const cleaned = out.filter((q) => !q.must.some((m) => m.includes("placeholder") || m === "0" && false) && q.module !== "n/a" && q.must[0] !== "(placeholder-aset-)");
const tiers: Record<number, number> = {};
const byMod: Record<string, number> = {};
for (const q of cleaned) {
  tiers[q.tier] = (tiers[q.tier] || 0) + 1;
  byMod[q.module] = (byMod[q.module] || 0) + 1;
}
console.log("total soal:", cleaned.length, "| tier:", tiers);
console.log("modul tercakup:", Object.keys(byMod).length);
console.log(
  Object.entries(byMod)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(" ")
);
writeFileSync(OUT, JSON.stringify(cleaned, null, 1), "utf8");
console.log("→", OUT);
