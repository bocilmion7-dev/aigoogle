/** Klien Biteship (ongkir + order + pelacakan) — dipakai fitur pengiriman pesanan WA.
 *
 *  Dokumentasi ringkas yang dipakai:
 *   POST /v1/rates/couriers   → daftar harga kurir (origin/destination postal code + items)
 *   POST /v1/orders           → buat order pengiriman (butuh key yang sudah AKTIF)
 *   GET  /v1/orders/:id       → detail order + waybill
 *   GET  /v1/trackings/:awb   → riwayat pelacakan (?courier=jne)
 *   GET  /v1/maps/areas       → cari area/kode pos
 */

export interface BiteshipArea {
  id: string;
  name: string;
  postalCode: string;
}

export interface ShippingItem {
  name: string;
  value: number;
  quantity: number;
  /** gram */
  weight: number;
}

export interface RateOption {
  courierName: string;
  courierCode: string;
  serviceCode: string;
  serviceName: string;
  price: number;
  duration: string;
  type: string;
  shippingType: string;
}

export interface ShippingOrigin {
  contactName: string;
  phone: string;
  email?: string;
  organization: string;
  address: string;
  postalCode: string;
  note?: string;
}

export interface ShipmentInput {
  origin: ShippingOrigin;
  destination: {
    contactName: string;
    phone: string;
    email?: string;
    address: string;
    postalCode: string;
    note?: string;
  };
  courier: { company: string; type: string };
  items: ShippingItem[];
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface ShipmentResult {
  id: string;
  status: string;
  /** nomor resi kurir */
  waybillId: string;
  /** id tracking Biteship — kunci halaman publik & API tracking */
  trackingId: string;
  /** link halaman pelacakan untuk pelanggan (track.biteship.com) */
  trackingLink: string;
  courier: { company: string; type: string; name?: string };
}

/** Halaman pelacakan publik Biteship (dipakai pelanggan tanpa login). */
export function trackingPageUrl(trackingId: string): string {
  const id = trackingId.trim();
  return id ? `https://track.biteship.com/${encodeURIComponent(id)}` : "";
}

export interface TrackingResult {
  id: string;
  waybillId: string;
  /** link pelacakan dari Biteship/kurir bila ada */
  link: string;
  orderId: string;
  courier: { company: string; name?: string; driverName?: string; driverPhone?: string };
  status: string;
  history: Array<{ note: string; status: string; updatedAt: string }>;
}

const baseUrl = () => (process.env.BITESHIP_BASE_URL ?? "https://api.biteship.com").replace(/\/+$/, "");

/**
 * Key Biteship yang dipakai. Default: BITESHIP_API_KEY (test/live sesuai prefix).
 * Produksi: set BITESHIP_USE_LIVE=1 → memakai BITESHIP_LIVE_API_KEY (bila ada).
 * Sengaja eksplisit agar order TIDAK diam-diam berubah jadi pengiriman nyata.
 */
function apiKey(): string {
  const useLive = /^(1|true|yes)$/i.test(process.env.BITESHIP_USE_LIVE ?? "");
  if (useLive && process.env.BITESHIP_LIVE_API_KEY) return process.env.BITESHIP_LIVE_API_KEY;
  return process.env.BITESHIP_API_KEY ?? "";
}

const digitsOnly = (v: string) => String(v ?? "").replace(/\D/g, "");

export function biteshipReady(): boolean {
  return apiKey() !== "";
}

/**
 * Mode key Biteship berdasarkan prefix:
 * - "test"  → biteship_test.* (Mode Testing; Order API aktif tanpa aktivasi)
 * - "live"  → biteship_live.* (Order API harus diaktivasi lewat dashboard)
 * - "off"   → belum diisi
 * Maps/Rates/Tracking di Mode Testing tetap dihitung pemakaian berbayar.
 */
export function biteshipKeyMode(): "off" | "test" | "live" {
  const k = apiKey();
  if (!k) return "off";
  return k.startsWith("biteship_test.") ? "test" : "live";
}

/** Kurir default untuk cek ongkir (bisa dioverride setelan platform). */
export function defaultCouriers(): string {
  return process.env.BITESHIP_COURIERS ?? "jne,jnt,sicepat,anteraja,pos,ide,spx,ninja";
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!biteshipReady()) throw new Error("Biteship belum dikonfigurasi (BITESHIP_API_KEY kosong)");
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: apiKey(),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(25_000),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || j.success === false) {
    throw new Error(`biteship: ${String(j.error ?? j.message ?? `HTTP ${res.status}`).slice(0, 300)}`);
  }
  return j as T;
}

function areaOf(a: Record<string, unknown> | undefined): BiteshipArea | null {
  if (!a) return null;
  return { id: String(a.id ?? ""), name: String(a.name ?? ""), postalCode: String(a.postal_code ?? "") };
}

/** Cari area (kecamatan/kode pos) — untuk memilih kode pos asal & tujuan. */
export async function searchAreas(input: string, limit = 10): Promise<BiteshipArea[]> {
  const q = input.trim();
  if (!q) return [];
  const j = await call<{ areas?: Array<Record<string, unknown>> }>(
    `/v1/maps/areas?countries=ID&input=${encodeURIComponent(q)}`
  );
  return (j.areas ?? [])
    .map((a) => areaOf(a))
    .filter((a): a is BiteshipArea => !!a && !!a.id && !!a.postalCode)
    .slice(0, limit);
}

/** Ongkir: harga per kurir/layanan untuk rute & berat tertentu. */
export async function getRates(opts: {
  originPostalCode: string;
  destinationPostalCode: string;
  items: ShippingItem[];
  couriers?: string;
}): Promise<RateOption[]> {
  const destination = opts.destinationPostalCode.replace(/\D/g, "");
  if (!/^\d{5}$/.test(destination)) throw new Error("kode pos tujuan harus 5 digit");
  const origin = opts.originPostalCode.replace(/\D/g, "");
  if (!/^\d{5}$/.test(origin)) throw new Error("kode pos asal (gudang) belum diatur — isi di Pengaturan Pengiriman");
  const j = await call<{ pricing?: Array<Record<string, unknown>> }>("/v1/rates/couriers", {
    method: "POST",
    body: JSON.stringify({
      origin_postal_code: Number(origin),
      destination_postal_code: Number(destination),
      couriers: opts.couriers ?? defaultCouriers(),
      items: opts.items.map((it) => ({
        name: it.name.slice(0, 100),
        description: "",
        value: Math.max(1, Math.round(it.value)),
        quantity: Math.max(1, it.quantity),
        weight: Math.max(1, Math.round(it.weight)),
      })),
    }),
  });
  return (j.pricing ?? []).map((p) => ({
    courierName: String(p.courier_name ?? ""),
    courierCode: String(p.courier_code ?? ""),
    serviceCode: String(p.courier_service_code ?? ""),
    serviceName: String(p.courier_service_name ?? ""),
    price: Number(p.price ?? 0),
    duration:
      String(p.duration ?? "") ||
      [p.shipment_duration_range, p.shipment_duration_unit].filter(Boolean).join(" "),
    type: String(p.service_type ?? ""),
    shippingType: String(p.shipping_type ?? ""),
  }));
}

/** Buat order pengiriman Biteship (menghasilkan id + waybill untuk pelacakan). */
export async function createShipment(opts: ShipmentInput): Promise<ShipmentResult> {
  const o = opts.origin;
  const d = opts.destination;
  const j = await call<Record<string, unknown>>("/v1/orders", {
    method: "POST",
    body: JSON.stringify({
      shipper_contact_name: o.contactName || o.organization || "Toko",
      shipper_contact_phone: digitsOnly(o.phone),
      shipper_contact_email: o.email ?? "",
      shipper_organization: o.organization || "Toko",
      origin_contact_name: o.contactName || o.organization || "Toko",
      origin_contact_phone: digitsOnly(o.phone),
      origin_address: o.address,
      origin_note: o.note ?? "",
      origin_postal_code: Number(o.postalCode.replace(/\D/g, "")),
      destination_contact_name: d.contactName || "Pembeli",
      destination_contact_phone: digitsOnly(d.phone),
      destination_contact_email: d.email ?? "",
      destination_address: d.address,
      destination_note: d.note ?? "",
      destination_postal_code: Number(d.postalCode.replace(/\D/g, "")),
      courier_company: opts.courier.company,
      courier_type: opts.courier.type,
      courier_insurance: 0,
      delivery_type: "now",
      order_note: opts.description ?? "",
      metadata: opts.metadata ?? {},
      items: opts.items.map((it) => ({
        name: it.name.slice(0, 100),
        description: "",
        value: Math.max(1, Math.round(it.value)),
        quantity: Math.max(1, it.quantity),
        weight: Math.max(1, Math.round(it.weight)),
      })),
    }),
  });
  const courier = (j.courier ?? {}) as Record<string, unknown>;
  const trackingId = String(courier.tracking_id ?? j.tracking_id ?? "");
  return {
    id: String(j.id ?? ""),
    status: String(j.status ?? ""),
    waybillId: String(courier.waybill_id ?? ""),
    trackingId,
    trackingLink: courier.tracking_link ? String(courier.tracking_link) : trackingPageUrl(trackingId),
    courier: {
      company: String(courier.company ?? opts.courier.company),
      type: String(courier.type ?? opts.courier.type),
      name: courier.name ? String(courier.name) : undefined,
    },
  };
}

/**
 * Lacak paket. `id` = tracking_id Biteship (dari create order); `courier`
 * hanya diperlukan bila yang dikirim nomor resi (waybill) — sesuai dokumentasi
 * `GET /v1/trackings/:id`.
 */
export async function track(id: string, courier?: string): Promise<TrackingResult> {
  const key = id.trim();
  if (!key) throw new Error("id tracking / nomor resi belum ada");
  const qs = courier ? `?courier=${encodeURIComponent(courier)}` : "";
  const j = await call<Record<string, unknown>>(`/v1/trackings/${encodeURIComponent(key)}${qs}`);
  const c = (j.courier ?? {}) as Record<string, unknown>;
  const history = Array.isArray(j.history) ? (j.history as Array<Record<string, unknown>>) : [];
  return {
    id: String(j.id ?? key),
    waybillId: String(j.waybill_id ?? ""),
    link: String(j.link ?? ""),
    orderId: String(j.order_id ?? ""),
    courier: {
      company: String(c.company ?? courier),
      name: c.name ? String(c.name) : undefined,
      driverName: c.driver_name ? String(c.driver_name) : undefined,
      driverPhone: c.driver_phone ? String(c.driver_phone) : undefined,
    },
    status: String(j.status ?? history.at(-1)?.status ?? ""),
    history: history.map((h) => ({
      note: String(h.note ?? ""),
      status: String(h.status ?? ""),
      updatedAt: String(h.updated_at ?? ""),
    })),
  };
}
