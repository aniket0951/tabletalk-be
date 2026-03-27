import { offerRepository } from "../repositories/offer.repository";
import { OFFER_TYPE, DISCOUNT_TYPE } from "../lib/constants";

interface OfferRow {
  id: string;
  type: string;
  discountType: string;
  discountValue: number;
  minOrderAmount: number | null;
  maxDiscount: number | null;
  menuItemIds: string[];
  categoryIds: string[];
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  startDate: Date | null;
  endDate: Date | null;
  promoCode: string | null;
  usageLimit: number | null;
  usageCount: number;
  active: boolean;
}

interface OrderItemInput {
  menuItemId: string;
  categoryId: string;
  unitPrice: number;
  quantity: number;
}

export interface AppliedDiscount {
  offerId: string;
  offerName: string;
  type: "ITEM_DISCOUNT" | "BILL_DISCOUNT";
  discountAmount: number;
  description: string;
}

export interface DiscountResult {
  appliedDiscounts: AppliedDiscount[];
  totalDiscount: number;
}

function isScheduleActive(offer: OfferRow, now: Date): boolean {
  // Check date range
  if (offer.startDate && now < offer.startDate) return false;
  if (offer.endDate && now > offer.endDate) return false;

  // Check day of week (0=Sun..6=Sat)
  if (offer.daysOfWeek.length > 0 && !offer.daysOfWeek.includes(now.getDay())) return false;

  // Check time window (HH:MM format, in local time)
  if (offer.startTime && offer.endTime) {
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (hhmm < offer.startTime || hhmm > offer.endTime) return false;
  }

  return true;
}

function isEligible(offer: OfferRow, promoCode?: string): boolean {
  if (!offer.active) return false;

  // If offer requires a promo code, check it
  if (offer.promoCode) {
    if (!promoCode || promoCode.toUpperCase() !== offer.promoCode.toUpperCase()) return false;
  }

  // Check usage limit
  if (offer.usageLimit != null && offer.usageCount >= offer.usageLimit) return false;

  return true;
}

function calcDiscount(discountType: string, discountValue: number, amount: number, maxDiscount: number | null): number {
  let disc = discountType === DISCOUNT_TYPE.PERCENTAGE
    ? Math.round(amount * (discountValue / 100) * 100) / 100
    : discountValue;

  if (maxDiscount != null && disc > maxDiscount) disc = maxDiscount;
  if (disc > amount) disc = amount;

  return Math.round(disc * 100) / 100;
}

export function calculateDiscounts(
  offers: OfferRow[],
  items: OrderItemInput[],
  subtotal: number,
  promoCode?: string,
  now = new Date(),
): DiscountResult {
  const applied: AppliedDiscount[] = [];

  const eligible = offers.filter((o) => isScheduleActive(o, now) && isEligible(o, promoCode));

  // --- Item discounts: pick best single item offer ---
  const itemOffers = eligible.filter((o) => o.type === OFFER_TYPE.ITEM_DISCOUNT);
  let bestItemDiscount: AppliedDiscount | null = null;

  for (const offer of itemOffers) {
    let discountAmount = 0;
    const matchedItems: string[] = [];

    for (const item of items) {
      const matchesItem = offer.menuItemIds.length === 0 || offer.menuItemIds.includes(item.menuItemId);
      const matchesCat = offer.categoryIds.length === 0 || offer.categoryIds.includes(item.categoryId);

      if (matchesItem && matchesCat) {
        const itemTotal = item.unitPrice * item.quantity;
        discountAmount += calcDiscount(offer.discountType, offer.discountValue, itemTotal, null);
        matchedItems.push(item.menuItemId);
      }
    }

    // Apply maxDiscount cap to total item discount
    if (offer.maxDiscount != null && discountAmount > offer.maxDiscount) {
      discountAmount = offer.maxDiscount;
    }

    if (discountAmount > 0 && (!bestItemDiscount || discountAmount > bestItemDiscount.discountAmount)) {
      const pct = offer.discountType === DISCOUNT_TYPE.PERCENTAGE;
      bestItemDiscount = {
        offerId: offer.id,
        offerName: "",
        type: "ITEM_DISCOUNT",
        discountAmount: Math.round(discountAmount * 100) / 100,
        description: pct
          ? `${offer.discountValue}% off on items`
          : `₹${offer.discountValue} off on items`,
      };
    }
  }

  if (bestItemDiscount) applied.push(bestItemDiscount);

  // --- Bill discounts: pick best single bill offer ---
  const billOffers = eligible.filter((o) => o.type === OFFER_TYPE.BILL_DISCOUNT);
  let bestBillDiscount: AppliedDiscount | null = null;

  const afterItemDiscount = subtotal - (bestItemDiscount?.discountAmount || 0);

  for (const offer of billOffers) {
    if (offer.minOrderAmount != null && afterItemDiscount < offer.minOrderAmount) continue;

    const discountAmount = calcDiscount(offer.discountType, offer.discountValue, afterItemDiscount, offer.maxDiscount);

    if (discountAmount > 0 && (!bestBillDiscount || discountAmount > bestBillDiscount.discountAmount)) {
      const pct = offer.discountType === DISCOUNT_TYPE.PERCENTAGE;
      bestBillDiscount = {
        offerId: offer.id,
        offerName: "",
        type: "BILL_DISCOUNT",
        discountAmount,
        description: pct
          ? `${offer.discountValue}% off on bill`
          : `₹${offer.discountValue} off on bill`,
      };
    }
  }

  if (bestBillDiscount) applied.push(bestBillDiscount);

  const totalDiscount = applied.reduce((sum, d) => sum + d.discountAmount, 0);

  return { appliedDiscounts: applied, totalDiscount: Math.round(totalDiscount * 100) / 100 };
}

export function validateOffer(body: Record<string, unknown>): string | null {
  if (!body.name || typeof body.name !== "string") return "Name is required";
  if (!body.type || !["ITEM_DISCOUNT", "BILL_DISCOUNT"].includes(body.type as string)) return "Invalid offer type";
  if (!body.discountType || !["PERCENTAGE", "FLAT"].includes(body.discountType as string)) return "Invalid discount type";

  const val = Number(body.discountValue);
  if (!val || val <= 0) return "Discount value must be positive";
  if (body.discountType === "PERCENTAGE" && val > 100) return "Percentage cannot exceed 100";

  if (body.minOrderAmount != null && Number(body.minOrderAmount) < 0) return "Min order amount cannot be negative";
  if (body.maxDiscount != null && Number(body.maxDiscount) < 0) return "Max discount cannot be negative";

  return null;
}

export const offerService = {
  calculateDiscounts,
  validateOffer,
};
