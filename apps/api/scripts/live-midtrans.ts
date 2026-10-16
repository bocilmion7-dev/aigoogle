import { getAccessToken, generateQrMpm, midtransSnapReady, midtransBaseUrl, midtransEnv } from "../src/billing/midtrans-snap.js";

async function main() {
  console.log("env:", midtransEnv(), "| base:", midtransBaseUrl(midtransEnv()));
  console.log("snapReady:", midtransSnapReady());
  console.log("clientId:", process.env.MIDTRANS_CLIENT_ID);
  console.log("merchantId:", process.env.MIDTRANS_MERCHANT_ID);
  console.log("channelId:", process.env.MIDTRANS_CHANNEL_ID);
  console.log("price:", process.env.MIDTRANS_PRO_PRICE);

  console.log("\n── getAccessToken ──");
  const token = await getAccessToken(true);
  console.log("token ok, length:", token.length, "| prefix:", token.slice(0, 20));

  console.log("\n── generateQrMpm ──");
  const orderId = `sub-${Date.now()}`;
  const qr = await generateQrMpm(orderId, 49000);
  console.log("orderId:", orderId);
  console.log("referenceNo:", qr.referenceNo);
  console.log("qrUrl:", qr.qrUrl);
  console.log("qrContent len:", qr.qrContent.length);
  console.log("expiredAt:", qr.expiredAt);
}

main().catch((e) => {
  console.error("LIVE TEST GAGAL:", e);
  process.exit(1);
});
