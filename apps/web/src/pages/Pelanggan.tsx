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
import { AppHeader } from "../ui";

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
  }, []);

  const canCustomer = !!me?.permissions?.includes("accurate:customer.view");
  useEffect(() => {
    if (canCustomer) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCustomer]);

  if (me === undefined) {
    return (
      <div className="app">
        <main className="page page--narrow">
          <p className="meta">Memuat…</p>
        </main>
      </div>
    );
  }
  if (me === null) {
    window.location.href = "/login";
    return null;
  }

  const accurate = conns.find((c) => c.provider === "accurate");
  const connected = accurate?.status === "connected";
  const canInvoice = !!me.permissions?.includes("accurate:sales-invoice.view");
  const canReceipt = !!me.permissions?.includes("accurate:sales-receipt.view");

  // Admin Platform tidak memakai halaman Scan — arahkan ke kelola User & Peran
  if (me.permissions?.includes("app:settings.manage")) {
    window.location.replace("/admin");
    return null;
  }
  if (!canCustomer) {
    return (
      <div className="app">
        <AppHeader me={me} />
        <main className="page page--narrow">
          <h1>Scan Nota & Bukti Bayar</h1>
          <div className="card">
            <strong>Anda tidak punya akses menu Scan.</strong>
            <p className="meta" style={{ marginTop: 6, marginBottom: 0 }}>
              Hak akses data pelanggan diatur oleh admin di menu User & Peran. Hubungi administrator Anda.
            </p>
          </div>
          <a className="btn btn--ghost btn--sm" href="/app">
            ← Kembali ke dashboard
          </a>
        </main>
      </div>
    );
  }

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
    if (target === "salesInvoice" && !canInvoice) return setErr("Anda tidak punya hak membuat faktur penjualan.");
    if (target === "salesReceipt" && !canReceipt) return setErr("Anda tidak punya hak membuat penerimaan kas.");
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
    <div className="app">
      <AppHeader me={me} />
      <main className="page">
        <h1>Scan Nota & Bukti Bayar</h1>
        <p className="page__sub">
          {me.tenant.name} · {connected ? "Accurate terhubung" : "Accurate belum terhubung"}
        </p>

        <h2 className="section-title" style={{ marginTop: 0 }}>Data pelanggan</h2>
        <div className="card" style={{ marginBottom: "var(--space-xs)" }}>
          <div className="row">
            <input
              className="input"
              style={{ flex: "1 1 220px", maxWidth: 360 }}
              type="search"
              inputMode="search"
              placeholder="Cari pelanggan…"
              aria-label="Cari pelanggan"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") reload(q); }}
            />
            <button className="btn" onClick={() => reload(q)}>Cari</button>
            {customers && (
              <span className="meta num">{customers.length} pelanggan</span>
            )}
          </div>
        </div>

        <div className="table-wrap" style={{ marginBottom: "var(--space-s)" }}>
          {customers === null ? (
            <p className="empty">Memuat data pelanggan…</p>
          ) : customers.length === 0 ? (
            <p className="empty">
              {connected ? "Tidak ada pelanggan yang cocok." : "Hubungkan Accurate dulu untuk melihat data pelanggan."}
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th className="num">Faktur</th>
                  <th className="num">Total faktur</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="num">{c.invoiceCount}</td>
                    <td className="num">{rp(c.invoiceTotal)}</td>
                    <td>
                      <button
                        className={`btn btn--sm ${selected === c.name ? "" : "btn--2"}`}
                        onClick={() => setSelected(selected === c.name ? "" : c.name)}
                        aria-pressed={selected === c.name}
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

        <div className="tabs" role="group" aria-label="Mode input">
          <button className="tab" aria-pressed={tab === "scan"} onClick={() => setTab("scan")}>
            Scan → Input Accurate
          </button>
          <button className="tab" aria-pressed={tab === "reader"} onClick={() => setTab("reader")}>
            Baca file
          </button>
        </div>

        {err && <p className="banner banner--err" role="alert">{err}</p>}
        {okMsg && <p className="banner banner--ok" role="status">{okMsg}</p>}

        {tab === "scan" ? (
          <section className="card">
            <strong className="card__title">Scan nota / faktur / kwitansi</strong>
            <p className="meta">
              Foto atau unggah gambar/PDF (nota, bukti transfer, faktur, kwitansi, screenshot) atau file teks
              (MD, TXT, DOCX, PPTX). Hasil baca ditampilkan untuk diperiksa dulu sebelum disimpan ke Accurate.
              {selected && <> · Pelanggan terpilih: <b>{selected}</b></>}
            </p>
            <input
              className="input-file"
              type="file"
              accept="image/*,.pdf,.docx,.pptx,.doc,.ppt,.md,.txt"
              onChange={(e) => void onScanFile(e.target.files?.[0])}
            />
            {busy && <p className="meta">Membaca dokumen…</p>}

            {scan && (
              <div style={{ marginTop: "var(--space-s)" }}>
                <details style={{ fontSize: "var(--step--1)", color: "var(--ink-2)", marginBottom: "var(--space-xs)" }}>
                  <summary style={{ cursor: "pointer" }}>Teks terbaca: {scan.fileName}</summary>
                  <pre className="block">{scan.rawText || "(kosong)"}</pre>
                </details>

                <div className="grid-2">
                  <label className="field">
                    Simpan sebagai
                    <select
                      className="select"
                      value={target}
                      onChange={(e) => setTarget(e.target.value as typeof target)}
                    >
                      <option value="">— pilih —</option>
                      <option value="salesInvoice" disabled={!canInvoice}>Faktur penjualan{canInvoice ? "" : " — tanpa hak"}</option>
                      <option value="salesReceipt" disabled={!canReceipt}>Penerimaan kas{canReceipt ? "" : " — tanpa hak"}</option>
                    </select>
                  </label>
                  <label className="field">
                    Nama pelanggan
                    <input
                      className="input"
                      value={form.customerName}
                      onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                      placeholder="cth. Budi Santoso"
                    />
                  </label>
                  <label className="field">
                    Tanggal (YYYY-MM-DD)
                    <input
                      className="input num"
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm({ ...form, date: e.target.value })}
                      placeholder="2026-10-05"
                    />
                  </label>
                  <label className="field">
                    Nomor dokumen
                    <input
                      className="input"
                      value={form.no}
                      onChange={(e) => setForm({ ...form, no: e.target.value })}
                      placeholder="NOTA-7"
                    />
                  </label>
                  <label className="field">
                    Total (Rp)
                    <input
                      className="input num"
                      inputMode="numeric"
                      value={form.total}
                      onChange={(e) => setForm({ ...form, total: e.target.value })}
                      placeholder="150000"
                    />
                  </label>
                  <label className="field">
                    Keterangan
                    <input
                      className="input"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="Penjualan kertas"
                    />
                  </label>
                </div>

                <div className="btn-row" style={{ marginTop: "var(--space-s)" }}>
                  <button className="btn" disabled={busy} onClick={() => void saveEntry()}>
                    {busy ? "Menyimpan…" : "Simpan ke Accurate"}
                  </button>
                  <button
                    className="btn btn--2"
                    onClick={() => { setScan(null); setErr(""); }}
                  >
                    Batal
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : (
          <section className="card">
            <strong className="card__title">Baca file</strong>
            <p className="meta">
              Baca isi PDF, gambar (foto nota, bukti transfer, kwitansi, screenshot), PowerPoint (PPT/PPTX),
              Word (DOC/DOCX), Markdown, atau teks biasa. Mode Vision &amp; OCR menentukan apakah gambar/PDF bisa dibaca.
            </p>
            <input
              className="input-file"
              type="file"
              accept="image/*,.pdf,.docx,.pptx,.doc,.ppt,.md,.txt"
              onChange={(e) => void onReadFile(e.target.files?.[0])}
            />
            {busy && <p className="meta">Membaca file…</p>}
            {readText && (
              <div style={{ marginTop: "var(--space-xs)" }}>
                <p className="meta">
                  {readText.fileName} · mesin: {readText.engine}
                </p>
                <pre className="block">{readText.text}</pre>
              </div>
            )}
          </section>
        )}

        <a className="btn btn--ghost btn--sm" href="/app">
          ← Kembali
        </a>
      </main>
    </div>
  );
}
