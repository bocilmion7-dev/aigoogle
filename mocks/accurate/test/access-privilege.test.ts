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

describe("access-privilege (bentuk real)", () => {
  it("list.do → d array grup privilege + sp", async () => {
    const { sid, bearer } = await session("1001");
    const res = await request(app).get("/accurate/api/access-privilege/list.do")
      .set("Authorization", bearer).set("X-Session-ID", sid);
    expect(res.body.s).toBe(true);
    expect(res.body.d.map((r: { id: string }) => r.id)).toEqual(["priv-admin", "priv-staff"]);
    expect(res.body.sp.rowCount).toBe(2);
  });

  it("detail.do admin → d[0].Privilege semua AllowView true", async () => {
    const { sid, bearer } = await session("1001");
    const res = await request(app).get("/accurate/api/access-privilege/detail.do?id=priv-admin")
      .set("Authorization", bearer).set("X-Session-ID", sid);
    expect(res.body.s).toBe(true);
    expect(res.body.d[0]).toMatchObject({ id: "priv-admin", name: "Administrator" });
    const rows = res.body.d[0].Privilege as { AllowView: boolean }[];
    expect(rows.every((r) => r.AllowView)).toBe(true);
  });

  it("detail.do staff → sales-invoice true, glaccount false", async () => {
    const { sid, bearer } = await session("1001");
    const res = await request(app).get("/accurate/api/access-privilege/detail.do?id=priv-staff")
      .set("Authorization", bearer).set("X-Session-ID", sid);
    const byMod = Object.fromEntries(
      (res.body.d[0].Privilege as { ModuleName: string; AllowView: boolean }[]).map((r) => [r.ModuleName, r.AllowView])
    );
    expect(byMod["sales-invoice"]).toBe(true);
    expect(byMod["glaccount"]).toBe(false);
  });

  it("detail.do id ngawur → s false", async () => {
    const { sid, bearer } = await session("1001");
    const res = await request(app).get("/accurate/api/access-privilege/detail.do?id=xxx")
      .set("Authorization", bearer).set("X-Session-ID", sid);
    expect(res.body.s).toBe(false);
  });
});
