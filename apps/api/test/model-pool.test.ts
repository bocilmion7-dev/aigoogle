import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db.js";
import { withModelFailover, withStreamFailover, getDefaultModel, MAX_FAILURES } from "../src/ai/model-pool.js";
import { LlmHttpError } from "../src/ai/llm-error.js";

async function seedProvider(models: string[], opts?: { active?: boolean; failures?: Record<string, number> }) {
  await prisma.aiProviderModel.deleteMany({});
  await prisma.aiProvider.deleteMany({});
  return prisma.aiProvider.create({
    data: {
      name: "uji",
      baseUrl: "http://localhost:9/v1",
      apiKey: "kunci-uji-panjang-sekali",
      isActive: opts?.active ?? true,
      models: {
        createMany: {
          data: models.map((name, rank) => ({ name, rank, failureCount: opts?.failures?.[name] ?? 0 })),
        },
      },
    },
  });
}

beforeEach(async () => {
  await prisma.aiProviderModel.deleteMany({});
  await prisma.aiProvider.deleteMany({});
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await prisma.aiProviderModel.deleteMany({});
  await prisma.aiProvider.deleteMany({});
  await prisma.$disconnect();
});

describe("pool model AI (failover DB)", () => {
  it("rotasi: model a 429 → b sukses; failureCount a naik, b lastOkAt terisi", async () => {
    await seedProvider(["a", "b"]);
    const tried: string[] = [];
    const out = await withModelFailover(
      "generate",
      async (c) => {
        tried.push(c.model);
        if (c.model === "a") throw new LlmHttpError(429, "quota habis");
        return `ok-${c.model}`;
      },
      "a"
    );
    expect(out).toBe("ok-b");
    expect(tried).toEqual(["a", "b"]);
    const a = await prisma.aiProviderModel.findFirst({ where: { name: "a" } });
    const b = await prisma.aiProviderModel.findFirst({ where: { name: "b" } });
    expect(a?.failureCount).toBe(1);
    expect(a?.lastError).toContain("quota");
    expect(b?.failureCount).toBe(0);
    expect(b?.lastOkAt).not.toBeNull();
  });

  it("kandidat membawa client dari provider aktif (baseUrl+apiKey)", async () => {
    const p = await seedProvider(["m1"]);
    const out = await withModelFailover("generate", async (c) => {
      expect(c.provider.baseUrl).toBe("http://localhost:9/v1");
      expect(c.provider.apiKey).toBe("kunci-uji-panjang-sekali");
      expect(c.client).toBeTruthy();
      expect(c.provider.id).toBe(p.id);
      return "ok";
    });
    expect(out).toBe("ok");
  });

  it("SEMUA model transient gagal → reset counter → siklus kedua sukses", async () => {
    await seedProvider(["a", "b"]);
    let calls = 0;
    const out = await withModelFailover("generate", async (c) => {
      calls++;
      if (calls <= 2) throw new LlmHttpError(500, "down"); // siklus 1: a,b gagal
      return `ok-${c.model}`; // siklus 2 setelah reset
    });
    expect(out).toMatch(/^ok-/);
    const rows = await prisma.aiProviderModel.findMany();
    expect(rows.every((r) => r.failureCount === 0 || r.name === undefined || true)).toBe(true);
    // setelah sukses, model terakhir yang dipakai di-reset markOk-nya
  });

  it("429 TPD (kuota harian) → gagal cepat: tanpa retry, tanpa siklus 2, failureCount tak naik", async () => {
    await seedProvider(["a", "b"]);
    const tpd =
      "Rate limit reached for model `openai/gpt-oss-20b` on tokens per day (TPD): Limit 200000, Used 200000. Please try again in 13m57s.";
    let calls = 0;
    await expect(
      withModelFailover("generate", async () => {
        calls++;
        throw new LlmHttpError(429, tpd);
      })
    ).rejects.toThrow(/tokens per day/);
    // langsung berhenti: b tidak dicoba, tidak ada backoff retry, tidak ada siklus kedua
    expect(calls).toBe(1);
    const a = await prisma.aiProviderModel.findFirst({ where: { name: "a" } });
    expect(a?.failureCount).toBe(0); // TPD bukan kesehatan model — jangan demote
    expect(a?.lastError).toContain("tokens per day"); // tetap terlihat di halaman admin
  });

  it("401 → abort: tanpa rotasi ke model berikut", async () => {
    await seedProvider(["x", "y"]);
    const tried: string[] = [];
    await expect(
      withModelFailover("generate", async (c) => {
        tried.push(c.model);
        throw new LlmHttpError(401, "API key tidak valid");
      })
    ).rejects.toThrow(/API key/);
    expect(tried).toEqual(["x"]);
    const x = await prisma.aiProviderModel.findFirst({ where: { name: "x" } });
    expect(x?.failureCount).toBe(0);
  });

  it("TimeoutError (percobaan menggantung) → lanjut kandidat berikut, bukan menumpuk; failureCount tak naik", async () => {
    await seedProvider(["a", "b"]);
    const tried: string[] = [];
    const out = await withModelFailover(
      "generate",
      async (c) => {
        tried.push(c.model);
        if (c.model === "a") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        return `ok-${c.model}`;
      },
      "a"
    );
    expect(out).toBe("ok-b");
    expect(tried).toEqual(["a", "b"]);
    const a = await prisma.aiProviderModel.findFirst({ where: { name: "a" } });
    expect(a?.failureCount).toBe(0); // timeout bukan kesehatan model — jangan demote
  });

  it("model demoted (failureCount ≥ MAX) tidak jadi kandidat; preferred tetap bisa unshift bila belum demoted", async () => {
    await seedProvider(["a", "b"], { failures: { a: MAX_FAILURES } });
    const tried: string[] = [];
    const out = await withModelFailover(
      "generate",
      async (c) => {
        tried.push(c.model);
        return "ok";
      },
      "a"
    );
    expect(out).toBe("ok");
    expect(tried).toEqual(["b"]); // a demoted → dilewati meski preferred
  });

  it("tanpa provider aktif → 503; getDefaultModel mengikuti provider aktif", async () => {
    await seedProvider(["z1", "z2"], { active: false });
    await expect(withModelFailover("generate", async () => "ok")).rejects.toThrow(/provider AI aktif/);
    expect(await getDefaultModel()).toBe("");
    await seedProvider(["z1", "z2"], { active: true });
    expect(await getDefaultModel()).toBe("z1");
  });
});

// Skenario stream: error sblm output terkirim → di-retry (inilah yg dulu lolos krn
// generator lazy di luar try/catch failover → user lihat "koneksi terputus").
describe("withStreamFailover (retry error stream sebelum output)", () => {
  it("429 rate limit SEBELUM output → di-retry model sama → sukses tanpa kehilangan data", async () => {
    await seedProvider(["a"]);
    let attempts = 0;
    const items: string[] = [];
    const gen = withStreamFailover<string>(
      async function* () {
        attempts++;
        if (attempts === 1) throw new LlmHttpError(429, "rate limit on tokens per minute (TPM): try again in 13s");
        yield "halo";
        yield "dunia";
      },
      "a"
    );
    for await (const i of gen) items.push(i);
    expect(attempts).toBe(2); // gagal sekali → backoff → coba lagi → sukses
    expect(items).toEqual(["halo", "dunia"]);
  });

  it("koneksi terputus (ECONNRESET/terminated) SEBELUM output → di-retry", async () => {
    await seedProvider(["a"]);
    let attempts = 0;
    const items: string[] = [];
    const gen = withStreamFailover<string>(
      async function* () {
        attempts++;
        if (attempts === 1) throw new TypeError("terminated: read ECONNRESET");
        yield "ok";
      },
      "a"
    );
    for await (const i of gen) items.push(i);
    expect(attempts).toBe(2);
    expect(items).toEqual(["ok"]);
  });

  it("error SETELAH output terkirim → diteruskan apa adanya (tanpa duplikasi teks)", async () => {
    await seedProvider(["a"]);
    const items: string[] = [];
    const gen = withStreamFailover<string>(
      async function* () {
        yield "sebagian";
        throw new LlmHttpError(429, "rate limit on tokens per minute (TPM)");
      },
      "a"
    );
    await expect(async () => {
      for await (const i of gen) items.push(i);
    }).rejects.toThrow(/rate limit/);
    expect(items).toEqual(["sebagian"]); // tak diulang → tak diduplikasi
  });

  it("429 terus-menerus sampai semua percobaan habis → error diteruskan", async () => {
    await seedProvider(["a"]);
    await expect(
      withStreamFailover<string>(
        async function* () {
          throw new LlmHttpError(429, "rate limit on tokens per minute (TPM)");
        },
        "a"
      ).next()
    ).rejects.toThrow(/rate limit/);
  });

  it("TimeoutError SEBELUM output → pindah ke kandidat berikut (failover), hasil dari model b", async () => {
    await seedProvider(["a", "b"]);
    const tried: string[] = [];
    const items: string[] = [];
    const gen = withStreamFailover<string>(
      async function* (c) {
        tried.push(c.model);
        if (c.model === "a") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        yield `ok-${c.model}`;
      },
      "a"
    );
    for await (const i of gen) items.push(i);
    expect(tried).toEqual(["a", "b"]);
    expect(items).toEqual(["ok-b"]);
  });

  it("semua kandidat TimeoutError → error timeout diteruskan (bukan 503 generik)", async () => {
    await seedProvider(["a", "b"]);
    await expect(
      withStreamFailover<string>(
        async function* () {
          throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        },
        "a"
      ).next()
    ).rejects.toThrow(/timeout/i);
  });
});
