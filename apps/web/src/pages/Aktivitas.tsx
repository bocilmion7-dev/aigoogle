import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../ui";
import { getAccurateWebhookEvents, getMe, type AccurateEventRow } from "../api";

const EVENT_LABEL: Record<string, string> = {
  CUSTOMER: "Pelanggan",
  VENDOR: "Pemasok",
  ITEM: "Barang & Jasa",
  ITEM_CATEGORY: "Kategori Barang",
  ITEM_TRANSFER: "Transfer Barang",
  ITEM_ADJUSTMENT: "Penyesuaian Stok",
  UNIT: "Satuan",
  WAREHOUSE: "Gudang",
  SALES_INVOICE: "Faktur Penjualan",
  SALES_ORDER: "Pesanan Penjualan",
  SALES_QUOTATION: "Penawaran",
  SALES_RECEIPT: "Penerimaan Kas",
  SALES_RETURN: "Retur Penjualan",
  PURCHASE_INVOICE: "Faktur Pembelian",
  PURCHASE_ORDER: "Pesanan Pembelian",
  PURCHASE_RETURN: "Retur Pembelian",
  PURCHASE_PAYMENT: "Pembayaran Pembelian",
  JOURNAL_VOUCHER: "Buku Jurnal",
  GLACCOUNT: "Akun GL",
  TAX: "Pajak",
  CURRENCY: "Mata Uang",
  DEPARTMENT: "Departemen",
  PROJECT: "Proyek",
  EMPLOYEE: "Karyawan",
  BRANCH: "Cabang",
  DELIVERY_ORDER: "Surat Jalan",
  RECEIVE_ITEM: "Penerimaan Barang",
  FIXED_ASSET: "Aset Tetap",
  GOLIVE: "Go Live",
};

/** label id-ID utk field payload yang umum */
const FIELD_LABEL: Record<string, string> = {
  id: "ID",
  no: "Nomor",
  number: "Nomor",
  name: "Nama",
  code: "Kode",
  description: "Keterangan",
  email: "Email",
  phone: "Telepon",
  phone1: "Telepon",
  mobilePhone: "HP",
  address: "Alamat",
  status: "Status",
  statusName: "Status",
  date: "Tanggal",
  transDate: "Tanggal transaksi",
  dueDate: "Jatuh tempo",
  createDate: "Dibuat",
  totalAmount: "Total",
  total: "Total",
  amount: "Nilai",
  paymentAmount: "Dibayar",
  remainingAmount: "Sisa",
  customerName: "Pelanggan",
  vendorName: "Pemasok",
  customer: "Pelanggan",
  vendor: "Pemasok",
  itemNo: "Barang",
  quantity: "Jumlah",
  price: "Harga",
  unit1Name: "Satuan",
  warehouse: "Gudang",
  branchName: "Cabang",
  type: "Jenis",
};

const AMOUNT_KEYS = new Set(["totalAmount", "total", "amount", "paymentAmount", "remainingAmount", "price"]);
const DATE_KEYS = new Set(["date", "transDate", "dueDate", "createDate"]);

function payloadData(row: AccurateEventRow): Record<string, unknown> {
  const p = row.payload as { data?: unknown; _meta?: unknown } | null;
  if (p && typeof p === "object" && p.data !== undefined) {
    return typeof p.data === "object" && p.data !== null ? (p.data as Record<string, unknown>) : { data: p.data };
  }
  if (row.payload && typeof row.payload === "object") return row.payload as Record<string, unknown>;
  return {};
}

/** pasangan field → nilai yang layak tampil di detail (tanpa null/kosong/nested) */
function detailFields(row: AccurateEventRow): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const data = payloadData(row);
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined || v === "") continue;
    const label = FIELD_LABEL[k] ?? k;
    if (typeof v === "number") {
      out.push([label, AMOUNT_KEYS.has(k) ? `Rp ${v.toLocaleString("id-ID")}` : v.toLocaleString("id-ID")]);
    } else if (typeof v === "boolean") {
      out.push([label, v ? "ya" : "tidak"]);
    } else if (typeof v === "string") {
      if (DATE_KEYS.has(k)) {
        const d = new Date(v);
        out.push([label, isNaN(d.getTime()) ? v : d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })]);
      } else if (v.length <= 120) {
        out.push([label, v]);
      }
    }
    // object/array (mis. customer:{name}) — ambil name bila ada
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const name = (v as Record<string, unknown>).name;
      if (typeof name === "string" && name) out.push([label, name]);
    }
  }
  if (row.dbId) out.push(["Database", row.dbId]);
  return out;
}

function ringkas(row: AccurateEventRow): string {
  const d = payloadData(row);
  if (row.event === "CUSTOMER") return `Pelanggan ${String(d.name ?? "")}`;
  if (row.event === "VENDOR") return `Pemasok ${String(d.name ?? "")}`;
  if (row.event === "ITEM") return `Barang ${String(d.name ?? "")}`;
  if (row.event === "SALES_INVOICE")
    return `Faktur ${String(d.no ?? "")} — Rp${Number(d.totalAmount ?? d.total ?? 0).toLocaleString("id-ID")}`;
  if (row.event === "PURCHASE_INVOICE")
    return `Faktur pembelian ${String(d.no ?? "")} — Rp${Number(d.totalAmount ?? d.total ?? 0).toLocaleString("id-ID")}`;
  if (row.event === "SALES_ORDER") return `Pesanan penjualan ${String(d.no ?? "")}`;
  if (row.event === "PURCHASE_ORDER") return `Pesanan pembelian ${String(d.no ?? "")}`;
  if (row.event === "JOURNAL_VOUCHER") return `Buku jurnal ${String(d.no ?? "")}`;
  return "Data diperbarui di Accurate";
}

const waktu = (iso: string) => {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "baru saja";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} menit lalu`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} jam lalu`;
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
};

export function Aktivitas() {
  const [rows, setRows] = useState<AccurateEventRow[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);

  useEffect(() => {
    void getMe().then(setMe);
  }, []);
  const bolehLihat = !!me?.permissions?.includes("app:audit.view");
  const meLoaded = me !== undefined;

  const load = useCallback((boleh: boolean) => {
    if (!boleh) {
      setRows([]);
      return;
    }
    void getAccurateWebhookEvents(100)
      .then((d) => {
        setRows(d);
        setErr("");
      })
      .catch(() => {
        setRows([]);
        setErr("Gagal memuat aktivitas Accurate.");
      });
  }, []);
  useEffect(() => {
    if (me === undefined) return;
    load(bolehLihat);
  }, [me, bolehLihat, load]);

  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const filtered = (rows ?? []).filter((r) =>
    q ? (EVENT_LABEL[r.event] ?? r.event).toLowerCase().includes(q.toLowerCase()) || r.event.toLowerCase().includes(q.toLowerCase()) : true
  );

  return (
    <div className="app">
      <AppHeader />
      <main className="page">
        <h1>Aktivitas Accurate</h1>
        <p className="meta">
          Riwayat perubahan data dari Accurate Online (webhook). Klik baris untuk melihat detail datanya.
        </p>
        {err && <div className="card" style={{ borderColor: "var(--danger, #c0392b)" }}>{err}</div>}
        <div className="card" style={{ marginBottom: "var(--space-s)" }}>
          <input
            type="search"
            placeholder="Saring jenis data… (mis. faktur, pelanggan)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: "100%" }}
            aria-label="Saring aktivitas"
          />
        </div>
        {meLoaded && !bolehLihat ? (
          <div className="card">
            <strong>Aktivitas hanya untuk Admin Accurate.</strong>
            <p className="meta" style={{ marginTop: 6, marginBottom: 0 }}>
              Riwayat perubahan data perusahaan dikelola oleh admin perusahaan Anda.
            </p>
          </div>
        ) : rows === null ? (
          <p className="meta">Memuat…</p>
        ) : filtered.length === 0 ? (
          <div className="card">
            <strong>Belum ada aktivitas.</strong>
            <p className="meta" style={{ marginTop: 6, marginBottom: 0 }}>
              Perubahan data di Accurate Online akan tampil di sini secara otomatis begitu webhook pertama masuk.
            </p>
          </div>
        ) : (
          <div className="card">
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {filtered.map((r) => {
                const isOpen = open.has(r.id);
                const fields = detailFields(r);
                return (
                  <li
                    key={r.id}
                    style={{
                      borderBottom: "1px solid var(--border, #e5e5e5)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(r.id)}
                      aria-expanded={isOpen}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: "var(--space-s)",
                        width: "100%",
                        padding: "var(--space-s) 0",
                        background: "none",
                        border: "none",
                        textAlign: "left",
                        cursor: "pointer",
                        color: "inherit",
                        font: "inherit",
                      }}
                    >
                      <div>
                        <strong>
                          {EVENT_LABEL[r.event] ?? r.event}{" "}
                          <span className="meta" aria-hidden="true">
                            {isOpen ? "▾" : "▸"}
                          </span>
                        </strong>
                        <div className="meta">{ringkas(r)}</div>
                      </div>
                      <span className="meta" style={{ whiteSpace: "nowrap" }}>
                        {waktu(r.createdAt)}
                      </span>
                    </button>
                    {isOpen && (
                      <div style={{ padding: "0 0 var(--space-s)" }}>
                        {fields.length ? (
                          <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 640 }}>
                            <tbody>
                              {fields.map(([label, value], i) => (
                                <tr key={`${label}-${i}`}>
                                  <th
                                    scope="row"
                                    style={{
                                      textAlign: "left",
                                      padding: "4px 12px 4px 0",
                                      fontWeight: 600,
                                      whiteSpace: "nowrap",
                                      verticalAlign: "top",
                                      width: 180,
                                    }}
                                  >
                                    {label}
                                  </th>
                                  <td style={{ padding: "4px 0", wordBreak: "break-word" }}>{value}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="meta" style={{ margin: 0 }}>
                            Tidak ada detail tambahan pada event ini.
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
