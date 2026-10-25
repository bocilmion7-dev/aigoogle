import { useEffect, useRef, useState } from "react";
import type { ConnectionInfo, Me } from "@aigoogle/shared";
import {
  friendlyWarning,
  getConnections,
  getEntryOptions,
  getMe,
  postEntry,
  uploadScan,
  type EntryOptions,
  type EntryTarget,
  type ScanResponse,
} from "../api";
import { AppHeader, PageLoader } from "../ui";
import { IconCamera, IconCheck, IconUpload } from "../icons";

const rp = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `Rp ${Math.round(n).toLocaleString("id-ID")}`;

const TARGET_LABEL: Record<string, string> = {
  salesInvoice: "Faktur penjualan (Accurate)",
  salesReceipt: "Penerimaan kas (Accurate)",
  purchaseInvoice: "Faktur pembelian (Accurate)",
  expense: "Beban / pengeluaran (Accurate)",
  bankTransfer: "Transfer bank (Accurate)",
};

/** modul yang disebut AI tapi belum bisa disimpan dari sini */
const UNSUPPORTED_LABEL: Record<string, string> = {
  salesOrder: "Pesanan penjualan",
  salesReturn: "Retur penjualan",
  purchasePayment: "Pembayaran pemasok",
  receiveItem: "Penerimaan barang",
  purchaseReturn: "Retur pembelian",
  otherDeposit: "Pendapatan lain",
  otherPayment: "Pengeluaran lain",
  itemAdjustment: "Penyesuaian barang",
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
  const [form, setForm] = useState({
    customerName: "",
    date: "",
    no: "",
    total: "",
    description: "",
    invoiceNo: "",
    bankNo: "",
    expenseAccountNo: "",
    fromBankNo: "",
    toBankNo: "",
  });
  const [items, setItems] = useState<Array<{ name: string; qty: string; price: string }>>([]);
  const [options, setOptions] = useState<EntryOptions | null>(null);
  const [optionsBusy, setOptionsBusy] = useState(false);
  const [target, setTarget] = useState<"" | EntryTarget>("");

  useEffect(() => {
    void getMe().then(setMe);
    void getConnections().then(setConns).catch(() => undefined);
  }, []);

  const needOptions = target === "salesReceipt" || target === "expense" || target === "bankTransfer";
  useEffect(() => {
    if (!needOptions) return;
    const timer = window.setTimeout(() => {
      setOptionsBusy(true);
      void getEntryOptions(form.customerName)
        .then((o) => {
          setOptions(o);
          setForm((f) => ({
            ...f,
            bankNo: f.bankNo || o.bankAccounts[0]?.no || "",
            expenseAccountNo: f.expenseAccountNo || o.expenseAccounts[0]?.no || "",
            fromBankNo: f.fromBankNo || o.bankAccounts[0]?.no || "",
            toBankNo: f.toBankNo || o.bankAccounts[1]?.no || o.bankAccounts[0]?.no || "",
          }));
        })
        .catch(() => null)
        .finally(() => setOptionsBusy(false));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [needOptions, target, form.customerName]);

  if (me === undefined) {
    return (
      <div className="app">
        <main className="page page--narrow">
          <PageLoader />
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
  const perms = me.permissions ?? [];
  const TARGET_PERM: Record<EntryTarget, string> = {
    salesInvoice: "accurate:sales-invoice.save",
    salesReceipt: "accurate:sales-receipt.save",
    purchaseInvoice: "accurate:purchase-invoice.save",
    expense: "accurate:expense.save",
    bankTransfer: "accurate:bank-transfer.save",
  };
  const hasPerm = (t: EntryTarget) => perms.includes(TARGET_PERM[t]);
  const needsName = (t: EntryTarget) => t === "salesInvoice" || t === "salesReceipt" || t === "purchaseInvoice";

  // Admin Platform tidak memakai halaman Scan — arahkan ke kelola User & Peran
  if (me.permissions?.includes("app:settings.manage")) {
    window.location.replace("/admin");
    return null;
  }
  const onScanFile = async (file: File | undefined) => {
    if (!file) return;
    setErr(""); setOkMsg(""); setScan(null);
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
        invoiceNo: "",
        bankNo: "",
        expenseAccountNo: "",
        fromBankNo: "",
        toBankNo: "",
      });
      setItems(
        res.fields.items.map((i) => ({
          name: i.name,
          qty: i.qty !== undefined && i.qty !== null ? String(i.qty) : "1",
          price: i.price !== undefined && i.price !== null ? String(i.price) : "",
        }))
      );
      setOptions(null);
      setTarget(res.suggestedTarget ?? "");
      const warn = friendlyWarning(res.warning);
      if (warn) setErr(warn);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveEntry = async () => {
    if (!target) return setErr("Pilih tujuan penyimpanan.");
    if (!hasPerm(target)) return setErr(`Anda tidak punya hak menyimpan ke ${TARGET_LABEL[target]}.`);
    if (needsName(target) && !form.customerName.trim()) {
      return setErr(target === "purchaseInvoice" ? "Nama pemasok/vendor wajib diisi." : "Nama pelanggan wajib diisi.");
    }
    const cleanItems = items
      .filter((i) => i.name.trim())
      .map((i) => ({
        name: i.name.trim(),
        qty: Math.max(1, Number(i.qty) || 1),
        price: Number(i.price.replace(/[^\d.]/g, "")) || 0,
      }));
    if ((target === "salesInvoice" || target === "purchaseInvoice") && cleanItems.length === 0) {
      return setErr("Faktur butuh minimal satu rincian item — tambahkan item manual.");
    }
    if ((target === "salesInvoice" || target === "purchaseInvoice") && cleanItems.some((i) => i.price <= 0)) {
      return setErr("Harga setiap item wajib diisi (lebih dari 0).");
    }
    const totalNum = Number(form.total.replace(/[^\d.]/g, "")) || 0;
    if (target === "salesReceipt" && !form.invoiceNo.trim()) {
      return setErr("Pilih/isi nomor faktur yang dibayar.");
    }
    if (target === "salesReceipt" && !form.bankNo) return setErr("Pilih rekening penerimaan.");
    if (target === "expense" && !form.expenseAccountNo) return setErr("Pilih akun beban.");
    if (target === "expense" && totalNum <= 0) return setErr("Nominal beban wajib lebih dari 0.");
    if (target === "bankTransfer") {
      if (!form.fromBankNo || !form.toBankNo) return setErr("Pilih rekening sumber dan tujuan.");
      if (form.fromBankNo === form.toBankNo) return setErr("Rekening sumber dan tujuan tidak boleh sama.");
      if (totalNum <= 0) return setErr("Nominal transfer wajib lebih dari 0.");
    }
    if (target === "salesReceipt" && totalNum <= 0) return setErr("Jumlah diterima wajib lebih dari 0.");
    const itemTotal = cleanItems.reduce((a, i) => a + i.qty * i.price, 0);
    setErr(""); setBusy(true);
    try {
      const res = await postEntry({
        target,
        customerName: form.customerName.trim(),
        ...(form.date ? { date: form.date } : {}),
        ...(form.no ? { no: form.no } : {}),
        ...(form.description ? { description: form.description } : {}),
        ...(target === "salesInvoice" || target === "purchaseInvoice"
          ? { total: itemTotal, items: cleanItems }
          : { total: totalNum }),
        ...(target === "salesReceipt"
          ? { invoiceNo: form.invoiceNo.trim(), bankNo: form.bankNo }
          : {}),
        ...(target === "expense" ? { expenseAccountNo: form.expenseAccountNo } : {}),
        ...(target === "bankTransfer" ? { fromBankNo: form.fromBankNo, toBankNo: form.toBankNo } : {}),
      });
      setOkMsg(`Tersimpan ke ${TARGET_LABEL[target]} — no. referensi ${res.id}`);
      setScan(null);
      setItems([]);
      setOptions(null);
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

        {err && <p className="banner banner--err" role="alert">{err}</p>}
        {okMsg && <p className="banner banner--ok" role="status">{okMsg}</p>}

        <section className="card">
            {!camOn ? (
              <>
                <div className="scan-tiles">
                  <button type="button" className="scan-tile scan-tile--primary" onClick={() => void startCam()}>
                    <span className="scan-tile__icon" aria-hidden="true">
                      <IconCamera size={20} />
                    </span>
                    <span className="scan-tile__title">Buka Kamera</span>
                    <span className="scan-tile__desc">
                      Arahkan ke dokumen, hasil langsung dibaca AI tanpa pindah aplikasi.
                    </span>
                  </button>
                  <label className="scan-tile">
                    <span className="scan-tile__icon" aria-hidden="true">
                      <IconUpload size={20} />
                    </span>
                    <span className="scan-tile__title">Unggah foto / file</span>
                    <span className="scan-tile__desc">
                      Dari galeri atau penyimpanan — JPG, PNG, PDF, DOCX.
                    </span>
                    <input
                      className="sr-only"
                      type="file"
                      accept="image/*,.pdf,.docx,.pptx,.doc,.ppt,.md,.txt"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void onScanFile(f);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
                <label className="btn btn--ghost btn--sm" style={{ marginTop: "var(--space-xs)", cursor: "pointer" }}>
                  Ambil foto cepat dari kamera perangkat
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onScanFile(f);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              </>
            ) : (
              <div>
                <div className="scan-view">
                  <video ref={videoRef} playsInline muted />
                </div>
                <div className="btn-row" style={{ marginTop: "var(--space-xs)" }}>
                  <button className="btn" onClick={shootCam} disabled={busy}>
                    <IconCamera size={16} /> Ambil Foto &amp; Baca dengan AI
                  </button>
                  <button className="btn btn--2" onClick={stopCam}>Tutup kamera</button>
                </div>
              </div>
            )}
            {camErr && (
              <p className="banner banner--err" role="alert" style={{ marginTop: "var(--space-xs)", marginBottom: 0 }}>
                {camErr}
              </p>
            )}

            {busy && (
              <p className="busy-line" role="status">
                <span className="busy-dot" aria-hidden="true" /> AI sedang membaca dokumen…
              </p>
            )}

            {scan && (
              <p className="banner banner--ok banner--icon" role="status" style={{ marginTop: "var(--space-xs)" }}>
                <IconCheck size={16} />
                <span>
                  AI menyimpulkan: <b>{DOC_LABEL[scan.fields.docType] ?? scan.fields.docType}</b>
                {scan.suggestedTarget ? <> — disarankan disimpan sebagai <b>{TARGET_LABEL[scan.suggestedTarget]}</b></> : null}.
                {scan.aiReason ? <> <span style={{ opacity: 0.85 }}>“{scan.aiReason}”</span></> : null}
                {!scan.suggestedTarget && scan.aiModule && scan.aiModule !== "none"
                  ? <> Modul saran AI (<b>{UNSUPPORTED_LABEL[scan.aiModule] ?? scan.aiModule}</b>) belum didukung penyimpanan otomatis — pilih modul lain yang sesuai.</>
                  : null}
                {!scan.suggestedTarget && scan.aiModule === "none"
                  ? <> AI menilai dokumen ini cukup sebagai arsip — tidak perlu dicatat.</>
                  : null}
                {" "}Periksa & lengkapi kolom di bawah.
                </span>
              </p>
            )}

            {scan && (
              <div style={{ marginTop: "var(--space-s)" }}>
                <strong className="scan-block-title">Periksa hasil &amp; lengkapi</strong>
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
                      <option value="salesInvoice" disabled={!hasPerm("salesInvoice")}>Faktur penjualan{hasPerm("salesInvoice") ? "" : " — tanpa hak"}</option>
                      <option value="salesReceipt" disabled={!hasPerm("salesReceipt")}>Penerimaan kas{hasPerm("salesReceipt") ? "" : " — tanpa hak"}</option>
                      <option value="purchaseInvoice" disabled={!hasPerm("purchaseInvoice")}>Faktur pembelian{hasPerm("purchaseInvoice") ? "" : " — tanpa hak"}</option>
                      <option value="expense" disabled={!hasPerm("expense")}>Beban / pengeluaran{hasPerm("expense") ? "" : " — tanpa hak"}</option>
                      <option value="bankTransfer" disabled={!hasPerm("bankTransfer")}>Transfer bank{hasPerm("bankTransfer") ? "" : " — tanpa hak"}</option>
                    </select>
                  </label>
                  {target !== "expense" && target !== "bankTransfer" ? (
                    <label className="field">
                      {target === "purchaseInvoice" ? "Nama pemasok / vendor" : "Nama pelanggan"}
                      <input
                        className="input"
                        value={form.customerName}
                        onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                        placeholder={target === "purchaseInvoice" ? "cth. PT Sumber Elektronik" : "cth. Budi Santoso"}
                      />
                    </label>
                  ) : null}
                  {target === "salesReceipt" && (
                    <>
                      <label className="field">
                        Rekening penerimaan
                        <select
                          className="select"
                          value={form.bankNo}
                          onChange={(e) => setForm({ ...form, bankNo: e.target.value })}
                        >
                          <option value="">— pilih rekening —</option>
                          {(options?.bankAccounts ?? []).map((a) => (
                            <option key={a.no} value={a.no}>
                              {a.no} · {a.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Faktur yang dibayar
                        {(options?.invoices?.length ?? 0) > 0 ? (
                          <select
                            className="select"
                            value={form.invoiceNo}
                            onChange={(e) => {
                              const inv = options?.invoices.find((x) => x.number === e.target.value);
                              setForm({
                                ...form,
                                invoiceNo: e.target.value,
                                total: inv ? String(inv.totalAmount) : form.total,
                              });
                            }}
                          >
                            <option value="">— pilih faktur —</option>
                            {options!.invoices.map((inv) => (
                              <option key={inv.number} value={inv.number}>
                                {inv.number} · {rp(inv.totalAmount)} · {inv.transDate}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="input"
                            value={form.invoiceNo}
                            onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })}
                            placeholder="Nomor faktur penjualan"
                          />
                        )}
                      </label>
                    </>
                  )}
                  {target === "expense" && (
                    <label className="field">
                      Akun beban
                      <select
                        className="select"
                        value={form.expenseAccountNo}
                        onChange={(e) => setForm({ ...form, expenseAccountNo: e.target.value })}
                      >
                        <option value="">— pilih akun —</option>
                        {(options?.expenseAccounts ?? []).map((a) => (
                          <option key={a.no} value={a.no}>
                            {a.no} · {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {target === "bankTransfer" && (
                    <>
                      <label className="field">
                        Dari rekening
                        <select
                          className="select"
                          value={form.fromBankNo}
                          onChange={(e) => setForm({ ...form, fromBankNo: e.target.value })}
                        >
                          <option value="">— pilih rekening —</option>
                          {(options?.bankAccounts ?? []).map((a) => (
                            <option key={a.no} value={a.no}>
                              {a.no} · {a.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Ke rekening
                        <select
                          className="select"
                          value={form.toBankNo}
                          onChange={(e) => setForm({ ...form, toBankNo: e.target.value })}
                        >
                          <option value="">— pilih rekening —</option>
                          {(options?.bankAccounts ?? []).map((a) => (
                            <option key={a.no} value={a.no} disabled={a.no === form.fromBankNo}>
                              {a.no} · {a.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  {optionsBusy && (
                    <p className="meta" style={{ margin: 0 }}>
                      <span className="spinner" aria-hidden="true" /> Memuat rekening/faktur…
                    </p>
                  )}
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
                  {target !== "salesInvoice" && target !== "purchaseInvoice" && (
                    <label className="field">
                      {target === "salesReceipt" ? "Jumlah diterima (Rp)" : "Total (Rp)"}
                      <input
                        className="input num"
                        inputMode="numeric"
                        value={form.total}
                        onChange={(e) => setForm({ ...form, total: e.target.value })}
                        placeholder="150000"
                      />
                    </label>
                  )}
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

                {(target === "salesInvoice" || target === "purchaseInvoice") && (
                  <div className="capture__items" style={{ marginTop: "var(--space-s)" }}>
                    <strong>Rincian item</strong>
                    {items.map((it, i) => (
                      <div className="capture__item" key={i}>
                        <input
                          className="input"
                          aria-label={`Nama item ${i + 1}`}
                          value={it.name}
                          onChange={(e) => {
                            const next = [...items];
                            next[i] = { ...it, name: e.target.value };
                            setItems(next);
                          }}
                          placeholder="Nama barang/jasa"
                        />
                        <input
                          className="input capture__qty"
                          aria-label={`Qty item ${i + 1}`}
                          value={it.qty}
                          onChange={(e) => {
                            const next = [...items];
                            next[i] = { ...it, qty: e.target.value };
                            setItems(next);
                          }}
                        />
                        <input
                          className="input capture__price"
                          aria-label={`Harga item ${i + 1}`}
                          value={it.price}
                          onChange={(e) => {
                            const next = [...items];
                            next[i] = { ...it, price: e.target.value };
                            setItems(next);
                          }}
                          placeholder="Harga"
                        />
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          aria-label={`Hapus item ${i + 1}`}
                          onClick={() => setItems(items.filter((_, j) => j !== i))}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setItems([...items, { name: "", qty: "1", price: "" }])}
                    >
                      + Item
                    </button>
                    <p className="meta" style={{ margin: 0 }}>
                      Total dari item:{" "}
                      {rp(
                        items.reduce(
                          (a, it) =>
                            a +
                            (Number(it.qty) || 0) * (Number(it.price.replace(/[^\d.]/g, "")) || 0),
                          0
                        )
                      )}{" "}
                      — total dihitung Accurate dari rincian item.
                    </p>
                  </div>
                )}

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

        <a className="btn btn--ghost btn--sm" href="/app">
          ← Kembali
        </a>
      </main>
    </div>
  );
}
