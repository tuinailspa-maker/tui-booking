import { TPS_RATE_PERCENT, TVQ_RATE_PERCENT, type BillLine, type BillTotals } from "@/data/billing";
import { getServiceVariationLinks, type SquareServiceVariation } from "@/data/squareVariations";

type Money = { amount: number; currency: "CAD" };
const cad = (amount: number): Money => ({ amount, currency: "CAD" });

export type SquareOrderOptions = {
  locationId: string;
  referenceId: string;
  /** Payment links have no tip field, so the tip is added as a non-taxable, post-tax service charge. */
  includeTipAsServiceCharge: boolean;
  metadata?: Record<string, string>;
};

/** Internal service id -> its live Square variation. */
export async function loadLiveVariations(): Promise<Map<string, SquareServiceVariation>> {
  try {
    return await getServiceVariationLinks();
  } catch (error) {
    console.error("Square catalog lookup failed; billing every service as a custom line item:", error instanceof Error ? error.message : error);
    return new Map();
  }
}

/** Uses the catalog item only when Square's live price equals the internal price, so the bill never shifts by a cent. */
function catalogVariationFor(line: BillLine, links: Map<string, SquareServiceVariation>) {
  const variation = links.get(line.serviceId);
  return variation && variation.priceCents === line.basePriceCents ? variation : null;
}

export function buildSquareOrder(bill: BillTotals, live: Map<string, SquareServiceVariation>, options: SquareOrderOptions) {
  const lineItems: Record<string, unknown>[] = [];
  bill.lines.forEach((line, index) => {
    const uid = `tui-${index + 1}`;
    const guestNote = `Guest ${line.guestIndex + 1}`;
    const variation = catalogVariationFor(line, live);
    if (variation) {
      lineItems.push({ uid, catalog_object_id: variation.variationId, quantity: "1", note: guestNote });
      if (line.addOnPriceCents > 0) {
        lineItems.push({ uid: `${uid}-addon`, name: `${line.nameEn} + ${line.addOnNameEn ?? "Add-on"}`, quantity: "1", note: guestNote, base_price_money: cad(line.addOnPriceCents) });
      }
    } else {
      lineItems.push({
        uid,
        name: line.addOnNameEn ? `${line.nameEn} + ${line.addOnNameEn}` : line.nameEn,
        quantity: "1",
        note: guestNote,
        base_price_money: cad(line.priceCents),
      });
    }
  });

  const discounts: Record<string, unknown>[] = [];
  const adjustmentCents = bill.grossSubtotalCents - bill.subtotalCents;
  const isOverride = adjustmentCents !== bill.comboDiscountCents + bill.manualDiscountCents;
  if (!isOverride) {
    if (bill.comboDiscountCents > 0) discounts.push({ uid: "tui-combo-discount", name: "Combo discount", type: "FIXED_AMOUNT", scope: "ORDER", amount_money: cad(bill.comboDiscountCents) });
    if (bill.manualDiscountCents > 0) discounts.push({ uid: "tui-manual-discount", name: "Manual discount", type: "FIXED_AMOUNT", scope: "ORDER", amount_money: cad(bill.manualDiscountCents) });
  } else if (adjustmentCents > 0) {
    discounts.push({ uid: "tui-bill-adjustment", name: "Bill adjustment", type: "FIXED_AMOUNT", scope: "ORDER", amount_money: cad(adjustmentCents) });
  } else if (adjustmentCents < 0) {
    lineItems.push({ uid: "tui-subtotal-adjustment", name: "Subtotal adjustment", quantity: "1", base_price_money: cad(-adjustmentCents) });
  }

  return {
    location_id: options.locationId,
    reference_id: options.referenceId.slice(0, 40),
    line_items: lineItems,
    ...(discounts.length ? { discounts } : {}),
    taxes: [
      { uid: "tui-gst", name: "GST / TPS (5%)", type: "ADDITIVE", scope: "ORDER", percentage: TPS_RATE_PERCENT },
      { uid: "tui-qst", name: "QST / TVQ (9.975%)", type: "ADDITIVE", scope: "ORDER", percentage: TVQ_RATE_PERCENT },
    ],
    ...(options.includeTipAsServiceCharge && bill.tipCents > 0
      ? { service_charges: [{ uid: "tui-tip", name: "Tip", amount_money: cad(bill.tipCents), calculation_phase: "TOTAL_PHASE", taxable: false }] }
      : {}),
    metadata: {
      ...options.metadata,
      bill_subtotal_cents: String(bill.subtotalCents),
      bill_tax_cents: String(bill.tpsCents + bill.tvqCents),
      bill_tip_cents: String(bill.tipCents),
      bill_total_cents: String(options.includeTipAsServiceCharge ? bill.grandTotalCents : bill.totalBeforeTipCents),
    },
  };
}

const amountOf = (value: unknown) => {
  const money = value && typeof value === "object" ? (value as { amount?: unknown }).amount : undefined;
  return typeof money === "number" ? money : Number.NaN;
};

/** Throws if Square's computed order differs from the internal bill by even one cent. */
export function assertSquareOrderMatchesBill(order: Record<string, unknown>, bill: BillTotals, includesTip: boolean) {
  const expectedTotal = includesTip ? bill.grandTotalCents : bill.totalBeforeTipCents;
  const squareTotal = amountOf(order.total_money);
  const squareTax = amountOf(order.total_tax_money);
  if (squareTotal !== expectedTotal || squareTax !== bill.tpsCents + bill.tvqCents) {
    throw new Error(`Square order total (${(squareTotal / 100).toFixed(2)} CAD, tax ${(squareTax / 100).toFixed(2)}) does not match the bill (${(expectedTotal / 100).toFixed(2)} CAD, tax ${((bill.tpsCents + bill.tvqCents) / 100).toFixed(2)}). Payment was not sent.`);
  }
}
