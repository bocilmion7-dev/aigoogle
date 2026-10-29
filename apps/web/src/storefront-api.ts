export type StorefrontMode = "product" | "service";

export interface StorefrontSettings {
  slug: string;
  mode: StorefrontMode;
  template: string;
  theme: string;
  bannerUrl: string;
  logoUrl: string;
  tagline: string;
  description: string;
  whatsapp: string;
  active: boolean;
  publicUrl: string;
  templates: Record<StorefrontMode, string[]>;
  productsSyncedAt: string | null;
}

export interface StorefrontProductRow {
  id: string;
  itemNo: string;
  name: string;
  title: string;
  description: string;
  imageUrl: string;
  images: string[];
  category: string;
  unit: string;
  price: number | null;
  stock: number | null;
  active: boolean;
  featured: boolean;
  sortOrder: number;
}

export interface PublicStorefront {
  store: {
    slug: string;
    companyName: string;
    mode: StorefrontMode;
    template: string;
    theme: string;
    bannerUrl: string;
    logoUrl: string;
    tagline: string;
    description: string;
    whatsapp: string;
    updatedAt: string;
  };
  products: Array<{
    id: string;
    itemNo: string;
    title: string;
    description: string;
    imageUrl: string;
    images: string[];
    category: string;
    unit: string;
    price: number | null;
    stock: number | null;
    featured: boolean;
    sortOrder: number;
    soldQty: number;
    createdAt: string;
  }>;
}

export interface ShippingOption {
  courierCode: string;
  serviceCode: string;
  courierName: string;
  serviceName: string;
  price: number;
  duration: string;
}

export interface StorefrontOrderResult {
  orderId: string;
  total: number;
  itemsSubtotal: number;
  shippingFee: number;
  paymentReady: boolean;
  qrUrl: string;
  expiresAt: string;
  fulfillment: "pickup" | "courier";
  items: Array<{ name: string; no: string; qty: number; price: number; subtotal: number }>;
  shipping: {
    courierName?: string;
    serviceName?: string;
    price?: number;
    duration?: string;
    destinationAddress?: string;
    destinationPostalCode?: string;
  } | null;
}

export interface PublicOrderStatus {
  orderId: string;
  status: "pending" | "paid" | "failed";
  total: number;
  itemsSubtotal: number;
  shippingFee: number;
  items: Array<{ name: string; qty: number; price: number; subtotal: number }>;
  fulfillment: "pickup" | "courier";
  shipping: { courierName?: string; serviceName?: string; price?: number; duration?: string } | null;
  qrUrl: string;
  expiresAt: string;
  createdAt: string;
  customerName: string;
}

let lastApiAt = Date.now();

/** Hindari PUT menumpang koneksi keep-alive yang sudah mati setelah idle. */
async function warmApi(force = false): Promise<void> {
  if (!force && Date.now() - lastApiAt < 15_000) return;
  try {
    await fetch(`/api/health?warm=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    /* tetap coba request utama */
  }
  lastApiAt = Date.now();
}

async function request<T>(
  path: string,
  init?: RequestInit,
  opts: { retry?: boolean; timeoutMs?: number } = {}
): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const retry = opts.retry ?? (method === "GET" || method === "PUT");
  const timeoutMs = opts.timeoutMs ?? 15_000;
  for (let attempt = 0; attempt < (retry ? 2 : 1); attempt++) {
    if (attempt === 0) await warmApi(false);
    else {
      await new Promise((r) => setTimeout(r, 500));
      await warmApi(true);
    }
    let res: Response;
    try {
      res = await fetch(path, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutMs) });
      lastApiAt = Date.now();
    } catch (e) {
      if (attempt === 0 && retry) continue;
      throw e;
    }
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok) throw new Error(j.message || j.error || "gagal");
    return j as T;
  }
  throw new Error("Gagal terhubung ke server.");
}

export const getStorefrontSettings = () => request<StorefrontSettings>("/api/storefront");

export const putStorefrontSettings = (
  body: Partial<
    Pick<StorefrontSettings, "slug" | "mode" | "template" | "theme" | "bannerUrl" | "logoUrl" | "tagline" | "description" | "whatsapp" | "active">
  >
) =>
  request<StorefrontSettings>(
    "/api/storefront",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { retry: true, timeoutMs: 12_000 }
  );

export const checkStorefrontSlug = (slug: string) =>
  request<{ slug: string; available: boolean; reason: string | null }>(
    `/api/storefront/slug?slug=${encodeURIComponent(slug)}`
  );

export const getStorefrontProducts = () =>
  request<{ products: StorefrontProductRow[]; syncedAt: string | null }>("/api/storefront/products");

export const syncStorefrontProducts = () =>
  request<{ ok: boolean; total: number; scanned: number; created: number; updated: number; priced: number; truncated: boolean; syncedAt: string }>(
    "/api/storefront/products/sync",
    { method: "POST", signal: AbortSignal.timeout(120_000) }
  );

export const updateStorefrontProduct = (
  id: string,
  body: Partial<
    Pick<StorefrontProductRow, "title" | "description" | "imageUrl" | "images" | "category" | "active" | "featured" | "sortOrder">
  >
) =>
  request<{ ok: boolean; product: StorefrontProductRow }>(
    `/api/storefront/products/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { retry: true, timeoutMs: 12_000 }
  );

export async function uploadStorefrontImage(file: File): Promise<string> {
  const res = await fetch("/api/storefront/upload", {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
  if (!res.ok || !j.url) throw new Error(j.message || j.error || "Gagal upload gambar.");
  return j.url;
}

export const getPublicStorefront = (slug: string) =>
  request<PublicStorefront>(`/api/public/storefront/${encodeURIComponent(slug)}`, {
    signal: AbortSignal.timeout(15_000),
  });

export const quoteStorefrontShipping = (slug: string, items: Array<{ id: string; qty: number }>, postalCode: string) =>
  request<{ options: ShippingOption[] }>(`/api/public/storefront/${encodeURIComponent(slug)}/shipping`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, postalCode }),
  });

export const createStorefrontOrder = (
  slug: string,
  body: {
    customerName: string;
    phone: string;
    note?: string;
    fulfillment: "pickup" | "courier";
    address?: string;
    postalCode?: string;
    courierCode?: string;
    serviceCode?: string;
    items: Array<{ id: string; qty: number }>;
  }
) =>
  request<StorefrontOrderResult>(`/api/public/storefront/${encodeURIComponent(slug)}/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

export const getStorefrontOrder = (slug: string, orderId: string) =>
  request<PublicOrderStatus>(
    `/api/public/storefront/${encodeURIComponent(slug)}/order/${encodeURIComponent(orderId)}`,
    { signal: AbortSignal.timeout(15_000) }
  );

export interface StorefrontTracking {
  orderId: string;
  status: "pending" | "paid" | "failed";
  waybillId: string;
  courier: string;
  shippingStatus: string;
  history: Array<{ note: string; status: string; updatedAt: string }>;
  updatedAt: string;
  createdAt: string;
  total: number;
}

export const trackStorefront = (slug: string, resi: string) =>
  request<StorefrontTracking>(
    `/api/public/storefront/${encodeURIComponent(slug)}/track?resi=${encodeURIComponent(resi)}`,
    { signal: AbortSignal.timeout(15_000) }
  );

export const aiStorefrontDescription = (
  id: string,
  body: { tone?: "menjual" | "informatif" | "ringkas"; keywords?: string }
) =>
  request<{ ok: boolean; description: string; model: string }>(
    `/api/storefront/products/${encodeURIComponent(id)}/ai-description`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { retry: false, timeoutMs: 60_000 }
  );

export const getStorefrontProduct = (id: string) =>
  request<{ product: StorefrontProductRow }>(`/api/storefront/products/${encodeURIComponent(id)}`);

export interface AiImageSuggestion {
  url: string;
  prompt: string;
  label: string;
}

/** Stream 3 gambar AI — hasil muncul satu per satu karena kuota image generator. */
export async function aiStorefrontImages(
  id: string,
  onImage: (image: AiImageSuggestion, index: number, watermark: string) => void
): Promise<{ images: AiImageSuggestion[]; watermark: string }> {
  const res = await fetch(`/api/storefront/products/${encodeURIComponent(id)}/ai-images`, {
    method: "POST",
    signal: AbortSignal.timeout(190_000),
  });
  if (!res.ok || !res.body) {
    let message = "Gagal membuat gambar AI.";
    try {
      const j = (await res.json()) as { message?: string; error?: string };
      message = j.message || j.error || message;
    } catch {
      /* abaikan */
    }
    throw new Error(message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let watermark = "";
  let images: AiImageSuggestion[] = [];
  let failed = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let e: {
        type?: string;
        watermark?: string;
        url?: string;
        prompt?: string;
        label?: string;
        index?: number;
        images?: AiImageSuggestion[];
        message?: string;
      };
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.type === "start" && e.watermark) watermark = e.watermark;
      if (e.type === "image" && e.url) {
        const image = { url: e.url, prompt: e.prompt ?? "", label: e.label ?? `Saran ${(e.index ?? 0) + 1}` };
        images.push(image);
        onImage(image, e.index ?? images.length - 1, watermark);
      }
      if (e.type === "done") {
        if (Array.isArray(e.images)) images = e.images;
        if (e.watermark) watermark = e.watermark;
      }
      if (e.type === "error") failed = e.message || "Gagal membuat gambar AI.";
    }
  }
  if (failed && images.length === 0) throw new Error(failed);
  return { images, watermark };
}

export interface BulkDescriptionResult {
  ok: boolean;
  scope: "empty" | "all";
  total: number;
  processed: number;
  updated: number;
  failed: number;
  nextCursor: string | null;
  done: boolean;
  results: Array<{ id: string; title: string; status: "ok" | "error"; message?: string }>;
}

export const aiStorefrontDescriptionBulk = (body: {
  scope: "empty" | "all";
  tone?: "menjual" | "informatif" | "ringkas";
  keywords?: string;
  after?: string | null;
  limit?: number;
}) =>
  request<BulkDescriptionResult>(
    "/api/storefront/products/ai-description-bulk",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { retry: false, timeoutMs: 180_000 }
  );
