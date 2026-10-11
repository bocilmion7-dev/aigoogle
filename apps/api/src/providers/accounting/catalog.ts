import type { ToolSpec } from "./types.js";

export const ACCURATE_CATALOG: ToolSpec[] = [
  {
    name: "customer.list",
    description: "Ambil daftar pelanggan (nama, id)",
    jsonSchema: { type: "object", properties: {} },
    requiredPermission: "accurate:customer.view",
    label: "Mengambil data pelanggan…",
  },
  {
    name: "salesInvoice.list",
    description: "Ambil daftar faktur penjualan: nomor, pelanggan, tanggal, total, status",
    jsonSchema: { type: "object", properties: {} },
    requiredPermission: "accurate:sales-invoice.view",
    label: "Mengambil data faktur penjualan…",
  },
];
