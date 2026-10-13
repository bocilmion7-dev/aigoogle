import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { readFileSync } from "node:fs";
import { GeminiHttpError } from "../src/ai/gemini-client.js";

const keyOk = (process.env.GEMINI_API_KEY?.length ?? 0) > 10;
const api = createApp();
// /stt & /tts kini wajib login (requireUser) — siapkan sesi sah utk tes
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

function isQuota(e: unknown): boolean {
  if (!(e instanceof GeminiHttpError)) return false;
  //429 quota habis ATAU402/RESOURCE_EXHAUSTED (prepayment Gemini habis) → test live di-skip
  return (
    (e.status === 429 && /quota/i.test(e.message)) ||
    (e.status === 402 && /RESOURCE_EXHAUSTED|prepayment|depleted/i.test(e.message))
  );
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (isQuota(e)) throw e;
      last = e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw last;
}

function skipQuota(e: unknown): boolean {
  if (isQuota(e)) {
    console.warn("Gemini free-tier quota habis — audio live test di-skip");
    return true;
  }
  return false;
}

/** true bila respons live Gemini menandakan kuota/billing habis (429/402) → test di-skip */
function skipIfLiveUnavailable(res: { status: number }): boolean {
  if (res.status === 429 || res.status === 402) {
    console.warn(`Gemini live tidak tersedia (HTTP ${res.status}) — audio live test di-skip`);
    return true;
  }
  return false;
}

describe.skipIf(!keyOk)("audio Gemini asli", () => {
  it("POST /api/stt wav senyap → teks kosong (tidak mengarang)", async () => {
    try {
      const wav = readFileSync("/tmp/opencode/silence.wav");
      const res = await withRetry(() =>
        request(api).post("/api/stt").set("Cookie", authCookie).set("Content-Type", "audio/wav").send(wav).buffer(true).parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        })
      );
      if (skipIfLiveUnavailable(res)) return;
      expect(res.status).toBe(200);
      const body = JSON.parse((res.body as Buffer).toString());
      expect(typeof body.text).toBe("string");
      expect(body.text.trim()).toBe("");
    } catch (e) {
      if (skipQuota(e)) return;
      throw e;
    }
  }, 90000);

  it("POST /api/tts → audio/wav bytes", async () => {
    try {
      const res = await withRetry(() =>
        request(api).post("/api/tts").set("Cookie", authCookie).send({ text: "Halo, ini uji suara." }).buffer(true).parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        })
      );
      if (skipIfLiveUnavailable(res)) return;
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("audio/wav");
      expect((res.body as Buffer).length).toBeGreaterThan(1000);
    } catch (e) {
      if (skipQuota(e)) return;
      throw e;
    }
  }, 90000);
});
