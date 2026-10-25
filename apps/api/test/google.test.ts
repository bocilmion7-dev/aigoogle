import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("google oauth skeleton", () => {
  it("GET /api/oauth/google/start tanpa login → 401 (wajib sesi)", async () => {
    const res = await request(createApp()).get("/api/oauth/google/start").redirects(0);
    expect(res.status).toBe(401);
  });
});
