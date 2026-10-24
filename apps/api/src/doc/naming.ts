/** Penamaan file arsip: dd-MM-yyyy-JENIS-NAMA PELANGGAN/PEMASOK.ext */
export const DOC_LABEL: Record<string, string> = {
  faktur: "FAKTUR",
  nota: "NOTA",
  kwitansi: "KWITANSI",
  "screenshot-pembayaran": "SCREENSHOT PEMBAYARAN",
  "faktur-pembelian": "FAKTUR PEMBELIAN",
  "nota-pembelian": "NOTA PEMBELIAN",
  biaya: "BIAYA",
  transfer: "TRANSFER",
  lainnya: "LAINNYA",
};

export function splitDate(raw: string): { d: string; m: string; y: string } {
  const s = String(raw ?? "").trim();
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { d: iso[3]!, m: iso[2]!, y: iso[1]! };
  const dmy = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return { d: dmy[1]!.padStart(2, "0"), m: dmy[2]!.padStart(2, "0"), y: dmy[3]! };
  const now = new Date();
  return {
    d: String(now.getDate()).padStart(2, "0"),
    m: String(now.getMonth() + 1).padStart(2, "0"),
    y: String(now.getFullYear()),
  };
}

export function cleanParty(party: string): string {
  return String(party ?? "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** nama file: dd-MM-yyyy-JENIS-NAMA.ext (jenis kustom → label apa adanya) */
export function docFileName(kind: string, date: string, party: string, ext = "pdf", customLabel?: string): string {
  const { d, m, y } = splitDate(date);
  const label = DOC_LABEL[kind] ?? (cleanParty(customLabel ?? kind).toUpperCase() || "LAINNYA");
  const who = cleanParty(party) || "Umum";
  return `${d}-${m}-${y}-${label}-${who}.${ext}`;
}
