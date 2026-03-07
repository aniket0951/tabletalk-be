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

// Map our plan types to Razorpay plan IDs (set these in .env)
export const RAZORPAY_PLAN_IDS = {
  STARTER: process.env.RAZORPAY_PLAN_ID_STARTER!,
  GROWTH: process.env.RAZORPAY_PLAN_ID_GROWTH!,
  MULTI: process.env.RAZORPAY_PLAN_ID_MULTI!,
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

export function verifyPaymentSignature(
  razorpaySubscriptionId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): boolean {
  const generatedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpayPaymentId}|${razorpaySubscriptionId}`)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(generatedSignature),
    Buffer.from(razorpaySignature)
  );
}
