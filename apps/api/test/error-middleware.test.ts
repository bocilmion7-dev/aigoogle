import { describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import { createApp } from "../src/app.js";
import { asyncHandler } from "../src/asyncHandler.js";

describe("error middleware", () => {
  it("JSON rusak → 400 bad_request (bukan 500)", async () => {
    const res = await request(createApp())
      .post("/api/health")
      .set("Content-Type", "application/json")
      .send("{rusak");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "bad_request" });
  });

  it("async route yang reject → 500 internal (pakai asyncHandler)", async () => {
    const app = express();
    app.get(
      "/api/_boom",
      asyncHandler(async () => {
        throw new Error("boom");
      })
    );
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: "internal" });
    });
    const res = await request(app).get("/api/_boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal" });
  });
});
