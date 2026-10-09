import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";

describe("mock accurate app", () => {
  it("GET /health → 200 { ok: true }", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
