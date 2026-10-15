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

  if (/503|tidak ada model|tidak ada provider|tidak tersedia/i.test(m)) {
    return "Layanan AI sedang tidak tersedia — atur provider di menu AI atau coba lagi sebentar.";
  }

  return "Terjadi gangguan — coba lagi.";
}
