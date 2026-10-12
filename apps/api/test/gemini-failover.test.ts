import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db.js";
import { env } from "../src/env.js";
import { withModelFailover, refreshModelsLive, MAX_FAILURES } from "../src/ai/model-pool.js";
import { GeminiHttpError } from "../src/ai/gemini-error.js";

function listResp(names: string[]): Response {
  return new Response(
    JSON.stringify({
      models: names.map((n) => ({
        name: `models/${n}`,
        displayName: n,
        supportedGenerationMethods: ["generateContent"],
      })),
    }),
    { status: 200 }
  );
}

beforeEach(async () => {
  await prisma.geminiModel.deleteMany({});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  // kembalikan isi tabel ke daftar live asli (hapus baris uji) supaya file test lain
  // tidak menabrak model tiruan
  await prisma.geminiModel.deleteMany({});
  await refreshModelsLive().catch(() => {});
  await prisma.$disconnect();
});

describe("pool model Gemini (failover)", () => {
  it("tabel kosong → load daftar model live & simpan per ember (generate/tts/stt)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/models?")) {
          return listResp(["gemini-uji-flash", "gemini-uji-flash-tts", "gemini-uji-transcribe"]);
        }
        throw new Error(`fetch tak terduga: ${url}`);
      })
    );
    const got = await withModelFailover("generate", async (m) => `pakai:${m}`);
    expect(got).toMatch(/^pakai:/);

    const rows = await prisma.geminiModel.findMany({ orderBy: { rank: "asc" } });
    const gen = rows.filter((r) => r.action === "generate").map((r) => r.name);
    const tts = rows.filter((r) => r.action === "tts").map((r) => r.name);
    const stt = rows.filter((r) => r.action === "stt").map((r) => r.name);
    expect(gen[0]).toBe(env.GEMINI_MODEL); // pilihan env selalu di depan
    expect(gen).toContain("gemini-uji-flash");
    expect(tts).toContain("gemini-uji-flash-tts");
    expect(tts).toContain(env.GEMINI_TTS_MODEL);
    expect(stt).toContain("gemini-uji-transcribe");
    expect(stt).toContain(env.GEMINI_TRANSCRIBE_MODEL);
  });

  it("model gagal → rotasi ke model berikutnya; sukses → hitungan direset", async () => {
    await prisma.geminiModel.createMany({
      data: [
        { id: "generate:a", action: "generate", name: "a", rank: 0 },
        { id: "generate:b", action: "generate", name: "b", rank: 1 },
      ],
    });
    const tried: string[] = [];
    const out = await withModelFailover(
      "generate",
      async (m) => {
        tried.push(m);
        if (m === "a") throw new GeminiHttpError(429, "quota harian habis");
        return `ok-${m}`;
      },
      "a"
    );
    expect(out).toBe("ok-b");
    expect(tried).toEqual(["a", "b"]);
    const a = await prisma.geminiModel.findUnique({ where: { id: "generate:a" } });
    const b = await prisma.geminiModel.findUnique({ where: { id: "generate:b" } });
    expect(a?.failureCount).toBe(1);
    expect(a?.lastError).toContain("quota");
    expect(b?.failureCount).toBe(0);
    expect(b?.lastOkAt).not.toBeNull();
  });

  it("SEMUA model gagal → refresh daftar live → model baru terpakai", async () => {
    await prisma.geminiModel.createMany({
      data: [
        { id: "generate:lama1", action: "generate", name: "lama1", rank: 0 },
        { id: "generate:lama2", action: "generate", name: "lama2", rank: 1 },
      ],
    });
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetched.push(String(url));
        if (String(url).includes("/models?")) return listResp(["gemini-baru-flash"]);
        return new Response("gagal", { status: 500 });
      })
    );
    const out = await withModelFailover("generate", async (m) => {
      if (m === "gemini-baru-flash") return "ok-baru";
      throw new GeminiHttpError(429, "semua model ditolak");
    });
    expect(out).toBe("ok-baru");
    expect(fetched.some((u) => u.includes("/models?"))).toBe(true); // refresh live terjadi
    const names = (await prisma.geminiModel.findMany({ where: { action: "generate" } })).map((r) => r.name);
    expect(names).toContain("gemini-baru-flash"); // hasil refresh
    expect(names).toContain(env.GEMINI_MODEL); // pilihan env tetap ikut
    expect(names).not.toContain("lama1"); // daftar lama tergantikan
  });

  it("semua model sudah demoted (failureCount ≥ MAX) → refresh otomatis lalu coba lagi", async () => {
    await prisma.geminiModel.createMany({
      data: [
        { id: "generate:mati1", action: "generate", name: "mati1", rank: 0, failureCount: MAX_FAILURES },
        { id: "generate:mati2", action: "generate", name: "mati2", rank: 1, failureCount: MAX_FAILURES },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/models?")) return listResp(["gemini-hidup-flash"]);
        throw new Error(`fetch tak terduga: ${url}`);
      })
    );
    const out = await withModelFailover("generate", async (m) => {
      if (m === "gemini-hidup-flash" || m === env.GEMINI_MODEL) return `ok-${m}`;
      throw new GeminiHttpError(429, "mati");
    });
    expect(out).toMatch(/^ok-/);
    const refreshed = await prisma.geminiModel.findMany({ where: { action: "generate" } });
    expect(refreshed.every((r) => r.failureCount === 0)).toBe(true); // hitungan ter-reset
  });

  it("401 (kunci bermasalah) → langsung berhenti: tanpa rotasi, tanpa demote, tanpa refresh", async () => {
    await prisma.geminiModel.createMany({
      data: [
        { id: "generate:x", action: "generate", name: "x", rank: 0 },
        { id: "generate:y", action: "generate", name: "y", rank: 1 },
      ],
    });
    let listFetches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        listFetches++;
        return listResp([]);
      })
    );
    const tried: string[] = [];
    await expect(
      withModelFailover("generate", async (m) => {
        tried.push(m);
        throw new GeminiHttpError(401, "API key tidak valid");
      })
    ).rejects.toThrow(/API key/);
    expect(tried).toEqual(["x"]);
    expect(listFetches).toBe(0);
    const x = await prisma.geminiModel.findUnique({ where: { id: "generate:x" } });
    expect(x?.failureCount).toBe(0);
  });

  it("400 (galat input, bukan kapasitas) → coba model berikut tanpa demote & tanpa refresh", async () => {
    await prisma.geminiModel.createMany({
      data: [
        { id: "generate:p", action: "generate", name: "p", rank: 0 },
        { id: "generate:q", action: "generate", name: "q", rank: 1 },
      ],
    });
    let listFetches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        listFetches++;
        return listResp([]);
      })
    );
    const tried: string[] = [];
    await expect(
      withModelFailover("generate", async (m) => {
        tried.push(m);
        throw new GeminiHttpError(400, "permintaan tidak valid");
      })
    ).rejects.toThrow(/tidak valid/);
    expect(tried).toEqual(["p", "q"]); // tetap berputar
    expect(listFetches).toBe(0); // refresh TIDAK dipanggil
    const p = await prisma.geminiModel.findUnique({ where: { id: "generate:p" } });
    expect(p?.failureCount).toBe(0); // tidak di-demote
  });
});
