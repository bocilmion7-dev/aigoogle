import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";

/**
 * Uji klien Biteship terhadap server lokal: memastikan path, header Authorization,
 * bentuk payload (rates/orders), dan normalisasi respons sesuai API asli.
 */
let server: Server;
let base = "";
const seen: Array<{ method: string; url: string; auth: string; body: string }> = [];
let failRates = false;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", auth: String(req.headers.authorization ?? ""), body });
      const send = (code: number, obj: unknown) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (req.url?.startsWith("/v1/maps/areas")) {
        return send(200, {
          success: true,
          areas: [
            { id: "AREA-1", name: "Kuningan, Jakarta Selatan. 12950", postal_code: 12950 },
            { id: "AREA-2", name: "Tanpa kode pos", postal_code: null },
          ],
        });
      }
      if (req.url === "/v1/rates/couriers") {
        if (failRates) return send(400, { success: false, error: "Authentication for your key is failed." });
        return send(200, {
          success: true,
          pricing: [
            { courier_name: "JNE", courier_code: "jne", courier_service_name: "Reguler", courier_service_code: "reg", price: 10000, duration: "1 - 2 days", service_type: "reg", shipping_type: "parcel" },
            { courier_name: "SiCepat", courier_code: "sicepat", courier_service_name: "BEST", courier_service_code: "best", price: 14000, shipment_duration_range: "1", shipment_duration_unit: "days", service_type: "best", shipping_type: "parcel" },
          ],
        });
      }
      if (req.url === "/v1/orders") {
        return send(200, {
          success: true,
          id: "ORD-123",
          status: "confirmed",
          courier: { company: "jne", type: "reg", waybill_id: "AWB999", tracking_id: "TRK999" },
        });
      }
      if (req.url?.startsWith("/v1/trackings/")) {
        return send(200, {
          success: true,
          object: "tracking",
          id: "TRK-1",
          status: "picked",
          courier: { company: "jne", name: "JNE", driver_name: "Pak Budi", driver_phone: "0812" },
          waybill_id: "AWB999",
          order_id: "ORD-123",
          link: "https://track.biteship.com/TRK999",
          history: [
            { note: "Paket diinput", status: "picked", updated_at: "2026-10-25T08:00:00+07:00" },
            { note: "Paket diterima", status: "delivered", updated_at: "2026-10-26T10:00:00+07:00" },
          ],
        });
      }
      return send(404, { success: false, error: "not found" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.BITESHIP_BASE_URL = base;
  process.env.BITESHIP_API_KEY = "test-key";
});

beforeEach(() => {
  seen.length = 0;
  failRates = false;
});

afterAll(async () => {
  delete process.env.BITESHIP_BASE_URL;
  delete process.env.BITESHIP_API_KEY;
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

const ORIGIN = {
  contactName: "Gudang",
  phone: "08123456789",
  organization: "Toko Uji",
  address: "Jl. Contoh No. 1, Jakarta",
  postalCode: "12250",
};

describe("Biteship client", () => {
  it("cari area → normalisasi & buang yang tanpa kode pos", async () => {
    const { searchAreas } = await import("../src/shipping/biteship.js");
    const rows = await searchAreas("kuningan");
    expect(rows).toEqual([{ id: "AREA-1", name: "Kuningan, Jakarta Selatan. 12950", postalCode: "12950" }]);
    expect(seen[0]?.url).toContain("input=kuningan");
    expect(seen[0]?.auth).toBe("test-key");
  });

  it("ongkir → kirim postal code + item, normalisasi harga & durasi", async () => {
    const { getRates } = await import("../src/shipping/biteship.js");
    const rates = await getRates({
      originPostalCode: "12250",
      destinationPostalCode: "12950",
      items: [{ name: "Kopi", value: 15000, quantity: 2, weight: 500 }],
      couriers: "jne,sicepat",
    });
    expect(rates).toHaveLength(2);
    expect(rates[0]).toMatchObject({ courierCode: "jne", serviceCode: "reg", price: 10000 });
    expect(rates[1]?.duration).toBe("1 days");
    const sent = JSON.parse(seen[0]!.body) as Record<string, unknown>;
    expect(sent).toMatchObject({ origin_postal_code: 12250, destination_postal_code: 12950, couriers: "jne,sicepat" });
    expect((sent.items as Array<Record<string, unknown>>)[0]).toMatchObject({ quantity: 2, weight: 500, value: 15000 });
  });

  it("kode pos bukan 5 digit → ditolak sebelum memanggil API", async () => {
    const { getRates } = await import("../src/shipping/biteship.js");
    await expect(
      getRates({ originPostalCode: "12250", destinationPostalCode: "12", items: [] })
    ).rejects.toThrow(/5 digit/i);
    expect(seen).toHaveLength(0);
  });

  it("error API diteruskan sebagai pesan yang jelas", async () => {
    failRates = true;
    const { getRates } = await import("../src/shipping/biteship.js");
    await expect(
      getRates({
        originPostalCode: "12250",
        destinationPostalCode: "12950",
        items: [{ name: "X", value: 1, quantity: 1, weight: 100 }],
      })
    ).rejects.toThrow(/Authentication for your key is failed/);
  });

  it("buat order → payload shipper/origin/destination/kurir + item", async () => {
    const { createShipment } = await import("../src/shipping/biteship.js");
    const r = await createShipment({
      origin: ORIGIN,
      destination: {
        contactName: "Budi",
        phone: "628111",
        address: "Jl. Tujuan No. 2, Jakarta",
        postalCode: "12950",
      },
      courier: { company: "jne", type: "reg" },
      items: [{ name: "Kopi", value: 15000, quantity: 2, weight: 500 }],
      description: "Pesanan shop-mock-1",
      metadata: { orderId: "shop-mock-1" },
    });
    expect(r).toEqual({
      id: "ORD-123",
      status: "confirmed",
      waybillId: "AWB999",
      trackingId: "TRK999",
      trackingLink: "https://track.biteship.com/TRK999",
      courier: { company: "jne", type: "reg", name: undefined },
    });
    const sent = JSON.parse(seen[0]!.body) as Record<string, unknown>;
    expect(sent).toMatchObject({
      shipper_contact_name: "Gudang",
      shipper_organization: "Toko Uji",
      origin_postal_code: 12250,
      destination_postal_code: 12950,
      destination_contact_name: "Budi",
      courier_company: "jne",
      courier_type: "reg",
      delivery_type: "now",
    });
    expect((sent.items as Array<Record<string, unknown>>)[0]).toMatchObject({ quantity: 2, weight: 500 });
  });

  it("lacak pakai tracking_id (tanpa ?courier) → link & order id ikut", async () => {
    const { track } = await import("../src/shipping/biteship.js");
    const t = await track("TRK999");
    expect(t.status).toBe("picked");
    expect(t.courier.driverName).toBe("Pak Budi");
    expect(t.waybillId).toBe("AWB999");
    expect(t.link).toBe("https://track.biteship.com/TRK999");
    expect(t.orderId).toBe("ORD-123");
    expect(t.history.map((h) => h.status)).toEqual(["picked", "delivered"]);
    expect(seen[0]?.url).toBe("/v1/trackings/TRK999");
  });

  it("lacak pakai nomor resi → kirim ?courier", async () => {
    const { track } = await import("../src/shipping/biteship.js");
    await track("AWB999", "jne");
    expect(seen[0]?.url).toBe("/v1/trackings/AWB999?courier=jne");
  });

  it("produksi: BITESHIP_USE_LIVE=1 memakai key live (mode live), default tetap test", async () => {
    const { biteshipKeyMode } = await import("../src/shipping/biteship.js");
    const oldLive = process.env.BITESHIP_LIVE_API_KEY;
    const oldUse = process.env.BITESHIP_USE_LIVE;
    const oldKey = process.env.BITESHIP_API_KEY;
    try {
      process.env.BITESHIP_API_KEY = "biteship_test.uji";
      process.env.BITESHIP_LIVE_API_KEY = "biteship_live.uji";
      delete process.env.BITESHIP_USE_LIVE;
      expect(biteshipKeyMode()).toBe("test"); // default: key BITESHIP_API_KEY (test)
      process.env.BITESHIP_USE_LIVE = "1";
      expect(biteshipKeyMode()).toBe("live"); // eksplisit → pakai key live
    } finally {
      if (oldLive === undefined) delete process.env.BITESHIP_LIVE_API_KEY;
      else process.env.BITESHIP_LIVE_API_KEY = oldLive;
      if (oldUse === undefined) delete process.env.BITESHIP_USE_LIVE;
      else process.env.BITESHIP_USE_LIVE = oldUse;
      if (oldKey === undefined) delete process.env.BITESHIP_API_KEY;
      else process.env.BITESHIP_API_KEY = oldKey;
    }
  });

  it("tanpa API key → error jelas", async () => {
    const old = process.env.BITESHIP_API_KEY;
    delete process.env.BITESHIP_API_KEY;
    const { getRates, biteshipReady } = await import("../src/shipping/biteship.js");
    expect(biteshipReady()).toBe(false);
    await expect(
      getRates({ originPostalCode: "12250", destinationPostalCode: "12950", items: [] })
    ).rejects.toThrow(/belum dikonfigurasi/i);
    process.env.BITESHIP_API_KEY = old;
  });
});
