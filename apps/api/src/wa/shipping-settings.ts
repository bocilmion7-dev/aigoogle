import { prisma } from "../db.js";
import type { ShippingOrigin } from "../shipping/biteship.js";

const keyOf = (tenantId: string) => `wa:shipping_origin:${tenantId}`;

export const DEFAULT_ORIGIN: ShippingOrigin = {
  contactName: "",
  phone: "",
  email: "",
  organization: "",
  address: "",
  postalCode: "",
  note: "",
};

/** Alamat gudang/toko asal pengiriman untuk satu perusahaan. */
export async function getShippingOrigin(tenantId: string): Promise<ShippingOrigin> {
  const row = await prisma.appSetting.findUnique({ where: { key: keyOf(tenantId) } });
  if (!row) return { ...DEFAULT_ORIGIN };
  try {
    const v = JSON.parse(row.value) as Partial<ShippingOrigin>;
    return {
      contactName: String(v.contactName ?? "").slice(0, 100),
      phone: String(v.phone ?? "").slice(0, 32),
      email: String(v.email ?? "").slice(0, 120),
      organization: String(v.organization ?? "").slice(0, 120),
      address: String(v.address ?? "").slice(0, 300),
      postalCode: String(v.postalCode ?? "").replace(/\D/g, "").slice(0, 5),
      note: String(v.note ?? "").slice(0, 200),
    };
  } catch {
    return { ...DEFAULT_ORIGIN };
  }
}

export async function setShippingOrigin(tenantId: string, origin: Partial<ShippingOrigin>): Promise<ShippingOrigin> {
  const next: ShippingOrigin = {
    contactName: String(origin.contactName ?? "").slice(0, 100),
    phone: String(origin.phone ?? "").replace(/[^\d+]/g, "").slice(0, 32),
    email: String(origin.email ?? "").slice(0, 120),
    organization: String(origin.organization ?? "").slice(0, 120),
    address: String(origin.address ?? "").slice(0, 300),
    postalCode: String(origin.postalCode ?? "").replace(/\D/g, "").slice(0, 5),
    note: String(origin.note ?? "").slice(0, 200),
  };
  await prisma.appSetting.upsert({
    where: { key: keyOf(tenantId) },
    create: { key: keyOf(tenantId), value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  return next;
}

/** Berat default per unit barang (gram) — dipakai bila berat Accurate tak terbaca. */
export async function getDefaultWeightGram(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: "wa:shipping_weight_gram" } });
  const n = Number(row?.value ?? 500);
  return Number.isFinite(n) && n > 0 ? Math.min(50_000, Math.round(n)) : 500;
}
