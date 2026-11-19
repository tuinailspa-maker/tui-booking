export const COMBO_DISCOUNT_THRESHOLD_CAD = 85;
export const COMBO_DISCOUNT_AMOUNT_CAD = 5;

export function getComboDiscount(serviceIds: string[], subtotal: number) {
  const hasHands = serviceIds.some((id) => id.startsWith("hands-"));
  const hasFeet = serviceIds.some((id) => id.startsWith("feet-"));
  return hasHands && hasFeet && subtotal >= COMBO_DISCOUNT_THRESHOLD_CAD ? COMBO_DISCOUNT_AMOUNT_CAD : 0;
}
