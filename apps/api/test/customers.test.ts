import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { createApp as createMockApp } from "@mock/accurate";
import { prisma } from "../src/db.js";

let api: ReturnType<typeof createApp>;
let mockSrv: Server;
let mockBase: string;
let cookie = "";
let bareCookie = "";

const realFetch = globalThis.fetch.bind(globalThis);
let geminiReply: Record<string, unknown> = {
  text: "Nota penjualan 2 rim kertas A4",
  docType: "nota",
  customerName: "Toko Maju",
  date: "2026-10-05",
  no: "NOTA-7",
  total: 150000,
  description: "Penjualan kertas",
  items: [{ name: "Kertas A4", qty: 2, price: 75000 }],
};
const geminiCalls: Array<{ url: string; body: string }> = [];

beforeAll(async () => {
  mockSrv = createMockApp().listen(0);
  await new Promise((r) => mockSrv.once("listening", r));
  mockBase = `http://127.0.0.1:${(mockSrv.address() as { port: number }).port}`;
  process.env.MOCK_ACCURATE_URL = mockBase;
  api = createApp();
  await prisma.appSetting.deleteMany({ where: { key: "ocrMode" } });

  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `c-${randomBytes(4).toString("hex")}`, name: "PT Pelang", alias: "PLG" },
  });
  const role = await prisma.role.create({ data: { tenantId: tenant.id, key: "admin", name: "Admin" } });
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionKey: "app:settings.manage" } });
  for (const permissionKey of ["accurate:customer.view", "accurate:sales-invoice.view", "accurate:sales-receipt.view"]) {
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionKey } });
  }
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, providerUserId: `cu-${randomBytes(4).toString("hex")}`, email: "plg@demo.local", name: "Plg", roleId: role.id },
  });
  const auth = await fetch(`${mockBase}/oauth/authorize?redirect_uri=${encodeURIComponent("http://x/cb")}&admin=1`, { redirect: "manual" });
  const code = new URL(auth.headers.get("location")!).searchParams.get("code")!;
  const tokRes = await fetch(`${mockBase}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: "http://x/cb", client_id: "c", client_secret: "s" }),
  });
  const tok = (await tokRes.json()) as { access_token: string; refresh_token: string; expires_in: number };
  const open = (await (await fetch(`${mockBase}/api/open-db.do?id=1001`, { headers: { Authorization: `Bearer ${tok.access_token}` } })).json()) as {
    session: string;
    host: string;
  };
  const { encryptToken } = await import("../src/crypto.js");
  await prisma.connection.create({
    data: {
      tenantId: tenant.id,
      provider: "accurate",
      accessTokenEnc: encryptToken(tok.access_token),
      refreshTokenEnc: encryptToken(tok.refresh_token),
      expiresAt: new Date(Date.now() + tok.expires_in * 1000),
      host: open.host,
      session: open.session,
    },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86400_000) } });
  cookie = `sid=${sid}`;

  const bareRole = await prisma.role.create({ data: { tenantId: tenant.id, key: "guest", name: "Guest" } });
  const bareUser = await prisma.user.create({
    data: { tenantId: tenant.id, providerUserId: `cg-${randomBytes(4).toString("hex")}`, email: "guest@demo.local", name: "Guest", roleId: bareRole.id },
  });
  const bareSid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: bareSid, userId: bareUser.id, expiresAt: new Date(Date.now() + 86400_000) } });
  bareCookie = `sid=${bareSid}`;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("generativelanguage.googleapis.com")) {
        geminiCalls.push({ url, body: String(init?.body ?? "") });
        const text = url.includes(":generateContent")
          ? JSON.stringify(geminiReply)
          : String((geminiReply as { text?: string }).text ?? "");
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
      }
      return realFetch(input, init);
    })
  );
});

afterEach(() => {
  geminiCalls.length = 0;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.appSetting.deleteMany({ where: { key: "ocrMode" } });
  mockSrv.closeAllConnections();
  await new Promise((r) => mockSrv.close(r));
  await prisma.$disconnect();
});

describe("GET /api/customers", () => {
  it("tanpa login → 401", async () => {
    expect((await request(api).get("/api/customers")).status).toBe(401);
  });

  it("login → daftar pelanggan + agregat faktur", async () => {
    const res = await request(api).get("/api/customers").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const budi = (res.body as Array<Record<string, unknown>>).find((c) => c.name === "Budi Santoso");
    expect(budi).toBeTruthy();
    expect(budi!.invoiceCount).toBe(1);
    expect(budi!.invoiceTotal).toBe(2500000);
  });
});

describe("POST /api/customers/entries", () => {
  it("tanpa login → 401; body ngawur → 400", async () => {
    expect((await request(api).post("/api/customers/entries").send({ target: "salesInvoice", customerName: "X" })).status).toBe(401);
    const bad = await request(api)
      .post("/api/customers/entries")
      .set("Cookie", cookie)
      .send({ target: "ngawur", customerName: "" });
    expect(bad.status).toBe(400);
  });

  it("simpan faktur penjualan → id provider + muncul di agregat", async () => {
    const res = await request(api)
      .post("/api/customers/entries")
      .set("Cookie", cookie)
      .send({ target: "salesInvoice", customerName: "Budi Santoso", total: 999000, date: "2026-10-05", description: "Uji coba" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, target: "salesInvoice" });
    expect(String(res.body.id)).toMatch(/^SA-/);

    const list = await request(api).get("/api/customers").set("Cookie", cookie);
    const budi = (list.body as Array<Record<string, unknown>>).find((c) => c.name === "Budi Santoso");
    expect(budi!.invoiceCount).toBe(2);
    expect(budi!.invoiceTotal).toBe(3499000);
  });

  it("simpan penerimaan kas → id provider", async () => {
    const res = await request(api)
      .post("/api/customers/entries")
      .set("Cookie", cookie)
      .send({ target: "salesReceipt", customerName: "Siti Aminah", total: 150000 });
    expect(res.status).toBe(200);
    expect(res.body.target).toBe("salesReceipt");
    expect(String(res.body.id)).toMatch(/^SA-/);
  });
});

describe("POST /api/customers/scan", () => {
  it("tanpa login → 401; tipe tak didukung → 415", async () => {
    const un = await request(api).post("/api/customers/scan").send(Buffer.from("x"));
    expect(un.status).toBe(401);
    const zip = await request(api)
      .post("/api/customers/scan")
      .set("Cookie", cookie)
      .set("x-file-name", "acara.zip")
      .set("Content-Type", "application/zip")
      .send(Buffer.from("PK"));
    expect(zip.status).toBe(415);
  });

  it("gambar (vision aktif) → kirim inlineData, balas field + target", async () => {
    const res = await request(api)
      .post("/api/customers/scan")
      .set("Cookie", cookie)
      .set("x-file-name", "nota.jpg")
      .set("Content-Type", "image/jpeg")
      .send(Buffer.from("JPEGDATA"));
    expect(res.status).toBe(200);
    expect(res.body.fields).toMatchObject({ docType: "nota", customerName: "Toko Maju", total: 150000 });
    expect(res.body.suggestedTarget).toBe("salesReceipt");
    expect(geminiCalls.length).toBeGreaterThan(0);
    expect(geminiCalls[0].body).toContain("inlineData");
    expect(geminiCalls[0].body).toContain("image/jpeg");
  });

  it("dokumen teks (.md) → ekstraksi lokal + field dari model", async () => {
    geminiReply = { ...geminiReply, docType: "faktur" };
    const res = await request(api)
      .post("/api/customers/scan")
      .set("Cookie", cookie)
      .set("x-file-name", "faktur.md")
      .set("Content-Type", "text/markdown")
      .send(Buffer.from("# Faktur penjualan\nToko Maju - total 150000"));
    expect(res.status).toBe(200);
    expect(res.body.rawText).toContain("Faktur penjualan");
    expect(res.body.suggestedTarget).toBe("salesInvoice");
  });

  it("ocrMode=text → gambar ditolak 409", async () => {
    const put = await request(api).put("/api/settings").set("Cookie", cookie).send({ ocrMode: "text" });
    expect(put.status).toBe(200);
    const res = await request(api)
      .post("/api/customers/scan")
      .set("Cookie", cookie)
      .set("x-file-name", "nota.jpg")
      .set("Content-Type", "image/jpeg")
      .send(Buffer.from("JPEGDATA"));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("vision_ocr_nonaktif");
    await request(api).put("/api/settings").set("Cookie", cookie).send({ ocrMode: "vision" });
  });
});

describe("POST /api/reader", () => {
  it("markdown → teks lokal, engine local", async () => {
    const res = await request(api)
      .post("/api/reader")
      .set("Cookie", cookie)
      .set("x-file-name", "catatan.md")
      .set("Content-Type", "text/markdown")
      .send(Buffer.from("# Catatan rapat\nBaharudin hadir"));
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe("local");
    expect(res.body.text).toContain("Baharudin");
  });

  it("gambar → OCR vision, engine gemini-vision", async () => {
    geminiReply = { text: "Teks nota: Rp150.000" };
    const res = await request(api)
      .post("/api/reader")
      .set("Cookie", cookie)
      .set("x-file-name", "bukti.jpg")
      .set("Content-Type", "image/jpeg")
      .send(Buffer.from("JPEGDATA"));
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe("gemini-vision");
    expect(res.body.text).toContain("150.000");
    const last = geminiCalls[geminiCalls.length - 1];
    expect(last.body).toContain("inlineData");
  });

  it("file kosong → 400", async () => {
    const res = await request(api)
      .post("/api/reader")
      .set("Cookie", cookie)
      .set("x-file-name", "kosong.txt")
      .set("Content-Type", "text/plain")
      .send(Buffer.from(""));
    expect(res.status).toBe(400);
  });
});


describe("isolation: hak modul", () => {
  it("menolak daftar pelanggan tanpa accurate:customer.view", async () => {
    expect((await request(api).get("/api/customers").set("Cookie", bareCookie)).status).toBe(403);
  });

  it("menolak entri faktur tanpa accurate:sales-invoice.view", async () => {
    const res = await request(api)
      .post("/api/customers/entries")
      .set("Cookie", bareCookie)
      .send({ target: "salesInvoice", customerName: "X", date: "2026-01-01", total: "1000" });
    expect(res.status).toBe(403);
  });

  it("menolak entri kwitansi tanpa accurate:sales-receipt.view", async () => {
    const res = await request(api)
      .post("/api/customers/entries")
      .set("Cookie", bareCookie)
      .send({ target: "salesReceipt", customerName: "X", date: "2026-01-01", total: "1000" });
    expect(res.status).toBe(403);
  });

  it("lulus hak untuk user ber-role admin demo (customer+invoice+receipt)", async () => {
    expect((await request(api).get("/api/customers").set("Cookie", cookie)).status).toBe(200);
  });
});
