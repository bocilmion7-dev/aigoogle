import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";

const app = createApp();

// helper: buat platform session langsung di DB (pola test settings/customers: upsert PlatformUser + PlatformSession id acak)
async function platformCookie(): Promise<string> {
  const u = await prisma.platformUser.upsert({
    where: { email: "uji-ai@example.com" },
    create: { email: "uji-ai@example.com", name: "Uji AI" },
    update: {},
  });
  const psid = randomBytes(32).toString("hex");
  await prisma.platformSession.create({
    data: { id: psid, platformUserId: u.id, expiresAt: new Date(Date.now() + 86400_000) },
  });
  return `psid=${psid}`;
}

beforeEach(async () => {
  await prisma.aiProviderModel.deleteMany({});
  await prisma.aiProvider.deleteMany({});
});
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(async () => {
  await prisma.aiProviderModel.deleteMany({});
  await prisma.aiProvider.deleteMany({});
  await prisma.$disconnect();
});

describe("API kelola provider AI", () => {
  it("tanpa sesi platform → 401", async () => {
    const res = await request(app).get("/api/ai/providers");
    expect(res.status).toBe(401);
  });

  it("create → list (key masked) → activate hanya 1 aktif", async () => {
    const cookie = await platformCookie();
    const a = await request(app).post("/api/ai/providers").set("Cookie", cookie).send({
      name: "A", baseUrl: "https://a.example/v1", apiKey: "key-AAAA", models: ["m1", "m2"],
    });
    expect(a.status).toBe(201);
    const b = await request(app).post("/api/ai/providers").set("Cookie", cookie).send({
      name: "B", baseUrl: "https://b.example/v1", apiKey: "key-BBBB", models: ["n1"],
    });
    expect(b.status).toBe(201);
    await request(app).post(`/api/ai/providers/${b.body.id}/activate`).set("Cookie", cookie).send({});
    const list = await request(app).get("/api/ai/providers").set("Cookie", cookie);
    expect(list.status).toBe(200);
    const actives = list.body.filter((p: { isActive: boolean }) => p.isActive);
    expect(actives).toHaveLength(1);
    expect(actives[0].name).toBe("B");
    expect(list.body[0].apiKeyMasked).toBe("••••AAAA");
    expect(list.body[0].models.map((m: { name: string }) => m.name)).toEqual(["m1", "m2"]);
  });

  it("preview-models non-2xx upstream → error status", async () => {
    const cookie = await platformCookie();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const res = await request(app)
      .post("/api/ai/providers/preview-models")
      .set("Cookie", cookie)
      .send({ baseUrl: "https://x.example/v1", apiKey: "k" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(String(res.body.error ?? "")).toContain("gagal memuat model");
  });

  it("PUT models mengganti seluruh checklist", async () => {
    const cookie = await platformCookie();
    const a = await request(app).post("/api/ai/providers").set("Cookie", cookie).send({
      name: "A", baseUrl: "https://a.example/v1", apiKey: "key", models: ["m1", "m2", "m3"],
    });
    await request(app).put(`/api/ai/providers/${a.body.id}`).set("Cookie", cookie).send({ models: ["m2", "m9"] });
    const list = await request(app).get("/api/ai/providers").set("Cookie", cookie);
    expect(list.body[0].models.map((m: { name: string }) => m.name)).toEqual(["m2", "m9"]);
    expect(list.body[0].models.map((m: { rank: number }) => m.rank)).toEqual([0, 1]);
  });
});
