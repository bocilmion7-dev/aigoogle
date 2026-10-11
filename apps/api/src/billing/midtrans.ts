import { createHash, timingSafeEqual } from "node:crypto";

export function isBillingEnabled(): boolean {
  return process.env.BILLING_ENABLED === "1" && (process.env.MIDTRANS_SERVER_KEY ?? "") !== "";
}

export function billingServerKey(): string {
  return process.env.MIDTRANS_SERVER_KEY ?? "";
}

export interface MidtransNotification {
  order_id: string;
  status_code: string;
  gross_amount: string;
  transaction_status: string;
  payment_type?: string;
  fraud_status?: string;
  transaction_time?: string;
}

export function computeWebhookSignature(payload: MidtransNotification, serverKey: string): string {
  return createHash("sha512")
    .update(`${payload.order_id}${payload.status_code}${payload.gross_amount}${serverKey}`)
    .digest("hex");
}

export function verifyWebhookSignature(
  payload: MidtransNotification,
  serverKey: string,
  signature: string
): boolean {
  if (!signature || signature.length !== 128) return false;
  const expected = Buffer.from(computeWebhookSignature(payload, serverKey), "hex");
  const actual = Buffer.from(signature, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
