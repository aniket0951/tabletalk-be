import crypto from "crypto";

let _razorpay: any = null;

export function getRazorpay() {
  if (!_razorpay) {
    // Dynamic require to avoid crash when RAZORPAY_KEY_ID is not set
    const Razorpay = require("razorpay");
    _razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    });
  }
  return _razorpay;
}

// Plan prices in paise (₹999 = 99900)
export const PLAN_PRICES = {
  STARTER: 99900,
  GROWTH: 149900,
  MULTI: 399900,
} as const;

export function verifyWebhookSignature(
  body: string,
  signature: string
): boolean {
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
    .update(body)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(signature)
  );
}

export function verifyOrderPaymentSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): boolean {
  const generatedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(generatedSignature),
    Buffer.from(razorpaySignature)
  );
}
