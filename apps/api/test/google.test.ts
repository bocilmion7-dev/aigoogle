import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("google oauth skeleton", () => {
  it("GET /api/oauth/google/start tanpa GOOGLE_OAUTH_CLIENT_SECRET → 501 dengan pesan jelas", async () => {
    const res = await request(createApp()).get("/api/oauth/google/start").redirects(0);
    if (!process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
      expect(res.status).toBe(501);
      expect(res.body.error).toMatch(/secret/i);
    } else {
      expect(res.status).toBe(302);
    }
  });
});
