import { env } from "../env.js";
import { decryptToken, encryptToken } from "../crypto.js";
import { prisma } from "../db.js";
import { writeAudit } from "../audit.js";

export const WA_COST_CREDITS_PER_MESSAGE = 1;
export const WA_TOPUP_RUPIAH_PER_CREDIT = 200;

export async function waPricePerCredit(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: "waPricePerCredit" } });
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : WA_TOPUP_RUPIAH_PER_CREDIT;
}

export function metaConfigured(): boolean {
  return env.META_APP_ID !== "" && env.META_APP_SECRET !== "";
}

export function embeddedSignupUrl(redirectUri: string): string | null {
  if (!env.META_APP_ID || !env.META_EMBEDDED_CONFIG_ID) return null;
  const u = new URL("https://www.facebook.com/v21.0/dialog/wa_embedded_signup");
  u.searchParams.set("app_id", env.META_APP_ID);
  u.searchParams.set("config_id", env.META_EMBEDDED_CONFIG_ID);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("override_default_response_type", "1");
  u.searchParams.set("redirect_uri", redirectUri);
  return u.toString();
}

/** base URL 360dialog (produksi; sandbox dapat dioverride via appSetting) */
export const D360_DEFAULT_BASE = "https://waba-v2.360dialog.io";

export type WaProvider = "meta" | "d360" | "waserver";

/** nilai provider dari AppSetting — nilai tak dikenal jatuh ke d360 (perilaku lama) */
function parseWaProvider(v: string | undefined): WaProvider {
  return v === "meta" || v === "waserver" ? v : "d360";
}

export function waserverReady(): boolean {
  return env.WASERVER_URL !== "" && env.WASERVER_API_KEY !== "";
}

/** HTTP ke gateway waserver — semua request memakai X-API-Key */
async function waserverFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${env.WASERVER_URL.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      "X-API-Key": env.WASERVER_API_KEY,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
}

export interface WaserverSession {
  sessionId: string;
  tenantId: string;
  state: "pending" | "connecting" | "connected" | "logged_out" | "banned";
  phone: string | null;
  label: string;
  /** data URL PNG — hanya ada bila state pending/connecting dan QR sudah dihasilkan */
  qr: string | null;
}

/** Ambil sesi waserver milik tenant; bila belum ada, dibuat lalu socket-nya dinyalakan.
 *  Idempoten — memanggil berulang aman. QR muncul beberapa saat setelah pemanggilan pertama. */
export async function ensureWaserverSession(tenantId: string, label: string): Promise<WaserverSession | null> {
  if (!waserverReady()) return null;
  const r = await waserverFetch("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({ tenantId, label }),
  });
  if (!r.ok) return null;
  return (await r.json()) as WaserverSession;
}

/** Ambil sesi tanpa memastikan socket aktif — dipakai utk cek status berkala. */
export async function getWaserverSession(tenantId: string): Promise<WaserverSession | null> {
  if (!waserverReady()) return null;
  const r = await waserverFetch("/v1/sessions");
  if (!r.ok) return null;
  const all = (await r.json()) as WaserverSession[];
  return all.find((s) => s.tenantId === tenantId) ?? null;
}

export async function reconnectWaserverSession(tenantId: string): Promise<boolean> {
  const s = await ensureWaserverSession(tenantId, "");
  if (!s) return false;
  const r = await waserverFetch(`/v1/sessions/${s.sessionId}/reconnect`, { method: "POST" });
  return r.ok;
}

/** Putus & hapus sesi — credential WhatsApp di gateway ikut terbuang. */
export async function removeWaserverSession(tenantId: string): Promise<boolean> {
  const s = await getWaserverSession(tenantId);
  if (!s) return false;
  const r = await waserverFetch(`/v1/sessions/${s.sessionId}`, { method: "DELETE" });
  return r.ok;
}

/** Sinkronkan baris WaAccount agar sendWaText memilih jalur waserver. */
export async function syncWaserverAccount(tenantId: string, session: WaserverSession | null): Promise<void> {
  const connected = session?.state === "connected";
  const data = {
    provider: "waserver",
    status: connected ? "connected" : "pending",
    displayName: session?.phone ?? "",
    phoneNumberId: session?.phone ?? "",
  };
  await prisma.waAccount.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });
}

/** kirim text via gateway waserver — antrean durable di sisi waserver */
async function sendViaWaserver(
  tenantId: string,
  to: string,
  body: string
): Promise<{ ok: boolean; error?: string; outboxId?: number }> {
  const r = await waserverFetch("/v1/send", {
    method: "POST",
    body: JSON.stringify({ tenantId, to, text: body }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return { ok: false, error: `waserver_${r.status}:${t.slice(0, 200)}` };
  }
  const j = (await r.json()) as { outboxId?: number; status?: string };
  return { ok: true, outboxId: j.outboxId };
}

/** kirim text via 360dialog — body kompatibel Meta Cloud API, auth header D360-API-KEY */
async function sendD360Text(
  apiKey: string,
  baseUrl: string,
  to: string,
  body: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "D360-API-KEY": apiKey },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return { ok: false, error: `d360_${res.status}:${err.slice(0, 200)}` };
  }
  return { ok: true };
}

/** appSetting global utk provider WA */
async function waProviderSettings(): Promise<{
  provider: WaProvider;
  d360ApiKey: string;
  d360BaseUrl: string;
}> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ["waProvider", "waD360ApiKey", "waD360BaseUrl"] } },
  });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  return {
    provider: parseWaProvider(get("waProvider")),
    d360ApiKey: get("waD360ApiKey") ?? "",
    d360BaseUrl: get("waD360BaseUrl") ?? D360_DEFAULT_BASE,
  };
}

/** provider global utk halaman status (meta | d360 | waserver) */
export async function getWaProviderGlobal(): Promise<{ provider: WaProvider }> {
  const row = await prisma.appSetting.findUnique({ where: { key: "waProvider" } });
  return { provider: parseWaProvider(row?.value) };
}

export async function sendWaText(
  tenantId: string,
  to: string,
  body: string
): Promise<{ ok: boolean; error?: string; outboxId?: number }> {
  const acct = await prisma.waAccount.findUnique({ where: { tenantId } });
  const prov = await waProviderSettings();

  // ── CABANG WASERVER (gateway Baileys multi-tenant) ──
  // Harus berada SEBELUM cabang d360: tanpa ini, akun ber-provider "waserver"
  // lolos ke jalur kunci-global d360 (pakaiKunciGlobal = true) dan bocor gratis.
  // Dipilih bila perusahaan mengaktifkan waserver sendiri, ATAU provider global
  // waserver dan perusahaan belum punya akun lain.
  const pakaiWaserver =
    waserverReady() &&
    (acct?.provider === "waserver" || (prov.provider === "waserver" && !acct));
  if (pakaiWaserver) {
    const bal = await prisma.waBalance.upsert({
      where: { tenantId },
      create: { tenantId, amount: 0 },
      update: {},
    });
    if (bal.amount < WA_COST_CREDITS_PER_MESSAGE) {
      await prisma.waMessageLog.create({
        data: { tenantId, to, body, status: "failed", error: "saldo_kurang", costCredits: 0 },
      });
      return { ok: false, error: "saldo_kurang" };
    }
    const r = await sendViaWaserver(tenantId, to, body);
    if (!r.ok) {
      await prisma.waMessageLog.create({
        data: { tenantId, to, body, status: "failed", error: r.error ?? "waserver_error", costCredits: 0 },
      });
      return r;
    }
    await prisma.$transaction([
      prisma.waBalance.update({
        where: { tenantId },
        data: { amount: { decrement: WA_COST_CREDITS_PER_MESSAGE } },
      }),
      prisma.waMessageLog.create({
        data: {
          tenantId,
          to,
          body,
          status: "queued",
          costCredits: WA_COST_CREDITS_PER_MESSAGE,
          waserverOutboxId: r.outboxId ?? null,
        },
      }),
    ]);
    return { ok: true, outboxId: r.outboxId };
  }

  // jalur 360dialog: akun perusahaan (API key sendiri) ATAU fallback kunci global (sandbox platform)
  const pakaiKunciGlobal = !acct || acct.provider !== "d360";
  if ((acct && acct.provider === "d360" && acct.tokenEnc) || (pakaiKunciGlobal && prov.provider === "d360" && prov.d360ApiKey)) {
    const apiKey = acct?.provider === "d360" ? decryptToken(acct.tokenEnc) : prov.d360ApiKey;
    // kunci milik perusahaan → pakai kredit; kunci global platform (sandbox) → gratis
    if (!pakaiKunciGlobal) {
      const bal = await prisma.waBalance.upsert({
        where: { tenantId },
        create: { tenantId, amount: 0 },
        update: {},
      });
      if (bal.amount < WA_COST_CREDITS_PER_MESSAGE) {
        await prisma.waMessageLog.create({
          data: { tenantId, to, body, status: "failed", error: "saldo_kurang", costCredits: 0 },
        });
        return { ok: false, error: "saldo_kurang" };
      }
    }
    const r = await sendD360Text(apiKey, prov.d360BaseUrl, to, body);
    if (!r.ok) {
      await prisma.waMessageLog.create({
        data: { tenantId, to, body, status: "failed", error: r.error ?? "d360_error", costCredits: 0 },
      });
      return r;
    }
    if (!pakaiKunciGlobal) {
      await prisma.$transaction([
        prisma.waBalance.update({
          where: { tenantId },
          data: { amount: { decrement: WA_COST_CREDITS_PER_MESSAGE } },
        }),
        prisma.waMessageLog.create({
          data: { tenantId, to, body, status: "sent", costCredits: WA_COST_CREDITS_PER_MESSAGE },
        }),
      ]);
    } else {
      await prisma.waMessageLog.create({
        data: { tenantId, to, body, status: "sent", costCredits: 0 },
      });
    }
    return { ok: true };
  }

  if (!acct || !acct.phoneNumberId || !acct.tokenEnc) {
    await prisma.waMessageLog.create({
      data: { tenantId, to, body, status: "failed", error: "belum_connect", costCredits: 0 },
    });
    return { ok: false, error: "belum_connect" };
  }
  const bal = await prisma.waBalance.upsert({
    where: { tenantId },
    create: { tenantId, amount: 0 },
    update: {},
  });
  if (bal.amount < WA_COST_CREDITS_PER_MESSAGE) {
    await prisma.waMessageLog.create({
      data: { tenantId, to, body, status: "failed", error: "saldo_kurang", costCredits: 0 },
    });
    return { ok: false, error: "saldo_kurang" };
  }
  const token = decryptToken(acct.tokenEnc);
  const res = await fetch(`https://graph.facebook.com/v21.0/${acct.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    await prisma.waMessageLog.create({
      data: { tenantId, to, body, status: "failed", error: `graph_${res.status}:${err.slice(0, 200)}`, costCredits: 0 },
    });
    return { ok: false, error: `graph_${res.status}` };
  }
  await prisma.$transaction([
    prisma.waBalance.update({
      where: { tenantId },
      data: { amount: { decrement: WA_COST_CREDITS_PER_MESSAGE } },
    }),
    prisma.waMessageLog.create({
      data: {
        tenantId,
        to,
        body,
        status: "sent",
        costCredits: WA_COST_CREDITS_PER_MESSAGE,
      },
    }),
  ]);
  return { ok: true };
}

/** Terima event balikan dari gateway waserver (pesan masuk + status kirim).
 *  Dipanggil route POST /api/wa/waserver/events; idempoten untuk message.status. */
export async function handleWaserverEvent(
  ev: unknown
): Promise<{ ok: boolean; error?: string }> {
  const e = ev as {
    type?: string;
    tenantId?: string;
    from?: string;
    text?: string;
    outboxId?: number;
    status?: string;
    error?: string;
    state?: string;
  };
  if (!e || typeof e.tenantId !== "string" || e.tenantId === "") {
    return { ok: false, error: "bad_event" };
  }

  if (e.type === "message.inbound") {
    // waserver mengirim JID (628xxxx@s.whatsapp.net) — simpan sebagai nomor saja
    const peer = String(e.from ?? "").split("@")[0] ?? "";
    await prisma.waMessageLog.create({
      data: {
        tenantId: e.tenantId,
        to: peer,
        body: String(e.text ?? ""),
        status: "received",
        direction: "in",
        costCredits: 0,
      },
    });
    return { ok: true };
  }

  if (e.type === "message.status") {
    const outboxId = Number(e.outboxId);
    if (!Number.isFinite(outboxId)) return { ok: true };
    // pesan kirim-manual dari panel waserver tak punya baris di aigoogle — update no-op
    await prisma.waMessageLog.updateMany({
      where: { tenantId: e.tenantId, waserverOutboxId: outboxId },
      data: { status: e.status === "sent" ? "sent" : "failed", error: String(e.error ?? "") },
    });
    return { ok: true };
  }

  if (e.type === "session.state") {
    const acct = await prisma.waAccount.findUnique({ where: { tenantId: e.tenantId } });
    if (acct?.provider === "waserver") {
      await prisma.waAccount.update({
        where: { tenantId: e.tenantId },
        data: { status: e.state === "connected" ? "connected" : "pending" },
      });
    }
    return { ok: true };
  }

  return { ok: true };
}

export async function getOrCreateBalance(tenantId: string): Promise<number> {
  const bal = await prisma.waBalance.upsert({
    where: { tenantId },
    create: { tenantId, amount: 0 },
    update: {},
  });
  return bal.amount;
}

export function creditsFromRupiah(rupiah: number, pricePerCredit: number = WA_TOPUP_RUPIAH_PER_CREDIT): number {
  return Math.floor(rupiah / pricePerCredit);
}

export async function getWaSettings(tenantId: string): Promise<{
  autoDueDate: boolean;
  dailyReport: boolean;
  ownerPhone: string;
}> {
  const keys = [`wa:auto_due:${tenantId}`, `wa:daily_report:${tenantId}`, `wa:owner_phone:${tenantId}`];
  const rows = await prisma.appSetting.findMany({ where: { key: { in: keys } } });
  const m = new Map(rows.map((r) => [r.key, r.value]));
  return {
    autoDueDate: m.get(keys[0]) === "1",
    dailyReport: m.get(keys[1]) === "1",
    ownerPhone: m.get(keys[2]) ?? "",
  };
}

export async function setWaSettings(
  tenantId: string,
  s: { autoDueDate?: boolean; dailyReport?: boolean; ownerPhone?: string }
): Promise<void> {
  const ops: Array<{ key: string; value: string }> = [];
  if (s.autoDueDate !== undefined) ops.push({ key: `wa:auto_due:${tenantId}`, value: s.autoDueDate ? "1" : "0" });
  if (s.dailyReport !== undefined) ops.push({ key: `wa:daily_report:${tenantId}`, value: s.dailyReport ? "1" : "0" });
  if (s.ownerPhone !== undefined) ops.push({ key: `wa:owner_phone:${tenantId}`, value: s.ownerPhone });
  for (const o of ops) {
    await prisma.appSetting.upsert({
      where: { key: o.key },
      create: o,
      update: { value: o.value },
    });
  }
}

/** event Accurate yang bisa diikuti notifikasi (subset bisnis dari 73 event) */
export const WA_WEBHOOK_EVENT_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "CUSTOMER", label: "Pelanggan" },
  { key: "VENDOR", label: "Pemasok" },
  { key: "ITEM", label: "Barang & Jasa" },
  { key: "SALES_INVOICE", label: "Faktur penjualan" },
  { key: "SALES_ORDER", label: "Pesanan penjualan" },
  { key: "SALES_QUOTATION", label: "Penawaran penjualan" },
  { key: "SALES_RECEIPT", label: "Penerimaan kas" },
  { key: "PURCHASE_INVOICE", label: "Faktur pembelian" },
  { key: "PURCHASE_ORDER", label: "Pesanan pembelian" },
  { key: "JOURNAL_VOUCHER", label: "Buku jurnal" },
  { key: "GLACCOUNT", label: "Akun GL" },
  { key: "WAREHOUSE", label: "Gudang" },
];

export async function getWaWebhookSettings(tenantId: string): Promise<{
  events: string[];
  rateMin: number;
  ownerPhone: string;
  options: Array<{ key: string; label: string }>;
}> {
  const keys = [`wa:webhook_events:${tenantId}`, `wa:webhook_rate:${tenantId}`, `wa:owner_phone:${tenantId}`];
  const rows = await prisma.appSetting.findMany({ where: { key: { in: keys } } });
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const events: string[] = (() => {
    try { return JSON.parse(m.get(keys[0]) ?? "[]"); } catch { return []; }
  })();
  const rate = Number(m.get(keys[1]) ?? 10);
  return {
    events: Array.isArray(events) ? events : [],
    rateMin: Number.isFinite(rate) && rate >= 1 ? rate : 10,
    ownerPhone: m.get(keys[2]) ?? "",
    options: WA_WEBHOOK_EVENT_OPTIONS,
  };
}

export async function setWaWebhookSettings(
  tenantId: string,
  s: { events?: string[]; rateMin?: number; ownerPhone?: string }
): Promise<void> {
  const ops: Array<{ key: string; value: string }> = [];
  if (s.events !== undefined) ops.push({ key: `wa:webhook_events:${tenantId}`, value: JSON.stringify(s.events) });
  if (s.rateMin !== undefined) ops.push({ key: `wa:webhook_rate:${tenantId}`, value: String(s.rateMin) });
  if (s.ownerPhone !== undefined) ops.push({ key: `wa:owner_phone:${tenantId}`, value: s.ownerPhone });
  for (const o of ops) {
    await prisma.appSetting.upsert({
      where: { key: o.key },
      create: o,
      update: { value: o.value },
    });
  }
}

/** Selesaikan topup (dipanggil webhook Winpay / query status / mock).
 *  Idempoten: order yg sudah settlement tak dikreditkan dua kali. */
export async function finalizeWaTopup(
  orderId: string,
  paid: boolean,
  finalStatus: string,
  paymentMethod: string
): Promise<boolean> {
  const topup = await prisma.waTopup.findUnique({ where: { orderId } });
  if (!topup) return false;
  if (topup.status === "settlement") return true;
  await prisma.waTopup.update({
    where: { id: topup.id },
    data: { status: finalStatus, paymentMethod },
  });
  if (paid) {
    await prisma.waBalance.upsert({
      where: { tenantId: topup.tenantId },
      create: { tenantId: topup.tenantId, amount: topup.credits },
      update: { amount: { increment: topup.credits } },
    });
    await writeAudit(topup.tenantId, "system", "wa.topup_settled", {
      orderId: topup.orderId,
      credits: topup.credits,
      paymentMethod,
    });
  } else {
    await writeAudit(topup.tenantId, "system", "wa.topup_failed", {
      orderId: topup.orderId,
      status: finalStatus,
      paymentMethod,
    });
  }
  return true;
}
