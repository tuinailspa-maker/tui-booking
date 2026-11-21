import { getComboDiscountDetails } from "@/data/comboDiscount";
import { squareMappingFor, type SquareServiceMapping } from "@/data/squareServiceMap";
import { selectedServiceDuration, serviceById, serviceDisplayName, type ServiceAddOnKey } from "@/data/serviceTree";

export const TPS_RATE_PERCENT = "5";
export const TVQ_RATE_PERCENT = "9.975";
export const MAX_BILL_GUESTS = 3;
export const MAX_AMOUNT_CENTS = 10_000_000;

export type TipChoice = "none" | "15" | "20" | "25" | "custom";
export const TIP_CHOICES: TipChoice[] = ["none", "15", "20", "25", "custom"];
const TIP_PERCENTS: Record<Exclude<TipChoice, "none" | "custom">, number> = { "15": 15, "20": 20, "25": 25 };

export type BillInput = {
  selections: string[][];
  addOns: Record<string, ServiceAddOnKey>[];
  manualDiscountCents?: number;
  subtotalOverrideCents?: number | null;
  tipChoice?: TipChoice;
  customTipCents?: number;
};

export type BillLine = {
  guestIndex: number;
  serviceId: string;
  nameEn: string;
  basePriceCents: number;
  addOnKey?: ServiceAddOnKey;
  addOnNameEn?: string;
  addOnPriceCents: number;
  priceCents: number;
  durationMinutes: number;
  /** Set only when the Square catalog variation has the exact same base price as the internal menu. */
  square: SquareServiceMapping | null;
  squarePriceMatches: boolean;
};

export type BillTotals = {
  lines: BillLine[];
  guestLines: BillLine[][];
  guestSubtotalCents: number[];
  guestComboDiscountCents: number[];
  grossSubtotalCents: number;
  comboDiscountCents: number;
  manualDiscountCents: number;
  subtotalCents: number;
  tpsCents: number;
  tvqCents: number;
  totalBeforeTipCents: number;
  tipChoice: TipChoice;
  tipCents: number;
  grandTotalCents: number;
};

const dollarsToCents = (amount: number) => Math.round(amount * 100);
const clampCents = (value: number | undefined | null) => Number.isSafeInteger(value) && Number(value) > 0 ? Math.min(Number(value), MAX_AMOUNT_CENTS) : 0;

/** Half-up rounding on the order subtotal — verified identical to Square ORDER-scope tax math. */
export function taxCents(subtotalCents: number) {
  return {
    tpsCents: Math.round((subtotalCents * 5) / 100),
    tvqCents: Math.round((subtotalCents * 9975) / 100_000),
  };
}

export function tipCentsFor(subtotalCents: number, choice: TipChoice, customTipCents = 0) {
  if (choice === "custom") return clampCents(customTipCents);
  if (choice === "none") return 0;
  return Math.round((subtotalCents * TIP_PERCENTS[choice]) / 100);
}

export function buildBillLines(selections: string[][], addOns: Record<string, ServiceAddOnKey>[]): BillLine[][] {
  return selections.map((ids, guestIndex) => ids.flatMap((serviceId) => {
    const service = serviceById.get(serviceId);
    if (!service) return [];
    const addOnKey = service.addOn && addOns[guestIndex]?.[serviceId] === service.addOn.key ? service.addOn.key : undefined;
    const basePriceCents = dollarsToCents(service.priceCad);
    const addOnPriceCents = addOnKey && service.addOn ? dollarsToCents(service.addOn.priceCad) : 0;
    const mapping = squareMappingFor(serviceId);
    return [{
      guestIndex,
      serviceId,
      nameEn: serviceDisplayName(service, "en"),
      basePriceCents,
      addOnKey,
      addOnNameEn: addOnKey ? service.addOn?.nameEn : undefined,
      addOnPriceCents,
      priceCents: basePriceCents + addOnPriceCents,
      durationMinutes: selectedServiceDuration(service, addOnKey),
      square: mapping,
      squarePriceMatches: Boolean(mapping && mapping.priceCents === basePriceCents),
    }];
  }));
}

export function calculateBill(input: BillInput): BillTotals {
  const guestLines = buildBillLines(input.selections, input.addOns);
  const guestSubtotalCents = guestLines.map((lines) => lines.reduce((sum, line) => sum + line.priceCents, 0));
  const grossSubtotalCents = guestSubtotalCents.reduce((sum, value) => sum + value, 0);

  const combo = getComboDiscountDetails(input.selections, input.addOns);
  const guestComboDiscountCents = input.selections.map((_, guestIndex) => combo.qualifyingGuests.some((guest) => guest.guestIndex === guestIndex) ? dollarsToCents(combo.amount / Math.max(1, combo.qualifyingGuests.length)) : 0);
  const comboDiscountCents = Math.min(grossSubtotalCents, guestComboDiscountCents.reduce((sum, value) => sum + value, 0));
  const manualDiscountCents = Math.min(grossSubtotalCents - comboDiscountCents, clampCents(input.manualDiscountCents));

  const hasOverride = input.subtotalOverrideCents !== undefined && input.subtotalOverrideCents !== null && Number.isSafeInteger(input.subtotalOverrideCents) && input.subtotalOverrideCents > 0;
  const subtotalCents = hasOverride ? Math.min(Number(input.subtotalOverrideCents), MAX_AMOUNT_CENTS) : Math.max(0, grossSubtotalCents - comboDiscountCents - manualDiscountCents);
  const { tpsCents, tvqCents } = taxCents(subtotalCents);
  const totalBeforeTipCents = subtotalCents + tpsCents + tvqCents;
  const tipChoice = input.tipChoice ?? "none";
  const tipCents = tipCentsFor(subtotalCents, tipChoice, input.customTipCents);

  return {
    lines: guestLines.flat(),
    guestLines,
    guestSubtotalCents,
    guestComboDiscountCents,
    grossSubtotalCents,
    comboDiscountCents,
    manualDiscountCents,
    subtotalCents,
    tpsCents,
    tvqCents,
    totalBeforeTipCents,
    tipChoice,
    tipCents,
    grandTotalCents: totalBeforeTipCents + tipCents,
  };
}

export const centsToDollars = (cents: number) => cents / 100;

type BillValidation = { value: BillInput } | { error: string };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Server-side parser for the bill payload every Square payment route accepts. */
export function parseBillInput(body: Record<string, unknown>): BillValidation {
  const { serviceIds, addOns } = body;
  if (!Array.isArray(serviceIds) || serviceIds.length < 1 || serviceIds.length > MAX_BILL_GUESTS || !Array.isArray(addOns) || addOns.length !== serviceIds.length) {
    return { error: "Provide finalized services for 1 to 3 guests." };
  }
  const selections: string[][] = [];
  const safeAddOns: Record<string, ServiceAddOnKey>[] = [];
  for (let guestIndex = 0; guestIndex < serviceIds.length; guestIndex += 1) {
    const guestServices: unknown = serviceIds[guestIndex];
    const guestAddOns: unknown = addOns[guestIndex];
    if (!Array.isArray(guestServices) || guestServices.length < 1 || guestServices.length > 30 || !isRecord(guestAddOns)) return { error: "Each guest must have at least one valid service." };
    const ids: string[] = [];
    const keys: Record<string, ServiceAddOnKey> = {};
    for (const id of guestServices) {
      const service = typeof id === "string" ? serviceById.get(id) : undefined;
      if (!service) return { error: "A selected service is not in the salon service menu." };
      ids.push(service.id);
      const addOn = guestAddOns[service.id];
      if (addOn !== undefined) {
        if (!service.addOn || addOn !== service.addOn.key) return { error: "A selected add-on is not available for that service." };
        keys[service.id] = service.addOn.key;
      }
    }
    selections.push(ids);
    safeAddOns.push(keys);
  }

  const optionalCents = (value: unknown, label: string): number | undefined | { error: string } => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_AMOUNT_CENTS) return { error: `Invalid ${label}.` };
    return value;
  };
  const manualDiscountCents = optionalCents(body.manualDiscountCents, "discount");
  const subtotalOverrideCents = optionalCents(body.subtotalOverrideCents, "subtotal override");
  const customTipCents = optionalCents(body.customTipCents, "tip amount");
  for (const value of [manualDiscountCents, subtotalOverrideCents, customTipCents]) if (isRecord(value)) return value as { error: string };
  const tipChoice = body.tipChoice === undefined ? "none" : body.tipChoice;
  if (typeof tipChoice !== "string" || !TIP_CHOICES.includes(tipChoice as TipChoice)) return { error: "Invalid tip option." };

  return {
    value: {
      selections,
      addOns: safeAddOns,
      manualDiscountCents: manualDiscountCents as number | undefined,
      subtotalOverrideCents: subtotalOverrideCents as number | undefined,
      tipChoice: tipChoice as TipChoice,
      customTipCents: customTipCents as number | undefined,
    },
  };
}

/** Client-side payload builder so every route receives the same bill inputs. */
export function billRequestPayload(input: BillInput) {
  return {
    serviceIds: input.selections,
    addOns: input.addOns,
    manualDiscountCents: input.manualDiscountCents ?? 0,
    subtotalOverrideCents: input.subtotalOverrideCents ?? null,
    tipChoice: input.tipChoice ?? "none",
    customTipCents: input.customTipCents ?? 0,
  };
}
