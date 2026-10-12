import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "../ui";
import { getAccurateWebhookEvents, type AccurateEventRow } from "../api";

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

function ringkas(row: AccurateEventRow): string {
  const p = row.payload as { data?: Record<string, unknown>; _meta?: unknown } | null;
  const d = (p?.data ?? ({} as Record<string, unknown>)) as Record<string, unknown>;
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

  const load = useCallback((event = "") => {
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
    load();
  }, [load]);

  const filtered = (rows ?? []).filter((r) =>
    q ? (EVENT_LABEL[r.event] ?? r.event).toLowerCase().includes(q.toLowerCase()) || r.event.toLowerCase().includes(q.toLowerCase()) : true
  );

  return (
    <div className="app">
      <AppHeader />
      <main className="page">
        <h1>Aktivitas Accurate</h1>
        <p className="meta">
          Riwayat perubahan data dari Accurate Online (webhook). Data terbaru otomatis masuk tanpa perlu refresh manual.
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
        {rows === null ? (
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
              {filtered.map((r) => (
                <li
                  key={r.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "var(--space-s)",
                    padding: "var(--space-s) 0",
                    borderBottom: "1px solid var(--border, #e5e5e5)",
                  }}
                >
                  <div>
                    <strong>{EVENT_LABEL[r.event] ?? r.event}</strong>
                    <div className="meta">{ringkas(r)}</div>
                  </div>
                  <span className="meta" style={{ whiteSpace: "nowrap" }}>
                    {waktu(r.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
