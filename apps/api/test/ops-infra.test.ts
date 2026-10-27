import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { rateLimit } from "../src/middleware/rate-limit.js";
import { metricsSnapshot, recordRequest, resetMetrics } from "../src/metrics.js";
import { recordLlmUsage, usageToday, dailyLimit } from "../src/ai/usage.js";
import { prisma } from "../src/db.js";

const TENANT = "tenant-uji-ops";

describe("rate limit", () => {
  it("melewati batas → 429 + Retry-After", async () => {
    const app = express();
    const bucket = `uji-${Date.now()}`;
    app.get("/x", rateLimit({ name: bucket, windowMs: 60_000, max: 2 }), (_req, res) => res.json({ ok: true }));
    const a = await request(app).get("/x");
    const b = await request(app).get("/x");
    const c = await request(app).get("/x");
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(c.status).toBe(429);
    expect(c.body.error).toBe("terlalu_banyak_permintaan");
    expect(c.headers["retry-after"]).toBeTruthy();
  });
});

describe("metrik", () => {
  it("recordRequest → snapshot memuat rute, latensi, error", () => {
    resetMetrics();
    recordRequest("GET", "/api/uji/123", 200, 12);
    recordRequest("GET", "/api/uji/456", 500, 30);
    const snap = metricsSnapshot() as { routes: Array<{ route: string; count: number; errors: number; maxMs: number }> };
    const r = snap.routes.find((x) => x.route === "GET /api/uji/:n")!;
    expect(r.count).toBe(2);
    expect(r.errors).toBe(1);
    expect(r.maxMs).toBe(30);
  });
});

describe("pemakaian LLM", () => {
  it("mencatat & menjumlah token hari ini", async () => {
    await prisma.llmUsage.deleteMany({ where: { tenantId: TENANT } });
    await recordLlmUsage({ tenantId: TENANT, kind: "chat", model: "uji", promptChars: 400, completionChars: 200 });
    await recordLlmUsage({ tenantId: TENANT, kind: "router", model: "uji", promptChars: 400, completionChars: 0 });
    const u = await usageToday(TENANT);
    expect(u.calls).toBe(2);
    expect(u.tokens).toBe(250); // 100+50 (chat) + 100+0 (router)
    await prisma.llmUsage.deleteMany({ where: { tenantId: TENANT } });
  });

  it("kuota: per tenant menimpa global, 0 = tanpa batas", async () => {
    await prisma.appSetting.upsert({
      where: { key: "llm:daily_token_limit" },
      create: { key: "llm:daily_token_limit", value: "1000" },
      update: { value: "1000" },
    });
    expect(await dailyLimit(TENANT)).toBe(1000);
    await prisma.appSetting.upsert({
      where: { key: `llm:daily_token_limit:${TENANT}` },
      create: { key: `llm:daily_token_limit:${TENANT}`, value: "50" },
      update: { value: "50" },
    });
    expect(await dailyLimit(TENANT)).toBe(50);
    await prisma.appSetting.deleteMany({ where: { key: { in: ["llm:daily_token_limit", `llm:daily_token_limit:${TENANT}`] } } });
    expect(await dailyLimit(TENANT)).toBe(0);
  });
});

describe("health endpoint", () => {
  it("shallow & deep (struktur cek)", async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const shallow = await request(app).get("/api/health");
    expect(shallow.status).toBe(200);
    expect(shallow.body.ok).toBe(true);
    const deep = await request(app).get("/api/health?deep=1");
    expect(deep.body.checks).toHaveProperty("db");
    expect(deep.body.checks).toHaveProperty("ai");
    expect(deep.body.checks).toHaveProperty("google");
    expect(deep.body.checks).toHaveProperty("accurate");
    expect(deep.body.checks.db.ok).toBe(true);
  });
});
