import { useEffect, useRef, useState } from "react";
import { notifyAiGate } from "./api";
import {
  getDocTypes,
  getEntryOptions,
  postEntry,
  putDocTypes,
  uploadDocToDrive,
  uploadScan,
  type DocTypeRow,
  type EntryOptions,
  type EntryTarget,
  type ScanResponse,
} from "./api";
import { IconArrowLeft, IconCamera, IconFile, IconFileImage } from "./icons";

/**
 * Lampiran dokumen dari chat:
 * pilih jenis → pilih sumber (browse file / foto galeri / kamera) → OCR/vision →
 * review & edit → simpan asli ke Drive (folder per jenis) dan/atau input ke Accurate.
 */

type Step = "type" | "direction" | "source" | "camera" | "processing" | "review";

const DEFAULT_TYPES: DocTypeRow[] = [
  { key: "faktur", label: "Faktur", target: "salesInvoice" },
  { key: "nota", label: "Nota", target: "salesReceipt" },
  { key: "kwitansi", label: "Kwitansi", target: "salesReceipt" },
  { key: "screenshot-pembayaran", label: "Screenshot pembayaran", target: "" },
  { key: "biaya", label: "Biaya / struk", target: "expense" },
  { key: "transfer", label: "Transfer antar rekening", target: "bankTransfer" },
];

const TARGET_LABEL: Record<EntryTarget, string> = {
  salesInvoice: "Faktur penjualan",
  salesReceipt: "Penerimaan kas",
  purchaseInvoice: "Faktur pembelian",
  expense: "Biaya",
  bankTransfer: "Transfer bank",
};
const TARGET_PERM: Record<EntryTarget, string> = {
  salesInvoice: "accurate:sales-invoice.save",
  salesReceipt: "accurate:sales-receipt.save",
  purchaseInvoice: "accurate:purchase-invoice.save",
  expense: "accurate:expense.save",
  bankTransfer: "accurate:bank-transfer.save",
};
const NEEDS_NAME = new Set<EntryTarget>(["salesInvoice", "salesReceipt", "purchaseInvoice"]);

/** durasi minimum tampilan animasi scan agar semua metode (file/foto/kamera) terlihat */
const MIN_SCAN_MS = 900;

const DIRECTION: Array<{ key: string; label: string; target: EntryTarget | ""; note?: string }> = [
  { key: "masuk", label: "Uang masuk (dari pelanggan)", target: "salesReceipt" },
  { key: "keluar", label: "Uang keluar (ke pemasok)", target: "", note: "Modul pembayaran pemasok belum didukung — simpan arsip ke Drive." },
  { key: "antar", label: "Antar rekening sendiri", target: "bankTransfer" },
];

interface Props {
  perms: string[];
  onClose: () => void;
  /** dipanggil setelah ada hasil (agar chat menampilkan ringkasan) */
  onDone: (message: string) => void;
}

interface FormState {
  party: string;
  date: string;
  no: string;
  total: string;
  description: string;
  items: Array<{ name: string; qty: string; price: string }>;
}

export function DocCapture({ perms, onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>("type");
  const [custom, setCustom] = useState<DocTypeRow[]>([]);
  const [chosen, setChosen] = useState<DocTypeRow | null>(null);
  const [direction, setDirection] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [camErr, setCamErr] = useState("");
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ party: "", date: "", no: "", total: "", description: "", items: [] });
  const [target, setTarget] = useState<EntryTarget | "">("");
  const [options, setOptions] = useState<EntryOptions | null>(null);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [bankNo, setBankNo] = useState("");
  const [expenseAccountNo, setExpenseAccountNo] = useState("");
  const [fromBankNo, setFromBankNo] = useState("");
  const [toBankNo, setToBankNo] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [saveFile, setSaveFile] = useState(true);
  const progressTimer = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  const types = [...DEFAULT_TYPES, ...custom];

  useEffect(() => {
    void getDocTypes()
      .then((r) => setCustom(r.types))
      .catch(() => null);
  }, []);

  useEffect(() => () => stopCam(), []);

  // pratinjau foto asli selama proses scan (URL objek dibersihkan otomatis)
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(
    () => () => {
      if (progressTimer.current) window.clearInterval(progressTimer.current);
    },
    []
  );

  const needOptions = target === "salesReceipt" || target === "expense" || target === "bankTransfer";
  useEffect(() => {
    if (!needOptions) return;
    const timer = window.setTimeout(() => {
      void getEntryOptions(form.party)
        .then((o) => {
          setOptions(o);
          setBankNo((v) => v || o.bankAccounts[0]?.no || "");
          setExpenseAccountNo((v) => v || o.expenseAccounts[0]?.no || "");
          setFromBankNo((v) => v || o.bankAccounts[0]?.no || "");
          setToBankNo((v) => v || o.bankAccounts[1]?.no || "");
        })
        .catch(() => null);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [needOptions, target, form.party]);

  function stopCam() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function startCam() {
    setCamErr("");
    setStep("camera");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      streamRef.current = stream;
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setCamErr("Kamera tidak bisa diakses — pilih Browse file atau Foto.");
    }
  }

  function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, 1600 / v.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        stopCam();
        if (!blob) return;
        void process(new File([blob], `kamera-${Date.now()}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.85
    );
  }

  async function process(f: File) {
    setFile(f);
    setStep("processing");
    setErr("");
    try {
      const hint =
        chosen && chosen.key === "screenshot-pembayaran"
          ? { docType: chosen.key, direction, label: chosen.label }
          : chosen
            ? { docType: chosen.key, label: chosen.label }
            : undefined;
      const started = Date.now();
      const res = await uploadScan(f, hint);
      const wait = MIN_SCAN_MS - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (res.isDocument === false) {
        setNotice("Foto tidak terdeteksi sebagai dokumen. Silakan kirim foto dokumen yang jelas.");
        return;
      }
      if (res.warning) {
        setNotice(
          "Dokumen tidak lolos verifikasi scan — sebagian field tidak terbaca otomatis. Silakan foto ulang dengan hasil yang lebih jelas."
        );
        return;
      }
      setScan(res);
      setForm({
        party: res.fields.customerName || "",
        date: res.fields.date || "",
        no: res.fields.no || "",
        total: res.fields.total !== null ? String(res.fields.total) : "",
        description: res.fields.description || "",
        items: res.fields.items.map((i) => ({
          name: i.name,
          qty: i.qty !== undefined && i.qty !== null ? String(i.qty) : "",
          price: i.price !== undefined && i.price !== null ? String(i.price) : "",
        })),
      });
      const suggested =
        res.suggestedTarget ??
        (chosen?.key === "screenshot-pembayaran"
          ? (DIRECTION.find((d) => d.key === direction)?.target || "")
          : (chosen?.target as EntryTarget | undefined) || "");
      setTarget((suggested as EntryTarget) || "");
      setStep("review");
    } catch (e) {
      const message = (e as Error).message;
      if (message === "langganan_ai_habis") {
        notifyAiGate("subscription");
        return;
      }
      if (message === "saldo_ai_habis" || message === "token_ai_habis") {
        notifyAiGate("token");
        return;
      }
      setErr(message);
      setStep("source");
    }
  }

  async function addType() {
    const label = newLabel.trim();
    if (!label) return;
    const key = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    if (!key || types.some((t) => t.key === key)) {
      setErr("Jenis itu sudah ada.");
      return;
    }
    const next = [...custom, { key, label, target: "" }];
    setBusy(true);
    try {
      const r = await putDocTypes(next);
      setCustom(r.types);
      setAdding(false);
      setNewLabel("");
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function stopProgress() {
    if (progressTimer.current) {
      window.clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  }

  function validateEntry(): Array<{ name: string; qty: string; price: string }> {
    if (!target) throw new Error("Pilih tujuan penyimpanan.");
    if (!perms.includes(TARGET_PERM[target])) {
      throw new Error(`Anda tidak punya hak menyimpan ke ${TARGET_LABEL[target]}.`);
    }
    if (NEEDS_NAME.has(target) && !form.party.trim()) throw new Error("Nama pelanggan/pemasok wajib diisi.");
    const items = form.items.filter((i) => i.name.trim());
    if ((target === "salesInvoice" || target === "purchaseInvoice") && items.length === 0) {
      throw new Error("Faktur butuh minimal satu rincian item.");
    }
    if ((target === "salesInvoice" || target === "purchaseInvoice") && items.some((i) => !(Number(String(i.price).replace(/[^\d.]/g, "")) > 0))) {
      throw new Error("Harga setiap item wajib diisi (lebih dari 0).");
    }
    if (target === "salesReceipt") {
      if (!invoiceNo.trim()) throw new Error("Nomor faktur yang dibayar wajib diisi.");
      if (!bankNo) throw new Error("Rekening penerimaan wajib dipilih.");
    }
    if (target === "bankTransfer") {
      if (!fromBankNo || !toBankNo) throw new Error("Rekening sumber dan tujuan wajib dipilih.");
      if (fromBankNo === toBankNo) throw new Error("Rekening sumber dan tujuan tidak boleh sama.");
    }
    return items;
  }

  async function doSavePhoto(): Promise<string> {
    if (!file || !chosen) throw new Error("File foto tidak tersedia.");
    const res = await uploadDocToDrive(file, {
      fileName: file.name,
      docType: chosen.key,
      label: chosen.label,
      party: form.party,
      date: form.date,
    });
    return `Foto tersimpan di Drive folder ${res.folder}: ${res.name}${res.link ? ` — ${res.link}` : ""}`;
  }

  async function doSaveEntry(items: Array<{ name: string; qty: string; price: string }>): Promise<string> {
    if (!target) throw new Error("Pilih tujuan penyimpanan.");
    const total = form.total.replace(/[^\d.]/g, "");
    const itemPayload = items.map((i) => ({
      name: i.name.trim(),
      ...(i.qty ? { qty: Number(i.qty) } : {}),
      ...(i.price ? { price: Number(i.price.replace(/[^\d.]/g, "")) } : {}),
    }));
    const itemTotal = itemPayload.reduce((a, i) => a + (i.qty ?? 1) * (i.price ?? 0), 0);
    const res = await postEntry({
      target,
      customerName: form.party.trim(),
      ...(form.date ? { date: form.date } : {}),
      ...(form.no ? { no: form.no } : {}),
      ...(form.description ? { description: form.description } : {}),
      ...(target === "salesInvoice" || target === "purchaseInvoice"
        ? { total: itemTotal, items: itemPayload }
        : { ...(total ? { total: Number(total) } : {}) }),
      ...(target === "salesReceipt" ? { invoiceNo: invoiceNo.trim(), bankNo } : {}),
      ...(target === "expense" ? { expenseAccountNo } : {}),
      ...(target === "bankTransfer" ? { fromBankNo, toBankNo } : {}),
    });
    return `Tersimpan ke ${TARGET_LABEL[target]} — no. referensi ${res.id}`;
  }

  async function performSave() {
    const wantFile = saveFile;
    const wantEntry = !!target;
    if (!wantFile && !wantEntry) {
      setErr("Pilih simpan file foto atau tujuan Accurate.");
      return;
    }
    let items: Array<{ name: string; qty: string; price: string }> = [];
    try {
      if (wantEntry) items = validateEntry();
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    setErr("");
    setSaving(true);
    setProgress(4);
    progressTimer.current = window.setInterval(() => {
      setProgress((p) => (p < 55 ? Math.min(55, p + 7) : Math.min(90, p + 3)));
    }, 250);
    try {
      const parts: string[] = [];
      if (wantFile) {
        parts.push(await doSavePhoto());
        setProgress((p) => Math.max(p, 55));
      }
      if (wantEntry) parts.push(await doSaveEntry(items));
      stopProgress();
      setProgress(100);
      await new Promise((r) => setTimeout(r, 350));
      onDone(parts.join(" ") || "Selesai.");
      setSaveOpen(false);
      setSaving(false);
      onClose();
    } catch (e) {
      stopProgress();
      setSaving(false);
      setSaveOpen(false);
      setProgress(0);
      setErr((e as Error).message);
    }
  }

  function finish() {
    const parts: string[] = [];
    if (scan) {
      parts.push(
        `Dokumen ${chosen?.label ?? scan.fields.docType} terbaca${form.party ? ` — ${form.party}` : ""}${
          form.total ? `, total Rp${Number(form.total.replace(/[^\d.]/g, "")).toLocaleString("id-ID")}` : ""
        }.`
      );
    }
    if (msg) parts.push(msg);
    onDone(parts.join(" ") || "Selesai.");
    onClose();
  }

  const header = (
    <div className="capture__head">
      <strong>
        {step === "type" && "Pilih jenis dokumen"}
        {step === "direction" && "Arah dana"}
        {step === "source" && "Pilih sumber dokumen"}
        {step === "camera" && "Ambil foto dokumen"}
        {step === "processing" && "Memproses dokumen…"}
        {step === "review" && "Periksa & lengkapi"}
      </strong>
      <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Tutup lampiran">
        Tutup
      </button>
    </div>
  );

  return (
    <div className="capture" role="region" aria-label="Lampiran dokumen">
      {header}
      {err && (
        <p className="banner banner--err" role="alert">
          {err}
        </p>
      )}
      {msg && (
        <p className="banner banner--ok" role="status">
          {msg}
        </p>
      )}

      {/* input file selalu terpasang agar ref siap dari menu sumber mana pun */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf,.doc,.docx,.ppt,.pptx,.txt,.md"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            stopCam();
            void process(f);
          }
          e.target.value = "";
        }}
      />
      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            stopCam();
            void process(f);
          }
          e.target.value = "";
        }}
      />

      {step === "type" && (
        <>
          <div className="capture__types" role="group" aria-label="Jenis dokumen">
            {types.map((t) => (
              <button
                key={t.key}
                className="btn btn--2 capture__type capture__type--doc"
                onClick={() => {
                  setChosen(t);
                  setDirection("");
                  if (t.key === "screenshot-pembayaran") setStep("direction");
                  else setStep("source");
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          {adding ? (
            <div className="capture__add">
              <input
                className="input"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Nama jenis baru (mis. Surat Jalan)"
                aria-label="Nama jenis dokumen baru"
              />
              <button className="btn" onClick={() => void addType()} disabled={busy}>
                Simpan jenis
              </button>
              <button className="btn btn--ghost" onClick={() => setAdding(false)}>
                Batal
              </button>
            </div>
          ) : (
            <button className="btn btn--ghost" onClick={() => setAdding(true)}>
              + Tambah jenis baru
            </button>
          )}
        </>
      )}

      {step === "direction" && (
        <div className="capture__types" role="group" aria-label="Arah dana">
          {DIRECTION.map((d) => (
            <button
              key={d.key}
              className="btn btn--2 capture__type"
              onClick={() => {
                setDirection(d.key);
                setStep("source");
              }}
            >
              <span>{d.label}</span>
              {d.note && <small style={{ display: "block", color: "var(--ink-2)", fontWeight: 400 }}>{d.note}</small>}
            </button>
          ))}
        </div>
      )}

      {step === "source" && (
        <>
          <div className="capture__types" role="group" aria-label="Sumber dokumen">
            <button className="btn btn--2 capture__type" style={{ flexDirection: "column", alignItems: "stretch", gap: 2 }} aria-label="Browse file" onClick={() => fileRef.current?.click()}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <IconFile size={18} /> Browse file
              </span>
              <small style={{ display: "block", color: "var(--ink-2)", fontWeight: 400 }}>
                PDF, dokumen, atau gambar dari penyimpanan
              </small>
            </button>
            <button className="btn btn--2 capture__type" style={{ flexDirection: "column", alignItems: "stretch", gap: 2 }} aria-label="Foto" onClick={() => photoRef.current?.click()}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <IconFileImage size={18} /> Foto
              </span>
              <small style={{ display: "block", color: "var(--ink-2)", fontWeight: 400 }}>
                Pilih foto yang sudah ada di galeri
              </small>
            </button>
            <button className="btn btn--2 capture__type" style={{ flexDirection: "column", alignItems: "stretch", gap: 2 }} aria-label="Kamera" onClick={() => void startCam()}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <IconCamera size={18} /> Kamera
              </span>
              <small style={{ display: "block", color: "var(--ink-2)", fontWeight: 400 }}>
                Ambil foto dokumen langsung
              </small>
            </button>
          </div>
          <button className="btn btn--ghost" onClick={() => setStep("type")}>
            Kembali
          </button>
        </>
      )}

      {step === "camera" && (
        <div className="capture__cam">
          <div className="capture__camview">
            {camErr ? (
              <p className="banner banner--err" role="alert">
                {camErr}
              </p>
            ) : (
              <video ref={videoRef} className="capture__video" playsInline muted aria-label="Pratinjau kamera" />
            )}
            <button
              type="button"
              className="capture__back"
              onClick={() => setStep("source")}
              aria-label="Kembali ke pilihan sumber"
              title="Kembali"
            >
              <IconArrowLeft size={20} />
            </button>
          </div>
          <div className="capture__actions capture__actions--cam">
            {!camErr ? (
              <button type="button" className="capture__shutter" onClick={shoot} aria-label="Jepret dokumen">
                <IconCamera size={28} />
              </button>
            ) : (
              <>
                <button className="btn" onClick={() => fileRef.current?.click()}>
                  Browse file
                </button>
                <button className="btn btn--2" onClick={() => photoRef.current?.click()}>
                  Foto
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {step === "processing" && (
        <div className="capture__scan" role="status" aria-label="Membaca dokumen">
          <div className="capture__scan-frame">
            {preview ? (
              <img src={preview} className="capture__scan-img" alt="Dokumen sedang dipindai" />
            ) : (
              <div className="capture__scan-file">
                <IconFile size={48} />
              </div>
            )}
            <span className="capture__scanline" aria-hidden="true" />
          </div>
        </div>
      )}

      {step === "review" && scan && (
        <div className="capture__review">
          <p className="capture__meta">
            Terbaca sebagai <strong>{scan.fields.docType}</strong>
            {scan.aiConfidence !== undefined && scan.aiConfidence !== null
              ? ` · keyakinan ${Math.round(scan.aiConfidence * 100)}%`
              : ""}
            {scan.aiReason ? ` · ${scan.aiReason}` : ""}
          </p>
          <div className="capture__form">
            <label>
              <span>Nama pelanggan/pemasok</span>
              <input className="input" value={form.party} onChange={(e) => setForm({ ...form, party: e.target.value })} />
            </label>
            <label>
              <span>Tanggal</span>
              <input
                className="input"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </label>
            <label>
              <span>Nomor dokumen</span>
              <input className="input" value={form.no} onChange={(e) => setForm({ ...form, no: e.target.value })} />
            </label>
            {target !== "salesInvoice" && target !== "purchaseInvoice" && (
              <label>
                <span>{target === "salesReceipt" ? "Jumlah diterima" : "Total"}</span>
                <input className="input" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} />
              </label>
            )}
            <label className="capture__wide">
              <span>Keterangan</span>
              <input
                className="input"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
          </div>

          {(target === "salesInvoice" || target === "purchaseInvoice") && (
          <div className="capture__items">
            <strong>Item</strong>
            {form.items.map((it, i) => (
              <div className="capture__item" key={i}>
                <input
                  className="input"
                  aria-label={`Nama item ${i + 1}`}
                  value={it.name}
                  onChange={(e) => {
                    const items = [...form.items];
                    items[i] = { ...it, name: e.target.value };
                    setForm({ ...form, items });
                  }}
                />
                <input
                  className="input capture__qty"
                  aria-label={`Qty item ${i + 1}`}
                  value={it.qty}
                  onChange={(e) => {
                    const items = [...form.items];
                    items[i] = { ...it, qty: e.target.value };
                    setForm({ ...form, items });
                  }}
                />
                <input
                  className="input capture__price"
                  aria-label={`Harga item ${i + 1}`}
                  value={it.price}
                  onChange={(e) => {
                    const items = [...form.items];
                    items[i] = { ...it, price: e.target.value };
                    setForm({ ...form, items });
                  }}
                />
                <button
                  className="btn btn--ghost btn--sm"
                  aria-label={`Hapus item ${i + 1}`}
                  onClick={() => setForm({ ...form, items: form.items.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setForm({ ...form, items: [...form.items, { name: "", qty: "", price: "" }] })}
            >
              + Item
            </button>
            <p className="meta" style={{ margin: 0 }}>
              Total dari item: Rp
              {form.items
                .reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.price.replace(/[^\d.]/g, "")) || 0), 0)
                .toLocaleString("id-ID")}{" "}
              — total dihitung Accurate dari rincian item.
            </p>
          </div>
          )}

          <label className="capture__target">
            <span>Simpan ke Accurate</span>
            <select
              className="input"
              value={target}
              onChange={(e) => setTarget(e.target.value as EntryTarget | "")}
              aria-label="Tujuan penyimpanan Accurate"
            >
              <option value="">(tidak disimpan ke Accurate)</option>
              {(Object.keys(TARGET_LABEL) as EntryTarget[]).map((t) => (
                <option key={t} value={t} disabled={!perms.includes(TARGET_PERM[t])}>
                  {TARGET_LABEL[t]}
                  {perms.includes(TARGET_PERM[t]) ? "" : " (tanpa hak)"}
                </option>
              ))}
            </select>
          </label>

          {target === "salesReceipt" && (
            <div className="capture__form">
              <label>
                <span>Rekening penerimaan</span>
                <select className="input" value={bankNo} onChange={(e) => setBankNo(e.target.value)}>
                  <option value="">— pilih rekening —</option>
                  {(options?.bankAccounts ?? []).map((a) => (
                    <option key={a.no} value={a.no}>{a.no} · {a.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Faktur yang dibayar</span>
                {(options?.invoices?.length ?? 0) > 0 ? (
                  <select
                    className="input"
                    value={invoiceNo}
                    onChange={(e) => {
                      const inv = options?.invoices.find((x) => x.number === e.target.value);
                      setInvoiceNo(e.target.value);
                      if (inv) setForm({ ...form, total: String(inv.totalAmount) });
                    }}
                  >
                    <option value="">— pilih faktur —</option>
                    {options!.invoices.map((inv) => (
                      <option key={inv.number} value={inv.number}>{inv.number} · Rp{inv.totalAmount.toLocaleString("id-ID")}</option>
                    ))}
                  </select>
                ) : (
                  <input className="input" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Nomor faktur penjualan" />
                )}
              </label>
            </div>
          )}

          {target === "expense" && (
            <label className="capture__target">
              <span>Akun beban</span>
              <select className="input" value={expenseAccountNo} onChange={(e) => setExpenseAccountNo(e.target.value)}>
                <option value="">(otomatis dari keterangan)</option>
                {(options?.expenseAccounts ?? []).map((a) => (
                  <option key={a.no} value={a.no}>{a.no} · {a.name}</option>
                ))}
              </select>
            </label>
          )}

          {target === "bankTransfer" && (
            <div className="capture__form">
              <label>
                <span>Dari rekening</span>
                <select className="input" value={fromBankNo} onChange={(e) => setFromBankNo(e.target.value)}>
                  <option value="">— pilih —</option>
                  {(options?.bankAccounts ?? []).map((a) => <option key={a.no} value={a.no}>{a.no} · {a.name}</option>)}
                </select>
              </label>
              <label>
                <span>Ke rekening</span>
                <select className="input" value={toBankNo} onChange={(e) => setToBankNo(e.target.value)}>
                  <option value="">— pilih —</option>
                  {(options?.bankAccounts ?? []).map((a) => (
                    <option key={a.no} value={a.no} disabled={a.no === fromBankNo}>{a.no} · {a.name}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="capture__actions capture__actions--save">
            <button
              className="btn"
              style={{ flex: 1 }}
              onClick={() => {
                setErr("");
                setProgress(0);
                setSaveFile(true);
                setSaveOpen(true);
              }}
              disabled={busy || saving}
            >
              Simpan
            </button>
            <button className="btn btn--2" style={{ flex: 1 }} onClick={finish} disabled={busy || saving}>
              Selesai
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div className="modal-overlay">
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="scan-warn-title">
            <div className="modal__head">
              <strong className="card__title" id="scan-warn-title">
                Peringatan
              </strong>
            </div>
            <p style={{ margin: 0 }}>{notice}</p>
            <div className="modal__foot">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const text = notice;
                  setNotice(null);
                  onDone(text);
                  onClose();
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {saveOpen && (
        <div className="modal-overlay" onClick={saving ? undefined : () => setSaveOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-doc-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__head">
              <strong className="card__title" id="save-doc-title">
                {saving ? "Menyimpan…" : "Simpan dokumen"}
              </strong>
              {!saving && (
                <button type="button" className="modal__x" onClick={() => setSaveOpen(false)} aria-label="Tutup">
                  ×
                </button>
              )}
            </div>
            {saving ? (
              <>
                <p className="meta" style={{ margin: 0 }}>
                  {saveFile && progress < 55
                    ? "Menyimpan file foto ke Drive…"
                    : target
                      ? "Menyimpan data ke Accurate…"
                      : "Menyelesaikan…"}
                </p>
                <div className="modal__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                  <span style={{ width: `${progress}%` }} />
                </div>
                <p className="meta num" style={{ margin: 0, textAlign: "right" }}>
                  {progress}%
                </p>
              </>
            ) : (
              <>
                <label className="check">
                  <input type="checkbox" checked={saveFile} onChange={(e) => setSaveFile(e.target.checked)} />
                  <span>
                    Simpan file foto ke Drive
                    {file ? <span className="check__hint">{file.name}</span> : null}
                  </span>
                </label>
                <p className="meta" style={{ margin: 0 }}>
                  {target
                    ? `Data juga akan disimpan ke ${TARGET_LABEL[target]}.`
                    : "Data tidak disimpan ke Accurate (tujuan belum dipilih)."}
                </p>
                <div className="modal__foot">
                  <button type="button" className="btn btn--2" onClick={() => setSaveOpen(false)}>
                    Batal
                  </button>
                  <button type="button" className="btn" onClick={() => void performSave()}>
                    Simpan
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
