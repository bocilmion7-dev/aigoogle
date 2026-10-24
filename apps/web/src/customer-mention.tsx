import { useEffect, useRef, useState } from "react";
import type { CustomerName } from "./chat-api";
import { listCustomerNames } from "./chat-api";

const MAX_SHOWN = 8;
const LISTBOX_ID = "mention-listbox";

/** posisi "@" paling kanan sebelum karet — aktif hanya di awal/spasi sebelumnya */
function findMention(value: string, caret: number): { at: number; query: string } | null {
  if (caret <= 0) return null;
  const at = value.lastIndexOf("@", caret - 1);
  if (at < 0) return null;
  if (at > 0 && !/[\s(]/.test(value[at - 1]!)) return null;
  const query = value.slice(at + 1, caret);
  if (query.includes("@") || query.includes("\n")) return null;
  return { at, query };
}

/** bandingkan tanpa peduli spasi ganda & kapital (nama Accurate bisa "X  Y") */
function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function matchOf(all: CustomerName[], query: string): CustomerName[] {
  const q = norm(query);
  const matched = q
    ? all.filter((c) => norm(c.name).includes(q) || norm(c.customerNo ?? "").includes(q))
    : all;
  return matched.slice(0, MAX_SHOWN);
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  className?: string;
}

/**
 * Input chat dengan autocomplete nama pelanggan saat mengetik "@" —
 * user memilih dr daftar sehingga ejaan nama persis dgn data Accurate
 * (mengurangi salah ucap/salah ketik → tool cari nama gagal).
 * Pilihan menyisipkan NAMA POLOS (tanpa "@") persis seperti di daftar.
 */
export function MentionInput({ value, onChange, onSubmit, onFocus, onBlur, className }: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef(0);
  const fetchingRef = useRef(false);
  const pendingCaret = useRef<number | null>(null);
  const [names, setNames] = useState<CustomerName[] | null>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CustomerName[]>([]);
  const [active, setActive] = useState(0);
  const loading = open && names === null;

  // textarea: tinggi awal = tinggi tombol (CSS 40px / 44px mobile).
  // Placeholder TIDAK boleh menambah tinggi — tinggi hanya dihitung dari isi nyata.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "";
    if (!el.value) return; // kosong → pakai tinggi CSS (sama dgn tombol)
    const baseH = el.offsetHeight; // tinggi CSS saat kosong (40/44)
    el.style.height = "auto";
    const border = el.offsetHeight - el.clientHeight;
    const needed = el.scrollHeight + border;
    el.style.height = `${Math.min(Math.max(needed, baseH), 168)}px`;
  }, [value]);

  // karet mengikuti kursor (ketik/klik/panah) — basis deteksi token "@"
  function trackCaret(el: HTMLTextAreaElement) {
    caretRef.current = el.selectionStart ?? el.value.length;
  }

  function refresh(v: string, caret: number): boolean {
    const m = findMention(v, caret);
    if (!m) {
      setOpen(false);
      return false;
    }
    if (!fetchingRef.current) ensureNames();
    setOpen(true);
    setItems(names ? matchOf(names, m.query) : []);
    setActive(0);
    return true;
  }

  // daftar tiba SETELAH "@", masih terbuka → isi items sekali lagi
  useEffect(() => {
    if (!open || names === null) return;
    const m = findMention(value, caretRef.current);
    if (m) setItems(matchOf(names, m.query));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names]);

  /** muat daftar nama sekali (dipicu fokus input → "@" pertama langsung instan) */
  function ensureNames() {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    void listCustomerNames().then((rows) => setNames(rows));
  }

  // pasang karet setelah penyisipan nama (value sudah baru saat efek ini jalan)
  useEffect(() => {
    if (pendingCaret.current == null) return;
    const pos = pendingCaret.current;
    pendingCaret.current = null;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(pos, pos);
    caretRef.current = pos;
  }, [value]);

  // opsi aktif selalu terlihat dalam daftar
  useEffect(() => {
    if (!open) return;
    document.getElementById(`mention-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function pick(c: CustomerName) {
    const m = findMention(value, caretRef.current);
    if (!m) return;
    const before = value.slice(0, m.at);
    const after = value.slice(caretRef.current);
    // sisipkan spasi setelah nama supaya lanjut mengetik terasa alami
    const join = after && /^\s/.test(after) ? "" : " ";
    pendingCaret.current = (before + c.name + join).length;
    onChange(before + c.name + join + after);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (open) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown" && items.length > 0) {
        e.preventDefault();
        setActive((a) => (a + 1) % items.length);
        return;
      }
      if (e.key === "ArrowUp" && items.length > 0) {
        e.preventDefault();
        setActive((a) => (a - 1 + items.length) % items.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        // daftar terbuka → Enter/Tab memilih, bukan kirim pesan
        e.preventDefault();
        if (items.length > 0) pick(items[active]!);
        else setOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && value.trim()) {
      e.preventDefault();
      onSubmit(value);
      (e.target as HTMLTextAreaElement).blur();
    }
  }

  return (
    <div className="composer__field">
      <textarea
        ref={inputRef}
        className={className}
        aria-label="Tanya data akuntansi"
        role="combobox"
        aria-expanded={open}
        aria-controls={LISTBOX_ID}
        aria-autocomplete="list"
        aria-activedescendant={open && items.length > 0 ? `mention-opt-${active}` : undefined}
        aria-multiline="true"
        rows={1}
        value={value}
        onChange={(e) => {
          trackCaret(e.target);
          onChange(e.target.value);
          refresh(e.target.value, caretRef.current);
        }}
        onSelect={(e) => trackCaret(e.target as HTMLTextAreaElement)}
        onClick={(e) => {
          trackCaret(e.currentTarget);
          refresh(e.currentTarget.value, caretRef.current);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          ensureNames();
          onFocus?.();
        }}
        onBlur={() => {
          setOpen(false);
          onBlur?.();
        }}
        placeholder="Tanya sesuatu…"
        title="Enter kirim · Shift+Enter baris baru · @ pilih pelanggan"
      />
      {open && (
        <div className="mention" id={LISTBOX_ID} role="listbox" aria-label="Saran nama pelanggan">
          {loading && <p className="mention__hint">Memuat nama pelanggan…</p>}
          {!loading && items.length === 0 && (
            <p className="mention__hint">Tidak ada pelanggan yang cocok.</p>
          )}
          {items.map((c, i) => (
            <div
              key={`${c.customerNo}-${c.name}`}
              id={`mention-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className="mention__item"
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(c)}
            >
              <span className="mention__name">{c.name}</span>
              {c.customerNo && <span className="mention__no">{c.customerNo}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
