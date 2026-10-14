import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";

const api = createApp();
// /api/tts wajib login (requireUser) — siapkan sesi sah utk tes
let authCookie = "";
beforeAll(async () => {
  const { prisma } = await import("../src/db.js");
  const t = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `aud-${randomBytes(3).toString("hex")}`, name: "PT Aud", alias: "AUD" },
  });
  const role = await prisma.role.create({ data: { tenantId: t.id, key: "admin", name: "Admin" } });
  const u = await prisma.user.create({
    data: { tenantId: t.id, providerUserId: `au-${randomBytes(3).toString("hex")}`, email: `aud-${randomBytes(3).toString("hex")}@demo.local`, name: "Aud", roleId: role.id },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: u.id, expiresAt: new Date(Date.now() + 3600_000) } });
  authCookie = `sid=${sid}`;
});
afterAll(() => import("../src/db.js").then((m) => m.prisma.$disconnect()));

describe("audio (TTS Edge)", () => {
  it("POST /api/tts tanpa sesi → 401", async () => {
    const res = await request(api).post("/api/tts").send({ text: "uji" });
    expect(res.status).toBe(401);
  });

  it("POST /api/tts teks kosong → 400", async () => {
    const res = await request(api).post("/api/tts").set("Cookie", authCookie).send({ text: "" });
    expect(res.status).toBe(400);
  });

  it("POST /api/tts (Edge) → audio/mpeg (skip bila IP server diblokir Microsoft)", async () => {
    const res = await request(api)
      .post("/api/tts")
      .set("Cookie", authCookie)
      .send({ text: "Halo, ini uji suara." })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    if (res.status === 502) {
      console.warn("Edge TTS diblokir dari IP server (403 Microsoft) — live test di-skip");
      return;
    }
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("audio/mpeg");
    expect((res.body as Buffer).length).toBeGreaterThan(1000);
  }, 60000);
});
