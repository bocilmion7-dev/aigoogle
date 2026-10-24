import { useEffect, useRef, useState } from "react";
import {
  getDocTypes,
  postEntry,
  putDocTypes,
  uploadDocToDrive,
  uploadScan,
  type DocTypeRow,
  type EntryTarget,
  type ScanResponse,
} from "./api";

/**
 * Ambil foto dokumen dari chat:
 * pilih jenis → kamera (menggantikan area chat) → OCR/vision → review & edit →
 * simpan foto asli ke Drive (folder per jenis) dan/atau input ke Accurate.
 */

type Step = "type" | "direction" | "camera" | "processing" | "review";

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
  salesInvoice: "accurate:sales-invoice.view",
  salesReceipt: "accurate:sales-receipt.view",
  purchaseInvoice: "accurate:purchase-invoice.view",
  expense: "accurate:expense.view",
  bankTransfer: "accurate:bank-transfer.view",
};
const NEEDS_NAME = new Set<EntryTarget>(["salesInvoice", "salesReceipt", "purchaseInvoice"]);

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
  const [form, setForm] = useState<FormState>({ party: "", date: "", no: "", total: "", description: "", items: [] });
  const [target, setTarget] = useState<EntryTarget | "">("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const types = [...DEFAULT_TYPES, ...custom];

  useEffect(() => {
    void getDocTypes()
      .then((r) => setCustom(r.types))
      .catch(() => null);
  }, []);

  useEffect(() => () => stopCam(), []);

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
      setCamErr("Kamera tidak bisa diakses — gunakan tombol pilih file di bawah.");
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
      const res = await uploadScan(f, hint);
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
      if (res.warning) setErr("Sebagian field tidak terbaca otomatis — lengkapi manual bila perlu.");
      setStep("review");
    } catch (e) {
      setErr((e as Error).message);
      setStep("camera");
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

  async function savePhoto() {
    if (!file || !chosen) return;
    setBusy(true);
    setErr("");
    try {
      const res = await uploadDocToDrive(file, {
        fileName: file.name,
        docType: chosen.key,
        label: chosen.label,
        party: form.party,
        date: form.date,
      });
      setMsg(`Foto tersimpan di Drive folder ${res.folder}: ${res.name}${res.link ? ` — ${res.link}` : ""}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEntry() {
    if (!target) return setErr("Pilih tujuan penyimpanan.");
    if (!perms.includes(TARGET_PERM[target])) return setErr(`Anda tidak punya hak menyimpan ke ${TARGET_LABEL[target]}.`);
    if (NEEDS_NAME.has(target) && !form.party.trim()) return setErr("Nama pelanggan/pemasok wajib diisi.");
    const items = form.items.filter((i) => i.name.trim());
    if (target === "purchaseInvoice" && items.length === 0) return setErr("Faktur pembelian butuh minimal satu item.");
    setBusy(true);
    setErr("");
    try {
      const total = form.total.replace(/[^\d.]/g, "");
      const res = await postEntry({
        target,
        customerName: form.party.trim(),
        ...(form.date ? { date: form.date } : {}),
        ...(form.no ? { no: form.no } : {}),
        ...(total ? { total: Number(total) } : {}),
        ...(form.description ? { description: form.description } : {}),
        ...(target === "purchaseInvoice" && items.length
          ? {
              items: items.map((i) => ({
                name: i.name.trim(),
                ...(i.qty ? { qty: Number(i.qty) } : {}),
                ...(i.price ? { price: Number(i.price.replace(/[^\d.]/g, "")) } : {}),
              })),
            }
          : {}),
      });
      setMsg(`Tersimpan ke ${TARGET_LABEL[target]} — no. referensi ${res.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
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
        {step === "camera" && "Ambil foto dokumen"}
        {step === "processing" && "Memproses dokumen…"}
        {step === "review" && "Periksa & lengkapi"}
      </strong>
      <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Tutup kamera">
        Tutup
      </button>
    </div>
  );

  return (
    <div className="capture" role="region" aria-label="Ambil foto dokumen">
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

      {step === "type" && (
        <>
          <div className="capture__types" role="group" aria-label="Jenis dokumen">
            {types.map((t) => (
              <button
                key={t.key}
                className="btn btn--2 capture__type"
                onClick={() => {
                  setChosen(t);
                  setDirection("");
                  if (t.key === "screenshot-pembayaran") setStep("direction");
                  else void startCam();
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
                void startCam();
              }}
            >
              <span>{d.label}</span>
              {d.note && <small style={{ display: "block", color: "var(--ink-2)", fontWeight: 400 }}>{d.note}</small>}
            </button>
          ))}
        </div>
      )}

      {step === "camera" && (
        <>
          {camErr ? (
            <p className="banner banner--err" role="alert">
              {camErr}
            </p>
          ) : (
            <video ref={videoRef} className="capture__video" playsInline muted aria-label="Pratinjau kamera" />
          )}
          <div className="capture__actions">
            {!camErr && (
              <button className="btn" onClick={shoot}>
                Jepret
              </button>
            )}
            <button className="btn btn--2" onClick={() => fileRef.current?.click()}>
              Pilih file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  stopCam();
                  void process(f);
                }
              }}
            />
            <button className="btn btn--ghost" onClick={() => setStep("type")}>
              Kembali
            </button>
          </div>
        </>
      )}

      {step === "processing" && (
        <p className="capture__status" role="status">
          <span className="thinking__dot" aria-hidden="true" />
          <span className="thinking__dot" aria-hidden="true" />
          <span className="thinking__dot" aria-hidden="true" />
          Membaca dokumen (OCR → vision bila perlu)…
        </p>
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
            <label>
              <span>Total</span>
              <input className="input" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} />
            </label>
            <label className="capture__wide">
              <span>Keterangan</span>
              <input
                className="input"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
          </div>

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
          </div>

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

          {scan.rawText && (
            <details className="capture__raw">
              <summary>Teks terbaca</summary>
              <pre>{scan.rawText.slice(0, 2000)}</pre>
            </details>
          )}

          <div className="capture__actions">
            <button className="btn btn--2" onClick={() => void savePhoto()} disabled={busy}>
              Simpan foto ke Drive
            </button>
            <button className="btn" onClick={() => void saveEntry()} disabled={busy || !target}>
              Input ke sistem
            </button>
            <button className="btn btn--ghost" onClick={finish} disabled={busy}>
              Selesai
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
