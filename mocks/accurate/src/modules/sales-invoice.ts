import { makeListRouter } from "./list-factory.js";

export const salesInvoiceRouter = makeListRouter({
  module: "sales-invoice",
  rows: (db) => db.data["sales-invoice"],
  fieldsForDetail: ["id", "number", "transDate", "dueDate", "totalAmount", "approvalStatus", "customerNo", "customer", "description"],
  addable: true,
});
