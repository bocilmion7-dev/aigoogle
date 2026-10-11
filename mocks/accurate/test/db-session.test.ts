import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { issueAccess } from "../src/store.js";

const app = createApp();
const bearer = () => `Bearer ${issueAccess("user-admin")}`;
const bearerStaff = () => `Bearer ${issueAccess("user-staff")}`;

describe("db-list, open-db, session (bentuk real)", () => {
  it("db-list tanpa Bearer → 401; dengan Bearer → s true, d array 2 db, sp pagination", async () => {
    expect((await request(app).get("/api/db-list.do")).status).toBe(401);
    const res = await request(app).get("/api/db-list.do").set("Authorization", bearer());
    expect(res.status).toBe(200);
    expect(res.body.s).toBe(true);
    expect(res.body.d.map((r: { id: number }) => r.id)).toEqual([1001, 1002]);
    expect(res.body.d[0]).toMatchObject({ alias: "MAJU", admin: true, dataAccessType: "ADMIN", trial: false, expired: false });
    expect(res.body.sp).toMatchObject({ page: 1, rowCount: 2 });
  });

  it("db-list staff → db 1001 admin false", async () => {
    const res = await request(app).get("/api/db-list.do").set("Authorization", bearerStaff());
    const db1001 = res.body.d.find((r: { id: number }) => r.id === 1001);
    expect(db1001.admin).toBe(false);
  });

  it("open-db?id= valid → session & host top level", async () => {
    const res = await request(app).get("/api/open-db.do?id=1001").set("Authorization", bearer());
    expect(res.status).toBe(200);
    expect(res.body.s).toBe(true);
    expect(res.body.d).toEqual(["Proses Berhasil Dilakukan"]);
    expect(res.body.session).toMatch(/^sess-/);
    expect(res.body.host).toMatch(/^http/);
    expect(res.body.admin).toBe(true);
  });

  it("open-db?id= asing → s false", async () => {
    const res = await request(app).get("/api/open-db.do?id=9999").set("Authorization", bearer());
    expect(res.status).toBe(200);
    expect(res.body.s).toBe(false);
  });

  it("modul butuh Bearer + X-Session-ID; session harus milik token yang sama", async () => {
    const tanpaAuth = await request(app).get("/accurate/api/customer/list.do");
    expect(tanpaAuth.status).toBe(401);
    const { body: open } = await request(app).get("/api/open-db.do?id=1001").set("Authorization", bearer());
    const okRes = await request(app).get("/accurate/api/customer/list.do")
      .set("Authorization", bearer()).set("X-Session-ID", open.session);
    expect(okRes.status).toBe(200);
    expect(okRes.body.s).toBe(true);
    const mismatch = await request(app).get("/accurate/api/customer/list.do")
      .set("Authorization", bearerStaff()).set("X-Session-ID", open.session);
    expect(mismatch.status).toBe(401);
  });
});
