import type { ToolSpec } from "./types.js";

const listProps = {
  fields: { type: "string", description: "Field yang ditampilkan, dipisah koma (contoh: id,name)" },
  keywords: { type: "string", description: "Kata kunci pencarian" },
  page: { type: "number", description: "Nomor halaman (default 1)" },
  pageSize: { type: "number", description: "Ukuran halaman (default 20)" },
  sort: { type: "string", description: 'Urutan "field|asc;field2|desc"' },
  filter: {
    type: "object",
    description: 'Filter per field: { "<field>": { "op": "EQUAL|CONTAIN|…", "value": … } }',
    additionalProperties: true,
  },
} as const;

const listTool = (
  name: string,
  description: string,
  requiredPermission: string,
  label: string
): ToolSpec => ({
  name,
  description,
  jsonSchema: { type: "object", properties: listProps },
  requiredPermission,
  label,
});

export const ACCURATE_CATALOG: ToolSpec[] = [
  listTool("customer.list", "Daftar pelanggan (id, name)", "accurate:customer.view", "Mengambil data pelanggan…"),
  {
    name: "customer.detail",
    description: "Detail satu pelanggan berdasarkan id",
    jsonSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    requiredPermission: "accurate:customer.view",
    label: "Mengambil detail pelanggan…",
  },
  listTool("salesInvoice.list", "Daftar faktur penjualan (no, customerName, date, total, status)", "accurate:sales-invoice.view", "Mengambil data faktur penjualan…"),
  {
    name: "salesInvoice.detail",
    description: "Detail satu faktur penjualan berdasarkan id",
    jsonSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    requiredPermission: "accurate:sales-invoice.view",
    label: "Mengambil detail faktur penjualan…",
  },
  listTool("salesOrder.list", "Daftar pesanan penjualan (SO)", "accurate:sales-order.view", "Mengambil data pesanan jual…"),
  listTool("item.list", "Daftar item/barang (code, name, sellingPrice)", "accurate:item.view", "Mengambil data item…"),
  listTool("vendor.list", "Daftar vendor/supplier", "accurate:vendor.view", "Mengambil data vendor…"),
  listTool("glAccount.list", "Daftar akun COA (code, name, type)", "accurate:glaccount.view", "Mengambil data akun…"),
  listTool("purchaseInvoice.list", "Daftar faktur pembelian", "accurate:purchase-invoice.view", "Mengambil data faktur beli…"),
  listTool("salesReceipt.list", "Daftar penerimaan kas/penjualan", "accurate:sales-receipt.view", "Mengambil data penerimaan…"),
];
