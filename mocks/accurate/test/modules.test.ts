import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { issueAccess } from "../src/store.js";

const app = createApp();

async function session(dbId: string, userId = "user-admin") {
  const res = await request(app).get(`/api/open-db.do?id=${dbId}`)
    .set("Authorization", `Bearer ${issueAccess(userId)}`);
  return { sid: res.body.session as string, bearer: `Bearer ${issueAccess(userId)}` };
}

describe("modul read + isolasi tenant (bentuk real)", () => {
  it("isolasi: customer db 1001 ≠ db 1002", async () => {
    const a = await session("1001");
    const b = await session("1002");
    const r1 = await request(app).get("/accurate/api/customer/list.do")
      .set("Authorization", a.bearer).set("X-Session-ID", a.sid);
    const r2 = await request(app).get("/accurate/api/customer/list.do")
      .set("Authorization", b.bearer).set("X-Session-ID", b.sid);
    expect(r1.body.s).toBe(true);
    expect(r1.body.d[0].name).toBe("Budi Santoso");
    expect(r2.body.d[0].name).toBe("Toko Bersama");
    expect(r1.body.sp.rowCount).toBe(2);
  });

  it("staff db 1001: sales-invoice boleh", async () => {
    const { sid, bearer } = await session("1001", "user-staff");
    const res = await request(app).get("/accurate/api/sales-invoice/list.do")
      .set("Authorization", bearer).set("X-Session-ID", sid);
    expect(res.body.s).toBe(true);
    expect(res.body.d[0].totalAmount).toBe(2500000);
  });

  it("staff db 1001: customer ditolak (s false + pesan)", async () => {
    const { sid, bearer } = await session("1001", "user-staff");
    const res = await request(app).get("/accurate/api/customer/list.do")
      .set("Authorization", bearer).set("X-Session-ID", sid);
    expect(res.status).toBe(200);
    expect(res.body.s).toBe(false);
    expect(res.body.d[0]).toMatch(/tidak punya akses modul customer/i);
  });

  it("user tanpa privilege di db → semua modul ditolak", async () => {
    const { sid, bearer } = await session("1002", "user-staff");
    const res = await request(app).get("/accurate/api/customer/list.do")
      .set("Authorization", bearer).set("X-Session-ID", sid);
    expect(res.body.s).toBe(false);
  });

  it("admin: item/list.do & glaccount/list.do OK; staff ditolak item", async () => {
    const a = await session("1001");
    const item = await request(app).get("/accurate/api/item/list.do")
      .set("Authorization", a.bearer).set("X-Session-ID", a.sid);
    expect(item.body.s).toBe(true);
    expect(item.body.d.length).toBeGreaterThan(0);
    const s = await session("1001", "user-staff");
    const itemStaff = await request(app).get("/accurate/api/item/list.do")
      .set("Authorization", s.bearer).set("X-Session-ID", s.sid);
    expect(itemStaff.body.s).toBe(false);
  });

  it("fields & keywords & sp.page bekerja di item/list.do", async () => {
    const a = await session("1001");
    const res = await request(app)
      .get("/accurate/api/item/list.do?fields=no,name&keywords=A4&sp.page=1&sp.pageSize=1")
      .set("Authorization", a.bearer).set("X-Session-ID", a.sid);
    expect(res.body.d).toEqual([{ no: "BRG-001", name: "Kertas A4" }]);
    expect(res.body.sp).toMatchObject({ page: 1, pageSize: 1, rowCount: 1 });
  });

  it("detail.do customer & sales-invoice; id salah → s false", async () => {
    const a = await session("1001");
    const cust = await request(app).get("/accurate/api/customer/detail.do?id=C-001")
      .set("Authorization", a.bearer).set("X-Session-ID", a.sid);
    expect(cust.body.s).toBe(true);
    expect(cust.body.d[0].name).toBe("Budi Santoso");
    const si = await request(app).get("/accurate/api/sales-invoice/detail.do?id=SI-001")
      .set("Authorization", a.bearer).set("X-Session-ID", a.sid);
    expect(si.body.s).toBe(true);
    expect(si.body.d[0].number).toBe("SI.2026.10.00001");
    const bad = await request(app).get("/accurate/api/customer/detail.do?id=XXX")
      .set("Authorization", a.bearer).set("X-Session-ID", a.sid);
    expect(bad.body.s).toBe(false);
  });
});
