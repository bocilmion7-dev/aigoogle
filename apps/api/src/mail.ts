import { env } from "./env.js";

export interface MailAttachment {
  filename: string;
  /** isi file dalam base64 */
  content: string;
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
  replyTo?: string;
}

/** Escape teks yang akan dimasukkan ke HTML email (nama user/tenant tidak dipercaya). */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Kirim email via Resend. Tanpa RESEND_API_KEY → log link (dev) & return false. */
export async function sendMail(input: MailInput): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.warn(`[mail:dev] ke=${input.to} subjek="${input.subject}"\n${input.text}`);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        ...(input.replyTo || env.MAIL_REPLY_TO ? { reply_to: input.replyTo || env.MAIL_REPLY_TO } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn("[mail] gagal:", res.status, (await res.text().catch(() => "")).slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[mail] gagal:", e instanceof Error ? e.message : e);
    return false;
  }
}
