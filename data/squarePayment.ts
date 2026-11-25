/** Exact amounts Square charged for a booking's checkout, in cents. Safe to import on the client. */
export type SquarePaymentSummary = {
  orderId: string;
  paidAt: string;
  paymentMethod: "Card" | "Cash";
  subtotalCents: number;
  discountCents: number;
  tpsCents: number;
  tvqCents: number;
  tipCents: number;
  totalCents: number;
};
