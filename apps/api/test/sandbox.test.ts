import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";

vi.mock("../src/providers/accounting/connection.js", () => ({ accurateCtxFor: vi.fn() }));
vi.mock("../src/providers/accounting/index.js", () => ({ accurateProvider: vi.fn() }));
vi.mock("../src/ai/llm-client.js", () => ({ llmClient: vi.fn() }));
vi.mock("../src/ai/module-model.js", () => ({ getModuleModel: vi.fn(async () => null) }));
vi.mock("../src/ai/usage.js", () => ({ recordLlmUsage: vi.fn(async () => undefined) }));
vi.mock("../src/ai/billing.js", () => ({
  assertAiAccess: vi.fn(async () => undefined),
  tenantOwnerId: vi.fn(async () => "owner-1"),
}));
vi.mock("../src/billing/midtrans.js", () => ({ isBillingEnabled: vi.fn(() => true) }));
vi.mock("../src/billing/midtrans-snap.js", () => ({
  midtransSnapReady: vi.fn(() => true),
  generateQrMpm: vi.fn(async (orderId: string) => ({
    qrUrl: "https://example.test/qris.png",
    qrContent: "000201",
    referenceNo: `REF-${orderId}`,
    expiredAt: new Date(Date.now() + 900_000).toISOString(),
  })),
}));

import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { accurateCtxFor } from "../src/providers/accounting/connection.js";
import { accurateProvider } from "../src/providers/accounting/index.js";
import { llmClient } from "../src/ai/llm-client.js";
import { getShopOrder, listShopOrders } from "../src/wa/shop-order.js";

type MockFn = ReturnType<typeof vi.fn>;

let api: ReturnType<typeof createApp>;
let tenantId = "";
let cookie = "";
let peer = "";

const generate = vi.fn();

beforeAll(async () => {
  api = createApp();
  const tenant = await prisma.tenant.create({
    data: { provider: "accurate", providerDbId: `sx-${randomBytes(3).toString("hex")}`, name: "PT Sandbox", alias: "SBX" },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({ data: { tenantId, key: "admin", name: "Admin" } });
  const user = await prisma.user.create({
    data: {
      tenantId,
      providerUserId: `sb-${randomBytes(3).toString("hex")}`,
      email: `sb-${randomBytes(3).toString("hex")}@demo.local`,
      name: "Sandbox Admin",
      roleId: role.id,
    },
  });
  const sid = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: sid, userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) } });
  cookie = `sid=${sid}`;
  peer = `sandbox:${user.id}`;
  await prisma.appSetting.upsert({
    where: { key: `wa:shop_ai:${tenantId}` },
    create: { key: `wa:shop_ai:${tenantId}`, value: "1" },
    update: { value: "1" },
  });
  await prisma.appSetting.upsert({
    where: { key: `wa:owner_phone:${tenantId}` },
    create: { key: `wa:owner_phone:${tenantId}`, value: "628999" },
    update: { value: "628999" },
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  (accurateCtxFor as unknown as MockFn).mockResolvedValue({ tenantId, host: "http://mock", session: "s", accessToken: "a" });
  (accurateProvider as unknown as MockFn).mockReturnValue({
    execute: vi.fn(async () => ({ item: { no: "BRG-1", name: "Kopi Susu" }, sellingPrice: 15000, stock: 10 })),
  });
  (llmClient as unknown as MockFn).mockReturnValue({ generate });
});

afterAll(async () => {
  await prisma.waMessageLog.deleteMany({ where: { tenantId } });
  await prisma.appSetting.deleteMany({ where: { key: { contains: tenantId } } });
  await prisma.appSetting.deleteMany({ where: { key: { startsWith: "wa:shop_order:" } } });
  await prisma.payment.deleteMany({ where: { tenantId } });
  await prisma.session.deleteMany({ where: { user: { tenantId } } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.role.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("sandbox WhatsApp", () => {
  it("GET sesi → status fitur + nomor semu", async () => {
    const r = await request(api).get("/api/sandbox/session").set("Cookie", cookie);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ peer, shopAi: true, accurateConnected: true, aiAccess: true });
    expect(typeof r.body.biteshipReady).toBe("boolean");
    expect(r.body.messages).toEqual([]);
  });

  it("pesan pembeli → balasan AI + QRIS, tercatat seperti chat live", async () => {
    generate
      .mockResolvedValueOnce({
        parts: [
          {
            functionCall: {
              name: "buatPesanan",
              args: {
                fulfillment: "pickup",
                items: [{ nama: "Kopi Susu", qty: 1 }],
                namaPembeli: "Budi",
                noHp: "081234567890",
              },
            },
          },
        ],
      });
    const r = await request(api).post("/api/sandbox/messages").set("Cookie", cookie).send({ text: "ambil sendiri, kopi 1" });
    expect(r.status).toBe(200);
    expect(r.body.replied).toBe(true);
    const rows = r.body.messages as Array<{ direction: string; body: string }>;
    expect(rows.map((m) => m.direction)).toEqual(["in", "out"]);
    expect(rows[0]?.body).toBe("ambil sendiri, kopi 1");
    expect(rows[1]?.body).toContain("[image] Total Rp15.000");
    expect(rows[1]?.body).toContain("https://example.test/qris.png");

    // pesanan benar-benar tercatat seperti live (bisa diuji di halaman Pesanan)
    const orders = await listShopOrders(tenantId);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      buyerPhone: peer,
      fulfillment: "pickup",
      total: 15000,
      buyerName: "Budi",
      buyerContactPhone: "081234567890",
    });
    expect(orders[0]?.items[0]).toMatchObject({ no: "BRG-1", qty: 1, price: 15000 });
    expect(await getShopOrder(orders[0]!.orderId)).toBeTruthy();
  });

  it("buatPesanan tanpa nama/no HP → pesanan TIDAK dibuat, AI diminta menanyakan dulu", async () => {
    const countBefore = (await listShopOrders(tenantId)).length;
    generate
      .mockResolvedValueOnce({
        parts: [
          {
            functionCall: {
              name: "buatPesanan",
              args: { fulfillment: "pickup", items: [{ nama: "Kopi Susu", qty: 1 }] },
            },
          },
        ],
      })
      .mockResolvedValueOnce({ parts: [{ text: "Boleh minta nama dan nomor HP kakak dulu ya." }] });

    const r = await request(api).post("/api/sandbox/messages").set("Cookie", cookie).send({ text: "kopi 1" });
    expect(r.status).toBe(200);
    expect(r.body.replied).toBe(true);
    expect(r.body.messages.at(-1)?.body).toContain("nama dan nomor HP");
    expect((await listShopOrders(tenantId)).length).toBe(countBefore);
  });

  it("AI penjaga toko nonaktif → tidak membalas, alasan dikirim ke sandbox", async () => {
    await prisma.appSetting.update({ where: { key: `wa:shop_ai:${tenantId}` }, data: { value: "0" } });
    const r = await request(api).post("/api/sandbox/messages").set("Cookie", cookie).send({ text: "halo" });
    expect(r.status).toBe(200);
    expect(r.body.replied).toBe(false);
    expect(r.body.reason).toBe("shop_ai_nonaktif");
    await prisma.appSetting.update({ where: { key: `wa:shop_ai:${tenantId}` }, data: { value: "1" } });
  });

  it("Accurate belum terhubung → alasan jelas", async () => {
    (accurateCtxFor as unknown as MockFn).mockResolvedValueOnce(null);
    const r = await request(api).post("/api/sandbox/messages").set("Cookie", cookie).send({ text: "ada apa aja?" });
    expect(r.status).toBe(200);
    expect(r.body.replied).toBe(false);
    expect(r.body.reason).toBe("accurate_belum_terhubung");
  });

  it("chat sandbox tidak muncul di daftar Chat WhatsApp", async () => {
    await prisma.waMessageLog.create({
      data: { tenantId, to: "628111", body: "chat asli", direction: "in", status: "received", costCredits: 0 },
    });
    const r = await request(api).get("/api/wa/chats").set("Cookie", cookie);
    expect(r.status).toBe(200);
    const peers = (r.body as Array<{ peer: string }>).map((c) => c.peer);
    expect(peers).toContain("628111");
    expect(peers.some((p) => p.startsWith("sandbox:"))).toBe(false);
  });

  it("bersihkan riwayat sandbox", async () => {
    const del = await request(api).delete("/api/sandbox/messages").set("Cookie", cookie);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);
    const rows = await prisma.waMessageLog.count({ where: { tenantId, to: peer } });
    expect(rows).toBe(0);
  });
});
