import { makeListRouter } from "./list-factory.js";

export const customerRouter = makeListRouter({
  module: "customer",
  rows: (db) => db.data.customers,
  fieldsForDetail: ["id", "name"],
});
