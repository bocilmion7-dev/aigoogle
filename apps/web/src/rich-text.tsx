import { useEffect, useRef, useState, type ReactNode } from "react";

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
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  if (!onOpen) return table;
  return (
    <div
      className="tbl-wrap"
      role="button"
      tabIndex={0}
      aria-label="Perbesar tabel"
      title="Klik untuk memperbesar"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {table}
      <span className="tbl-wrap__zoom" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M15 3h6v6" />
          <path d="M9 21H3v-6" />
          <path d="M21 3l-7 7" />
          <path d="M3 21l7-7" />
        </svg>
      </span>
    </div>
  );
}

function TableBlock({ tbl }: { tbl: Tbl }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
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
              <button ref={closeRef} className="modal__x" onClick={() => setOpen(false)} aria-label="Tutup tabel">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6L6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="modal__scroll">
              <TableView tbl={tbl} big />
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
        {s.text}
      </div>
    ) : (
      <TableBlock key={i} tbl={s.tbl} />
    )
  );
}
