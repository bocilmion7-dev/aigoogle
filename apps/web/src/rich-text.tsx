import { useEffect, useRef, useState, type ReactNode } from "react";
import { shareTableImage } from "./table-image";
import { IconDownload, IconShare } from "./icons";

/**
 * Renderer pesan AI: teks biasa (pre-wrap) + blok tabel markdown (| … |)
 * yang diubah jadi <table> HTML responsif — klik tabel → modal perbesar.
 * Aman streaming: baris tabel yang belum lengkap tampil sbg teks dulu,
 * berubah jadi tabel begitu baris selesai (parse ulang tiap render, stateless).
 * Tanpa dangerouslySetInnerHTML — semua sel dirender sbg text node React.
 */

interface Tbl {
  headers: string[];
  right: boolean[];
  rows: string[][];
}

type Seg = { type: "text"; text: string } | { type: "table"; tbl: Tbl };

function isTableLine(line: string): boolean {
  return /^\s*\|/.test(line);
}

function parseCells(line: string): string[] {
  const t = line.trim();
  const inner = t.startsWith("|") ? t.slice(1) : t;
  // buang pipa penutup (opsional dlm GFM) — kecuali bagian dari \| yang di-escape
  const body = inner.endsWith("|") && !inner.endsWith("\\|") ? inner.slice(0, -1) : inner;
  return body.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function isSeparator(cells: string[]): boolean {
  return cells.length > 1 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function parseSegments(content: string): Seg[] {
  const lines = content.split("\n");
  const out: Seg[] = [];
  let buf: string[] = [];
  let cand: string[] = [];

  const flushText = () => {
    if (buf.length) {
      out.push({ type: "text", text: buf.join("\n") });
      buf = [];
    }
  };
  const finalizeCand = () => {
    if (!cand.length) return;
    const cells = cand.map(parseCells);
    const header = cells[0] ?? [];
    const valid =
      cand.length >= 3 &&
      header.length > 1 &&
      isSeparator(cells[1]) &&
      cells.slice(2).some((r) => r.length === header.length);
    if (valid) {
      flushText();
      const right = cells[1].map((c) => c.endsWith(":"));
      const rows = cells
        .slice(2)
        .filter((r) => r.length === header.length)
        .map((r) => [...r]);
      out.push({ type: "table", tbl: { headers: header, right, rows } });
    } else {
      buf.push(...cand);
    }
    cand = [];
  };

  for (const line of lines) {
    if (isTableLine(line)) {
      cand.push(line);
      continue;
    }
    finalizeCand();
    buf.push(line);
  }
  finalizeCand();
  flushText();
  return out;
}

const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** tautan markdown [teks](https://…) → <a>; teks lain dibiarkan apa adanya */
function renderInline(text: string): ReactNode {
  if (!text.includes("](")) return text;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(
      <a
        key={`${at}-${m[2]}`}
        href={m[2]}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        {m[1]}
      </a>
    );
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : text;
}

function TableView({ tbl, big, onOpen }: { tbl: Tbl; big?: boolean; onOpen?: () => void }) {
  const table = (
    <table className={`dtable${big ? " dtable--lg" : ""}`}>
      <thead>
        <tr>
          {tbl.headers.map((h, i) => (
            <th key={i} className={tbl.right[i] ? "num" : undefined} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {tbl.rows.map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => (
              <td key={ci} className={tbl.right[ci] ? "num" : undefined}>
                {renderInline(cell)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  if (!onOpen) return table;
  return (
    <div className="tbl-wrap" title="Klik untuk memperbesar" onClick={onOpen}>
      {table}
      <button
        type="button"
        className="tbl-wrap__zoom"
        aria-label="Perbesar tabel"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M15 3h6v6" />
          <path d="M9 21H3v-6" />
          <path d="M21 3l-7 7" />
          <path d="M3 21l7-7" />
        </svg>
      </button>
    </div>
  );
}

function TableBlock({ tbl }: { tbl: Tbl }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const liveRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      wrapRef.current?.focus();
    };
  }, [open]);

  async function bagikan(mode: "share" | "download") {
    if (busy) return;
    const table = liveRef.current?.querySelector("table");
    if (!table) {
      setNote("Tabel belum siap, coba lagi.");
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const r = await shareTableImage(table as HTMLElement, mode);
      setNote(r === "shared" ? "Tabel dikirim ke menu bagikan." : "Gambar tabel diunduh.");
    } catch (e) {
      // pengguna membatalkan sheet share → bukan error
      if (e instanceof Error && e.name === "AbortError") return;
      setNote("Gagal membuat gambar tabel.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div ref={wrapRef} tabIndex={-1} style={{ outline: "none" }}>
        <TableView tbl={tbl} onOpen={() => setOpen(true)} />
      </div>
      {open && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="modal modal--data" role="dialog" aria-modal="true" aria-label="Tabel data">
            <div className="modal__head">
              <strong className="modal__title">Tabel data</strong>
              <div className="modal__actions">
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => void bagikan("share")}
                  disabled={busy}
                  aria-label="Bagikan tabel sebagai gambar"
                >
                  {busy ? <span className="spinner" aria-hidden="true" /> : <IconShare size={15} />}
                  <span>Bagikan</span>
                </button>
                <button
                  type="button"
                  className="btn btn--2 btn--sm"
                  onClick={() => void bagikan("download")}
                  disabled={busy}
                  aria-label="Unduh tabel sebagai gambar"
                >
                  <IconDownload size={15} />
                  <span>Unduh</span>
                </button>
                <button ref={closeRef} className="modal__x" onClick={() => setOpen(false)} aria-label="Tutup tabel">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                    <path d="M18 6L6 18" />
                    <path d="M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            {note && (
              <p className="meta" role="status" aria-live="polite" style={{ margin: 0 }}>
                {note}
              </p>
            )}
            <div className="modal__scroll">
              <div ref={liveRef}>
                <TableView tbl={tbl} big />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function renderRichText(content: string): ReactNode[] {
  return parseSegments(content).map((s, i) =>
    s.type === "text" ? (
      <div key={i} className="rich-text">
        {renderInline(s.text)}
      </div>
    ) : (
      <TableBlock key={i} tbl={s.tbl} />
    )
  );
}
