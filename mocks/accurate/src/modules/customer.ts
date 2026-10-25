import { makeListRouter } from "./list-factory.js";

export const customerRouter = makeListRouter({
  module: "customer",
  rows: (db) => db.data.customer,
  fieldsForDetail: ["id", "name"],
  addable: true,
});
