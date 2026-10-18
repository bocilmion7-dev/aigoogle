/**
 * Pesan banner chat yang tampil ke user untuk error stream LLM —
 * dipisah drpd route supaya bisa diuji tanpa membuka server.
 */
export function friendlyChatErrorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);

  // kuota harian (TPD) Groq/dll — sampaikan estimasi reset dari provider bila ada
  if (/tokens per day|\(TPD\)|kuota harian/i.test(m)) {
    const menit = /\btry again in (\d+)m/i.exec(m)?.[1];
    return menit
      ? `Kuota AI harian habis — coba lagi dalam ${menit} menit.`
      : "Kuota AI harian habis — coba lagi beberapa menit lagi.";
  }

  // rate limit per-menit (TPM) — batas token/menit, reset cepat → minta jeda singkat
  if (/rate.?limit|tokens per minute|\(TPM\)|per minute/i.test(m)) {
    const detik = /\btry again in ([\d.]+)s/i.exec(m)?.[1];
    const d = detik ? Math.ceil(parseFloat(detik)) : null;
    return d && d > 0
      ? `Permintaan AI sedang ramai — coba lagi dalam ${d} detik.`
      : "Permintaan AI sedang ramai — coba lagi sebentar lagi.";
  }

  // saldo provider AI habis (Gonka 402 insufficient_funds) — perlu top-up admin,
  // bukan "coba lagi" yg menyesatkan
  if (/insufficient|out of credit|top.?up/i.test(m)) {
    return "Saldo layanan AI habis — hubungi admin untuk mengisi ulang.";
  }

  // koneksi ke provider AI terputus di tengah streaming (Gonka reset/ECONNRESET)
  if (/terminated|ECONNRESET|socket hang up|network|read ECONNRESET/i.test(m)) {
    return "Koneksi ke layanan AI terputus di tengah — coba lagi.";
  }

  // timeout PER PERCOBAAN yg bocor ke user (mis. sudah terkirim sebagian output
  // saat kandidat kena batas 70 dtk) — bukan deadline total, sampaikan dgn jelas
  if (/timeout|waktu tunggu habis|the operation was aborted due to timeout/i.test(m)) {
    return "AI terlalu lama merespon — coba lagi.";
  }

  if (/503|tidak ada model|tidak ada provider|tidak tersedia/i.test(m)) {
    return "Layanan AI sedang tidak tersedia — atur provider di menu AI atau coba lagi sebentar.";
  }

  return "Terjadi gangguan — coba lagi.";
}
