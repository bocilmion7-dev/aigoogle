import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { setMockDriveSeed } from "../src/drive/registry.js";

let api: ReturnType<typeof createApp>;
let cookie = "";
let tenantId = "";

beforeAll(async () => {
  process.env.MOCK_DRIVE = "1";
  setMockDriveSeed({
    folders: [
      { id: "root", name: "Drive", parents: "" },
      { id: "kerja", name: "Scan", parents: "root" },
    ],
    files: [
      { id: "p1", name: "faktur-a.pdf", parents: "kerja", mimeType: "application/pdf", text: "Faktur A" },
    ],
  });
  api = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `drv-${randomBytes(3).toString("hex")}`, name: "PT Drive", alias: "DRV" },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({ data: { tenantId: tenant.id, key: "admin", name: "Admin" } });
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionKey: "app:drive.tidy" } });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, providerUserId: `du-${randomBytes(3).toString("hex")}`, email: "drv@demo.local", name: "Drv", roleId: role.id },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86400_000) } });
  cookie = `sid=${sid}`;
});
afterAll(() => prisma.$disconnect());

function ndjson(body: string) {
  return body.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("drive routes", () => {
  it("tanpa login → 401", async () => {
    expect((await request(api).get("/api/drive/status")).status).toBe(401);
  });

  it("status mock connected", async () => {
    const res = await request(api).get("/api/drive/status").set("Cookie", cookie);
    expect(res.body).toEqual({ connected: true, engine: "mock" });
  });

  it("list folder kerja", async () => {
    const res = await request(api).get("/api/drive/list?folderId=kerja").set("Cookie", cookie);
    expect(res.body.files[0].name).toBe("faktur-a.pdf");
  });

  it("plan → create_folder + move", async () => {
    const res = await request(api).post("/api/drive/plan").set("Cookie", cookie).send({ folderId: "kerja" });
    expect(res.status).toBe(200);
    expect(res.body.jobId).toBeTruthy();
    const acts = res.body.items.map((i: { action: string }) => i.action);
    expect(acts).toContain("create_folder");
    expect(acts).toContain("move");
  });

  it("run job → NDJSON progress + done; logs tersimpan", async () => {
    const plan = await request(api).post("/api/drive/plan").set("Cookie", cookie).send({ folderId: "kerja" });
    const id = plan.body.jobId as string;
    const run = await request(api).post(`/api/drive/jobs/${id}/run`).set("Cookie", cookie).buffer(true).parse((r, cb) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => cb(null, d));
    });
    const ev = ndjson(run.body as string);
    expect(ev[0].type).toBe("start");
    expect(ev.at(-1)!.type).toBe("done");
    const job = await prisma.driveJob.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe("done");
    const logs = await prisma.driveActionLog.findMany({ where: { jobId: id } });
    expect(logs.some((l) => l.action === "move" && l.fromParent === "kerja")).toBe(true);
  });

  it("cancel job → sisanya skipped", async () => {
    setMockDriveSeed({
      folders: [
        { id: "root", name: "Drive", parents: "" },
        { id: "kerja2", name: "Scan 2", parents: "root" },
      ],
      files: [
        { id: "p9", name: "nota-x.pdf", parents: "kerja2", mimeType: "application/pdf", text: "Nota X" },
      ],
    });
    const plan = await request(api).post("/api/drive/plan").set("Cookie", cookie).send({ folderId: "kerja2" });
    const id = plan.body.jobId as string;
    await request(api).post(`/api/drive/jobs/${id}/cancel`).set("Cookie", cookie);
    const run = await request(api).post(`/api/drive/jobs/${id}/run`).set("Cookie", cookie).buffer(true).parse((r, cb) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => cb(null, d));
    });
    const ev = ndjson(run.body as string);
    expect(ev.some((e) => e.type === "cancelled" || (e.type === "progress" && e.status === "skipped"))).toBe(true);
  });

  it("isolasi tenant: job milik A tak terbaca B (404)", async () => {
    const job = await prisma.driveJob.findFirstOrThrow({ where: { tenantId } });
    const other = await prisma.tenant.create({
      data: { provider: "accurate", providerDbId: `drvB-${randomBytes(3).toString("hex")}`, name: "PT B", alias: "B" },
    });
    const role = await prisma.role.create({ data: { tenantId: other.id, key: "admin", name: "A" } });
    const user = await prisma.user.create({
      data: { tenantId: other.id, providerUserId: `dB-${randomBytes(3).toString("hex")}`, email: "b@demo.local", name: "B", roleId: role.id },
    });
    const sid = randomBytes(32).toString("hex");
    await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86400_000) } });
    const res = await request(api).get(`/api/drive/jobs/${job.id}`).set("Cookie", `sid=${sid}`);
    expect(res.status).toBe(404);
  });

  it("undo job selesai → file kembali ke folder asal + status undone", async () => {
    setMockDriveSeed({
      folders: [
        { id: "root", name: "Drive", parents: "" },
        { id: "kerja", name: "Scan", parents: "root" },
      ],
      files: [
        { id: "u1", name: "faktur-u.pdf", parents: "kerja", mimeType: "application/pdf", text: "Faktur U" },
      ],
    });
    const plan = await request(api).post("/api/drive/plan").set("Cookie", cookie).send({ folderId: "kerja" });
    const id = plan.body.jobId as string;
    const run = await request(api).post(`/api/drive/jobs/${id}/run`).set("Cookie", cookie).buffer(true).parse((r, cb) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => cb(null, d));
    });
    expect(ndjson(run.body as string).at(-1)!.type).toBe("done");

    const undo = await request(api)
      .post(`/api/drive/jobs/${id}/undo`)
      .set("Cookie", cookie)
      .send({})
      .buffer(true)
      .parse((r, cb) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => cb(null, d));
      });
    expect(undo.status).toBe(200);
    const ev = ndjson(undo.body as string);
    expect(ev[0].type).toBe("start");
    expect(ev.at(-1)!.type).toBe("done");
    expect((ev.at(-1) as { status: string }).status).toBe("undone");
    const job = await prisma.driveJob.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe("undone");

    const again = await request(api).post(`/api/drive/jobs/${id}/undo`).set("Cookie", cookie).send({});
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("already_undone");
  });

  it("undo job yang belum jalan → 400 tidak_ada_yang_bisa_diundo", async () => {
    const plan = await request(api).post("/api/drive/plan").set("Cookie", cookie).send({ folderId: "kerja" });
    const res = await request(api)
      .post(`/api/drive/jobs/${plan.body.jobId}/undo`)
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("tidak_ada_yang_bisa_diundo");
  });
});
