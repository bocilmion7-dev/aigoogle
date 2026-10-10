import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { readFileSync } from "node:fs";

const keyOk = (process.env.GEMINI_API_KEY?.length ?? 0) > 10;
const api = createApp();
afterAll(() => import("../src/db.js").then((m) => m.prisma.$disconnect()));

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw last;
}

describe.skipIf(!keyOk)("audio Gemini asli", () => {
  it("POST /api/stt wav senyap → teks kosong (tidak mengarang)", async () => {
    const wav = readFileSync("/tmp/opencode/silence.wav");
    const res = await withRetry(() =>
      request(api).post("/api/stt").set("Content-Type", "audio/wav").send(wav).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
    );
    expect(res.status).toBe(200);
    const body = JSON.parse((res.body as Buffer).toString());
    expect(typeof body.text).toBe("string");
    expect(body.text.trim()).toBe("");
  }, 90000);

  it("POST /api/tts → audio/wav bytes", async () => {
    const res = await withRetry(() =>
      request(api).post("/api/tts").send({ text: "Halo, ini uji suara." }).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("audio/wav");
    expect((res.body as Buffer).length).toBeGreaterThan(1000);
  }, 90000);
});
