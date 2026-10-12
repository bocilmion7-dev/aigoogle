import { makeListRouter } from "./list-factory.js";

export const salesInvoiceRouter = makeListRouter({
  module: "sales-invoice",
  rows: (db) => db.data.salesInvoices,
  fieldsForDetail: ["id", "no", "customerName", "date", "total", "status"],
  addable: true,
});
