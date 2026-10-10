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
    name: "salesEntry.list",
    description: "Ambil daftar transaksi penjualan (faktur): pelanggan, tanggal, total",
    jsonSchema: { type: "object", properties: {} },
    requiredPermission: "accurate:sales-entry.view",
    label: "Mengambil data penjualan…",
  },
];
