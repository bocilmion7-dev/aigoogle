import { useEffect, useState } from "react";
import type { ConnectionInfo, Me } from "@aigoogle/shared";
import {
  friendlyWarning,
  getCustomers,
  getConnections,
  getMe,
  postEntry,
  uploadRead,
  uploadScan,
  type CustomerRow,
  type ScanResponse,
} from "../api";

const card: React.CSSProperties = {
  border: "1px solid #e3ddd4", borderRadius: 6, padding: 16, marginBottom: 12,
  background: "#faf8f5", fontFamily: "system-ui",
};
const btn: React.CSSProperties = {
  border: "none", borderRadius: 4, padding: "8px 14px", cursor: "pointer",
  background: "#3d6b54", color: "white", fontSize: 14,
};
const input: React.CSSProperties = {
  border: "1px solid #d8d1c6", borderRadius: 4, padding: "7px 9px", fontSize: 14,
  background: "white", fontFamily: "system-ui", width: "100%", boxSizing: "border-box",
};
const label: React.CSSProperties = { display: "block", fontSize: 13, color: "#5c544b", marginBottom: 4 };
const errBox: React.CSSProperties = { ...card, borderLeft: "3px solid #b3453a", color: "#8d352c", fontSize: 14 };
const okBox: React.CSSProperties = { ...card, borderLeft: "3px solid #3d6b54", color: "#2f5a44", fontSize: 14 };

const rp = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `Rp ${Math.round(n).toLocaleString("id-ID")}`;

const TARGET_LABEL: Record<string, string> = {
  salesInvoice: "Faktur penjualan (Accurate)",
  salesReceipt: "Penerimaan kas (Accurate)",
};

export function Pelanggan() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [conns, setConns] = useState<ConnectionInfo[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [tab, setTab] = useState<"scan" | "reader">("scan");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [form, setForm] = useState({ customerName: "", date: "", no: "", total: "", description: "" });
  const [target, setTarget] = useState<"" | "salesInvoice" | "salesReceipt">("");
  const [readText, setReadText] = useState<{ fileName: string; text: string; engine: string } | null>(null);

  const reload = (keywords = "") => {
    getCustomers(keywords)
      .then(setCustomers)
      .catch((e: Error) => {
        setCustomers([]);
        setErr(e.message);
      });
  };

  useEffect(() => {
    void getMe().then(setMe);
    void getConnections().then(setConns).catch(() => undefined);
    reload();
  }, []);

  if (me === undefined) return <p style={{ padding: 24, fontFamily: "system-ui" }}>Memuat…</p>;
  if (me === null) {
    window.location.href = "/login";
    return null;
  }

  const accurate = conns.find((c) => c.provider === "accurate");
  const connected = accurate?.status === "connected";

  const onScanFile = async (file: File | undefined) => {
    if (!file) return;
    setErr(""); setOkMsg(""); setScan(null); setReadText(null);
    setBusy(true);
    try {
      const res = await uploadScan(file);
      setScan(res);
      setForm({
        customerName: res.fields.customerName || selected || "",
        date: res.fields.date,
        no: res.fields.no,
        total: res.fields.total !== null ? String(res.fields.total) : "",
        description: res.fields.description,
      });
      setTarget(res.suggestedTarget ?? "");
      const warn = friendlyWarning(res.warning);
      if (warn) setErr(warn);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onReadFile = async (file: File | undefined) => {
    if (!file) return;
    setErr(""); setOkMsg(""); setReadText(null); setScan(null);
    setBusy(true);
    try {
      const res = await uploadRead(file);
      setReadText({ fileName: res.fileName, text: res.text, engine: res.engine });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveEntry = async () => {
    if (!target) return setErr("Pilih tujuan penyimpanan (faktur penjualan atau penerimaan kas).");
    if (!form.customerName.trim()) return setErr("Nama pelanggan wajib diisi.");
    setErr(""); setBusy(true);
    try {
      const totalNum = form.total.replace(/[^\d.]/g, "");
      const res = await postEntry({
        target,
        customerName: form.customerName.trim(),
        ...(form.date ? { date: form.date } : {}),
        ...(form.no ? { no: form.no } : {}),
        ...(totalNum ? { total: Number(totalNum) } : {}),
        ...(form.description ? { description: form.description } : {}),
      });
      setOkMsg(`Tersimpan ke ${TARGET_LABEL[target]} — no. referensi ${res.id}`);
      setScan(null);
      reload(q);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "40px auto", padding: 24 }}>
      <h1 style={{ fontSize: 24 }}>Pelanggan</h1>
      <p style={{ color: "#666" }}>
        {me.tenant.name} · {connected ? "Accurate terhubung" : "Accurate belum terhubung"}
      </p>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Data pelanggan</h2>
      <div style={{ ...card, display: "flex", gap: 8, alignItems: "center" }}>
        <input
          style={{ ...input, maxWidth: 260 }}
          placeholder="Cari pelanggan…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") reload(q); }}
        />
        <button style={btn} onClick={() => reload(q)}>Cari</button>
        {customers && (
          <span style={{ fontSize: 13, color: "#666" }}>{customers.length} pelanggan</span>
        )}
      </div>
      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        {customers === null ? (
          <p style={{ padding: 16, color: "#666", fontSize: 14 }}>Memuat…</p>
        ) : customers.length === 0 ? (
          <p style={{ padding: 16, color: "#666", fontSize: 14 }}>
            {connected ? "Tidak ada pelanggan cocok." : "Hubungkan Accurate dulu untuk melihat data pelanggan."}
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f1ece4", color: "#5c544b", textAlign: "left" }}>
                <th style={{ padding: "8px 12px" }}>Nama</th>
                <th style={{ padding: "8px 12px", textAlign: "right" }}>Faktur</th>
                <th style={{ padding: "8px 12px", textAlign: "right" }}>Total faktur</th>
                <th style={{ padding: "8px 12px" }} />
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid #eee7dd" }}>
                  <td style={{ padding: "8px 12px" }}>{c.name}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>{c.invoiceCount}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right" }}>{rp(c.invoiceTotal)}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <button
                      style={{ ...btn, padding: "4px 10px", fontSize: 13, background: selected === c.name ? "#5c544b" : "#3d6b54" }}
                      onClick={() => setSelected(selected === c.name ? "" : c.name)}
                    >
                      {selected === c.name ? "Terpilih ✓" : "Pilih"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, margin: "20px 0 12px" }}>
        <button
          style={{ ...btn, background: tab === "scan" ? "#3d6b54" : "#cfc7bb" }}
          onClick={() => setTab("scan")}
        >
          Scan → Input Accurate
        </button>
        <button
          style={{ ...btn, background: tab === "reader" ? "#3d6b54" : "#cfc7bb" }}
          onClick={() => setTab("reader")}
        >
          Baca file
        </button>
      </div>

      {err && <div style={errBox}>{err}</div>}
      {okMsg && <div style={okBox}>{okMsg}</div>}

      {tab === "scan" ? (
        <div style={card}>
          <strong>Scan nota / faktur / kwitansi</strong>
          <p style={{ color: "#666", fontSize: 13, margin: "6px 0 10px" }}>
            Foto atau unggah gambar/PDF (nota, bukti transfer, faktur, kwitansi, screenshot) atau file teks
            (MD, TXT, DOCX, PPTX). Hasil baca ditampilkan untuk diperiksa dulu sebelum disimpan ke Accurate.
            {selected && <> · Pelanggan terpilih: <b>{selected}</b></>}
          </p>
          <input
            type="file"
            accept="image/*,.pdf,.docx,.pptx,.doc,.ppt,.md,.txt"
            onChange={(e) => void onScanFile(e.target.files?.[0])}
          />
          {busy && <p style={{ color: "#666", fontSize: 14 }}>Membaca dokumen…</p>}

          {scan && (
            <div style={{ marginTop: 14 }}>
              <details style={{ fontSize: 13, color: "#5c544b", marginBottom: 10 }}>
                <summary>Teks terbaca: {scan.fileName}</summary>
                <pre style={{ whiteSpace: "pre-wrap", background: "#f1ece4", padding: 10, borderRadius: 4 }}>
                  {scan.rawText || "(kosong)"}
                </pre>
              </details>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={label}>Simpan sebagai</label>
                  <select
                    style={{ ...input, padding: "7px 9px" }}
                    value={target}
                    onChange={(e) => setTarget(e.target.value as typeof target)}
                  >
                    <option value="">— pilih —</option>
                    <option value="salesInvoice">Faktur penjualan</option>
                    <option value="salesReceipt">Penerimaan kas</option>
                  </select>
                </div>
                <div>
                  <label style={label}>Nama pelanggan</label>
                  <input
                    style={input}
                    value={form.customerName}
                    onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                    placeholder="cth. Budi Santoso"
                  />
                </div>
                <div>
                  <label style={label}>Tanggal (YYYY-MM-DD)</label>
                  <input
                    style={input}
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    placeholder="2026-10-05"
                  />
                </div>
                <div>
                  <label style={label}>Nomor dokumen</label>
                  <input
                    style={input}
                    value={form.no}
                    onChange={(e) => setForm({ ...form, no: e.target.value })}
                    placeholder="NOTA-7"
                  />
                </div>
                <div>
                  <label style={label}>Total (Rp)</label>
                  <input
                    style={input}
                    value={form.total}
                    onChange={(e) => setForm({ ...form, total: e.target.value })}
                    placeholder="150000"
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label style={label}>Keterangan</label>
                  <input
                    style={input}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Penjualan kertas"
                  />
                </div>
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                <button style={btn} disabled={busy} onClick={() => void saveEntry()}>
                  {busy ? "Menyimpan…" : "Simpan ke Accurate"}
                </button>
                <button
                  style={{ ...btn, background: "#cfc7bb", color: "#3f3a33" }}
                  onClick={() => { setScan(null); setErr(""); }}
                >
                  Batal
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={card}>
          <strong>Baca file</strong>
          <p style={{ color: "#666", fontSize: 13, margin: "6px 0 10px" }}>
            Baca isi PDF, gambar (foto nota, bukti transfer, kwitansi, screenshot), PowerPoint (PPT/PPTX),
            Word (DOC/DOCX), Markdown, atau teks biasa. Mode Vision & OCR menentukan apakah gambar/PDF bisa dibaca.
          </p>
          <input
            type="file"
            accept="image/*,.pdf,.docx,.pptx,.doc,.ppt,.md,.txt"
            onChange={(e) => void onReadFile(e.target.files?.[0])}
          />
          {busy && <p style={{ color: "#666", fontSize: 14 }}>Membaca file…</p>}
          {readText && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 13, color: "#5c544b" }}>
                {readText.fileName} · mesin: {readText.engine}
              </p>
              <pre style={{ whiteSpace: "pre-wrap", background: "#f1ece4", padding: 12, borderRadius: 4, fontSize: 13 }}>
                {readText.text}
              </pre>
            </div>
          )}
        </div>
      )}

      <a href="/app" style={{ color: "#3d6b54", fontSize: 14 }}>← Kembali</a>
    </main>
  );
}
