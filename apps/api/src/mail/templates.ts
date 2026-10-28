import { escapeHtml } from "../mail.js";

/**
 * Template email HTML profesional (table-based, inline styles — kompatibel
 * dengan Gmail/Outlook/Apple Mail). Warna selaras dengan aplikasi:
 * aksen oranye #ea580c, tinta #1c1917, latar #f5f5f4.
 */

export const BRAND = {
  name: "AI Asisten",
  accent: "#ea580c",
  ink: "#1c1917",
  body: "#44403c",
  muted: "#78716c",
  bg: "#f5f5f4",
  border: "#e7e5e4",
  card: "#fafaf9",
};

export function formatRupiah(n: number): string {
  return `Rp${Math.round(Number.isFinite(n) ? n : 0).toLocaleString("id-ID")}`;
}

export interface MailLayoutInput {
  /** Judul utama dalam kartu email */
  heading: string;
  /** Teks pratinjau di inbox (tanpa HTML) */
  preheader?: string;
  /** Paragraf pembuka (plain text, otomatis di-escape) */
  intro?: string;
  /** Badan email berupa HTML yang sudah di-escape */
  bodyHtml: string;
  /** Tombol ajakan utama */
  cta?: { label: string; url: string };
  /** Catatan kecil di bawah CTA (plain text, otomatis di-escape) */
  note?: string;
  /** Baris footer tambahan (plain text, otomatis di-escape) */
  footerNote?: string;
}

/** Bungkus konten dalam layout email profesional. */
export function renderMailLayout(input: MailLayoutInput): string {
  const preheader = escapeHtml(
    input.preheader ?? input.intro?.slice(0, 120) ?? input.heading
  );
  const introHtml = input.intro
    ? `<p style="margin:0 0 16px;font-size:14.5px;line-height:1.6;color:${BRAND.body}">${escapeHtml(input.intro)}</p>`
    : "";
  const ctaHtml = input.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px">
         <tr><td align="center" bgcolor="${BRAND.accent}" style="border-radius:8px">
           <a href="${escapeHtml(input.cta.url)}" style="display:inline-block;padding:12px 22px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(input.cta.label)}</a>
         </td></tr>
       </table>`
    : "";
  const noteHtml = input.note
    ? `<p style="margin:14px 0 0;font-size:12.5px;line-height:1.55;color:${BRAND.muted}">${escapeHtml(input.note)}</p>`
    : "";
  const footerNote = input.footerNote
    ? `<p style="margin:0 0 6px;font-size:12px;color:${BRAND.muted}">${escapeHtml(input.footerNote)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg}">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid ${BRAND.border};border-radius:14px;overflow:hidden">
        <tr><td style="height:5px;background:${BRAND.accent};font-size:0;line-height:0">&nbsp;</td></tr>
        <tr><td style="padding:26px 32px 8px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td align="left" style="vertical-align:middle">
                <span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background:${BRAND.accent};color:#ffffff;font-size:13px;font-weight:700;border-radius:7px;vertical-align:middle">AI</span>
                <span style="display:inline-block;margin-left:9px;font-size:15px;font-weight:700;color:${BRAND.ink};vertical-align:middle">${BRAND.name}</span>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:10px 32px 0">
          <h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;font-weight:700;color:${BRAND.ink}">${escapeHtml(input.heading)}</h1>
          ${introHtml}
          ${input.bodyHtml}
          ${ctaHtml}
          ${noteHtml}
        </td></tr>
        <tr><td style="padding:18px 32px 26px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="border-top:1px solid ${BRAND.border};padding-top:16px">
              ${footerNote}
              <p style="margin:0;font-size:12px;color:${BRAND.muted}">&copy; ${new Date().getFullYear()} ${BRAND.name} · Email otomatis, mohon jangan balas email ini.</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Badge status berwarna (HTML inline). */
export function statusBadgeHtml(status: string): string {
  const s = status.toLowerCase();
  let bg = "#fef3c7";
  let fg = "#92400e";
  let label = status || "MENUNGGU";
  if (/(lunas|settlement|capture|paid|aktif|success)/.test(s)) {
    bg = "#dcfce7";
    fg = "#166534";
    label = "LUNAS";
  } else if (/(batal|cancel|deny|expire|failure|gagal|berakhir)/.test(s)) {
    bg = "#fee2e2";
    fg = "#991b1b";
    label = "GAGAL";
  } else {
    label = "MENUNGGU PEMBAYARAN";
  }
  return `<span style="display:inline-block;padding:4px 10px;font-size:11px;font-weight:700;letter-spacing:0.4px;color:${fg};background:${bg};border-radius:999px">${escapeHtml(label)}</span>`;
}

/** Baris label–nilai untuk kartu ringkasan invoice. */
function kvRow(label: string, valueHtml: string, last = false): string {
  return `<tr>
    <td style="padding:${last ? "10px 0 0" : "10px 0"};font-size:12.5px;color:${BRAND.muted};border-bottom:${last ? "none" : `1px solid ${BRAND.border}`};vertical-align:top;width:38%">${escapeHtml(label)}</td>
    <td style="padding:${last ? "10px 0 0" : "10px 0"};font-size:13px;font-weight:600;color:${BRAND.ink};border-bottom:${last ? "none" : `1px solid ${BRAND.border}`};vertical-align:top;text-align:right">${valueHtml}</td>
  </tr>`;
}

export interface InvoiceMailInput {
  invoiceNo: string;
  /** dd/mm/yyyy */
  date: string;
  customerName: string;
  /** deskripsi layanan/barang */
  label: string;
  amount: number;
  status: string;
  /** URL halaman langganan (mis. ${APP_ORIGIN}/subscription) */
  ctaUrl?: string;
}

export interface BuiltMail {
  subject: string;
  text: string;
  html: string;
}

/** Email invoice profesional: ringkasan + panel total + lampiran PDF. */
export function renderInvoiceMail(input: InvoiceMailInput): BuiltMail {
  const total = formatRupiah(input.amount);
  const subject = `Invoice ${input.invoiceNo} — ${BRAND.name}`;
  const text =
    `Halo,\n\n` +
    `Berikut ringkasan invoice ${input.invoiceNo} (${input.date}) sebesar ${total} ` +
    `untuk ${input.customerName}. Status: ${input.status}.\n` +
    `PDF lengkap terlampir pada email ini.\n\n` +
    `Terima kasih telah menggunakan ${BRAND.name}.`;

  const bodyHtml =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BRAND.border};border-radius:12px;background:${BRAND.card};padding:4px 18px 4px;margin:4px 0 0">` +
    kvRow("Nomor", escapeHtml(input.invoiceNo)) +
    kvRow("Tanggal", escapeHtml(input.date)) +
    kvRow("Ditagihkan kepada", escapeHtml(input.customerName)) +
    kvRow("Rincian", escapeHtml(input.label)) +
    kvRow("Status", statusBadgeHtml(input.status), true) +
    `</table>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;background:${BRAND.ink};border-radius:12px">` +
    `<tr>
      <td style="padding:16px 20px;font-size:12px;font-weight:700;letter-spacing:0.6px;color:#d6d3d1">TOTAL</td>
      <td align="right" style="padding:16px 20px;font-size:19px;font-weight:700;color:#ffffff">${total}</td>
    </tr>` +
    `</table>`;

  return {
    subject,
    text,
    html: renderMailLayout({
      heading: `Invoice ${input.invoiceNo}`,
      preheader: `${total} untuk ${input.customerName} · PDF terlampir`,
      intro: `Berikut ringkasan invoice Anda. Salinan PDF lengkap terlampir pada email ini.`,
      bodyHtml,
      cta: input.ctaUrl ? { label: "Lihat di dasbor", url: input.ctaUrl } : undefined,
      note: "PDF invoice dapat diunduh kembali kapan saja melalui halaman Langganan di dasbor.",
      footerNote: `Invoice ${input.invoiceNo} · ${BRAND.name}`,
    }),
  };
}
