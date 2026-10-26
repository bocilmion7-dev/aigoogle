/** Tanggal (YYYY-MM-DD) menurut WIB — acuan "refresh sekali sehari". */
export function wibDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Menit sejak 00:00 WIB (untuk jadwal harian 04:30). */
export function wibMinutes(d = new Date()): number {
  const s = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  const [h, m] = s.split(":").map((x) => Number(x) || 0);
  return h * 60 + m;
}
