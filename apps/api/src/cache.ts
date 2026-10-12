/** Cache layer (memory, TTL bersama). Dipakai endpoint data Accurate; webhook meng-invalidate pattern.
 * Redis dapat ditambahkan nanti (env REDIS_URL) tanpa mengubah pemanggil. */

const globalStore = new Map<string, { value: unknown; expiresAt: number }>();

export const cache = {
  get<T>(key: string): T | null {
    const item = globalStore.get(key);
    if (!item || item.expiresAt < Date.now()) {
      globalStore.delete(key);
      return null;
    }
    return item.value as T;
  },
  set(key: string, value: unknown, ttlSec = 60): void {
    globalStore.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  },
  delete(key: string): void {
    globalStore.delete(key);
  },
  /** hapus semua key yang diawali prefix (atau semua bila tanpa prefix) */
  clear(prefix?: string): void {
    if (!prefix) {
      globalStore.clear();
      return;
    }
    for (const k of globalStore.keys()) {
      if (k.startsWith(prefix)) globalStore.delete(k);
    }
  },
};

/** TTL default cache data Accurate (detik) — data segar maksimal 1 menit tanpa webhook */
export const CACHE_TTL = 60;

/** hapus semua key cache milik tenant yang cocok pattern (dipanggil saat webhook masuk) */
export function invalidateTenantCache(tenantId: string, prefix: string): void {
  cache.clear(`${tenantId}:${prefix}`);
}

/** peta event Accurate → prefix key cache yang harus dibuang saat event masuk.
 * Konvensi key: {tenantId}:{prefix}... — prefix modul mengikuti slug path API Accurate. */
export const EVENT_TO_CACHE_PREFIX: Record<string, string> = {
  CUSTOMER: "accurate:customer",
  VENDOR: "accurate:vendor",
  ITEM: "accurate:item",
  UNIT: "accurate:unit",
  WAREHOUSE: "accurate:warehouse",
  SALES_INVOICE: "accurate:sales-invoice",
  SALES_ORDER: "accurate:sales-order",
  SALES_QUOTATION: "accurate:sales-quotation",
  SALES_RECEIPT: "accurate:sales-receipt",
  SALES_RETURN: "accurate:sales-return",
  PURCHASE_INVOICE: "accurate:purchase-invoice",
  PURCHASE_ORDER: "accurate:purchase-order",
  PURCHASE_RETURN: "accurate:purchase-return",
  PURCHASE_PAYMENT: "accurate:purchase-payment",
  JOURNAL_VOUCHER: "accurate:journal-voucher",
  GLACCOUNT: "accurate:glaccount",
  TAX: "accurate:tax",
  CURRENCY: "accurate:currency",
  CUSTOMER_CATEGORY: "accurate:customer-category",
  VENDOR_CATEGORY: "accurate:vendor-category",
  ITEM_CATEGORY: "accurate:item-category",
  PAYMENT_TERM: "accurate:payment-term",
  DEPARTMENT: "accurate:department",
  PROJECT: "accurate:project",
  EMPLOYEE: "accurate:employee",
  BRANCH: "accurate:branch",
  DELIVERY_ORDER: "accurate:delivery-order",
  RECEIVE_ITEM: "accurate:receive-item",
  ITEM_ADJUSTMENT: "accurate:item-adjustment",
  ITEM_TRANSFER: "accurate:item-transfer",
  FIXED_ASSET: "accurate:fixed-asset",
};
