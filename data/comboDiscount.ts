import { selectedServicePrice, serviceById, type ServiceAddOnKey } from "@/data/serviceTree";

export const COMBO_DISCOUNT_THRESHOLD_CAD = 85;
export const COMBO_DISCOUNT_AMOUNT_CAD = 5;

export type ComboDiscountGuest = { guestIndex: number; subtotal: number };

export function getComboDiscountDetails(guestServiceIds: string[][], guestAddOns: Record<string, ServiceAddOnKey>[] = []): { amount: number; qualifyingGuests: ComboDiscountGuest[] } {
  const qualifyingGuests = guestServiceIds.flatMap((serviceIds, guestIndex) => {
    const subtotal = serviceIds.reduce((sum, id) => {
      const service = serviceById.get(id);
      return sum + (service ? selectedServicePrice(service, guestAddOns[guestIndex]?.[id]) : 0);
    }, 0);
    const hasHands = serviceIds.some((id) => id.startsWith("hands-") || id.startsWith("enhancement-"));
    const hasFeet = serviceIds.some((id) => id.startsWith("feet-"));
    return hasHands && hasFeet && subtotal >= COMBO_DISCOUNT_THRESHOLD_CAD ? [{ guestIndex, subtotal }] : [];
  });
  return { amount: qualifyingGuests.length * COMBO_DISCOUNT_AMOUNT_CAD, qualifyingGuests };
}
