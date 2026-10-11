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
    expect(res.body.d[0].total).toBe(2500000);
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
});
