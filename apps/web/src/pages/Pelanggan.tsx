import { useEffect, useRef, useState } from "react";
import type { ConnectionInfo, Me } from "@aigoogle/shared";
import {
  friendlyWarning,
  getConnections,
  getMe,
  postEntry,
  uploadRead,
  uploadScan,
  type ScanResponse,
} from "../api";
import { AppHeader } from "../ui";

const rp = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `Rp ${Math.round(n).toLocaleString("id-ID")}`;

const TARGET_LABEL: Record<string, string> = {
  salesInvoice: "Faktur penjualan (Accurate)",
  salesReceipt: "Penerimaan kas (Accurate)",
};

const DOC_LABEL: Record<string, string> = {
  faktur: "Faktur",
  nota: "Nota",
  kwitansi: "Kwitansi",
  lainnya: "Dokumen lain / bukti transfer",
};

export function Pelanggan() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof getMe>> | undefined>(undefined);
  const [conns, setConns] = useState<ConnectionInfo[]>([]);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"scan" | "reader">("scan");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [camErr, setCamErr] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // matikan kamera saat halaman ditutup (hook WAJIB sebelum early-return agar urutan stabil)
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  const [form, setForm] = useState({ customerName: "", date: "", no: "", total: "", description: "" });
  const [target, setTarget] = useState<"" | "salesInvoice" | "salesReceipt">("");
  const [readText, setReadText] = useState<{ fileName: string; text: string; engine: string } | null>(null);

  useEffect(() => {
    void getMe().then(setMe);
    void getConnections().then(setConns).catch(() => undefined);
  }, []);

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
  const onScanFile = async (file: File | undefined) => {
    if (!file) return;
    setErr(""); setOkMsg(""); setScan(null); setReadText(null);
    setBusy(true);
    try {
      const res = await uploadScan(file);
      setScan(res);
      setForm({
        customerName: res.fields.customerName || "",
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
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ── Kamera langsung: foto → AI baca & simpulkan jenis dokumen ────────────
  const stopCam = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOn(false);
  };

  async function startCam() {
    setCamErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      streamRef.current = stream;
      setCamOn(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setCamErr("Kamera tidak dapat diakses — gunakan tombol ambil foto (alternatif) di bawah.");
    }
  }

  function shootCam() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")?.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        stopCam();
        if (!blob) return;
        void onScanFile(new File([blob], `kamera-${Date.now()}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92
    );
  }

  return (
    <div className="app">
      <AppHeader me={me} />
      <main className="page">
        <h1>Scan Nota & Bukti Bayar</h1>
        <p className="page__sub">
          {me.tenant.name} · {connected ? "Accurate terhubung" : "Accurate belum terhubung"}
        </p>

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
            <strong className="card__title">Foto dokumen — AI membaca & menyimpulkan</strong>
            <p className="meta">
              Arahkan kamera ke nota / faktur / kwitansi / bukti transfer → ambil foto → AI membaca isinya
              dan menyimpulkan jenis dokumennya. Periksa hasilnya, lalu simpan ke Accurate.
            </p>

            {!camOn ? (
              <div className="btn-row">
                <button className="btn" onClick={() => void startCam()}>📷 Buka Kamera</button>
                <label className="btn btn--2" style={{ cursor: "pointer" }}>
                  Ambil foto (alternatif)
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onScanFile(f);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
            ) : (
              <div>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  style={{ width: "100%", maxWidth: 560, borderRadius: 8, background: "#000" }}
                />
                <div className="btn-row" style={{ marginTop: "var(--space-xs)" }}>
                  <button className="btn" onClick={shootCam} disabled={busy}>📸 Ambil Foto & Baca dengan AI</button>
                  <button className="btn btn--2" onClick={stopCam}>Tutup kamera</button>
                </div>
              </div>
            )}
            {camErr && <p className="meta" style={{ color: "var(--danger, #c0392b)" }}>{camErr}</p>}

            <details style={{ marginTop: "var(--space-xs)" }}>
              <summary style={{ cursor: "pointer", fontSize: "var(--step--1)", color: "var(--ink-2)" }}>
                Atau unggah file (PDF, DOCX, teks)
              </summary>
              <input
                className="input-file"
                type="file"
                accept="image/*,.pdf,.docx,.pptx,.doc,.ppt,.md,.txt"
                onChange={(e) => void onScanFile(e.target.files?.[0])}
                style={{ marginTop: "var(--space-xs)" }}
              />
            </details>
            {busy && <p className="meta">AI sedang membaca dokumen…</p>}

            {scan && (
              <p className="banner banner--ok" role="status" style={{ marginTop: "var(--space-xs)" }}>
                AI menyimpulkan: <b>{DOC_LABEL[scan.fields.docType] ?? scan.fields.docType}</b>
                {scan.suggestedTarget ? <> — disarankan disimpan sebagai <b>{TARGET_LABEL[scan.suggestedTarget]}</b></> : null}.
                Periksa & lengkapi kolom di bawah.
              </p>
            )}

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
