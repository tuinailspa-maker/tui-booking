import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isAdminRequestAuthorized } from "@/data/adminAuth";
import { SQUARE_API_VERSION } from "@/data/squareConfig";
import { getComboDiscountDetails } from "@/data/comboDiscount";
import { serviceById, selectedServicePrice, serviceDisplayNameWithAddOn, type ServiceAddOnKey } from "@/data/serviceTree";

const SQUARE_PRODUCTION_URL = "https://connect.squareup.com/v2";
const SQUARE_SANDBOX_URL = "https://connect.squareupsandbox.com/v2";
type ManualDiscount = { type: "FIXED_AMOUNT" | "PERCENTAGE"; value: number };
type SquareLineItem = { name: string; quantity: string; base_price_money: { amount: bigint; currency: "CAD" } };

function squareBaseUrl() {
  return process.env.SQUARE_ENVIRONMENT === "sandbox" ? SQUARE_SANDBOX_URL : SQUARE_PRODUCTION_URL;
}

export async function POST(request: Request) {
  if (!isAdminRequestAuthorized(request)) {
    return NextResponse.json({ error: "Admin authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) {
    return NextResponse.json({ error: "Square is not configured. Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const body = await request.json().catch(() => null);
  const bookingId = typeof body?.bookingId === "string" ? body.bookingId.trim() : "";
  const customerName = typeof body?.customerName === "string" ? body.customerName.trim().slice(0, 100) : "";
  const customerPhone = typeof body?.customerPhone === "string" ? body.customerPhone.trim().slice(0, 30) : "";
  const serviceIds = body?.serviceIds;
  const addOns = body?.addOns;
  const manualDiscount = body?.manualDiscount as ManualDiscount | null;

  if (!bookingId || bookingId.length > 100 || !customerName || !customerPhone || !Array.isArray(serviceIds) || !serviceIds.length || serviceIds.length > 3 || !Array.isArray(addOns) || addOns.length !== serviceIds.length) {
    return NextResponse.json({ error: "Provide a booking ID, guest name and phone, and finalized services for each guest." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  if (manualDiscount !== null && manualDiscount !== undefined && (!manualDiscount || !["FIXED_AMOUNT", "PERCENTAGE"].includes(manualDiscount.type) || !Number.isFinite(manualDiscount.value) || manualDiscount.value <= 0 || (manualDiscount.type === "PERCENTAGE" && manualDiscount.value > 100))) {
    return NextResponse.json({ error: "Enter a valid fixed or percentage discount." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const normalizedServiceIds: string[][] = [];
  const normalizedAddOns: Record<string, ServiceAddOnKey>[] = [];
  for (let guestIndex = 0; guestIndex < serviceIds.length; guestIndex += 1) {
    const guestServices: unknown = serviceIds[guestIndex];
    const guestAddOns: unknown = addOns[guestIndex];
    if (!Array.isArray(guestServices) || !guestServices.length || guestServices.length > 30 || !guestAddOns || typeof guestAddOns !== "object" || Array.isArray(guestAddOns)) {
      return NextResponse.json({ error: "Each guest must have at least one valid service." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const safeIds: string[] = [];
    const safeAddOns: Record<string, ServiceAddOnKey> = {};
    for (const id of guestServices) {
      if (typeof id !== "string" || !serviceById.has(id)) {
        return NextResponse.json({ error: "A selected service is not in the salon service menu." }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      safeIds.push(id);
      const service = serviceById.get(id)!;
      const addOn = (guestAddOns as Record<string, unknown>)[id];
      if (addOn !== undefined) {
        if (!service.addOn || addOn !== service.addOn.key) {
          return NextResponse.json({ error: "A selected add-on is not available for that service." }, { status: 400, headers: { "Cache-Control": "no-store" } });
        }
        safeAddOns[id] = addOn as ServiceAddOnKey;
      }
    }
    normalizedServiceIds.push(safeIds);
    normalizedAddOns.push(safeAddOns);
  }

  const lineItemsByKey = new Map<string, SquareLineItem>();
  let subtotalCents = 0;
  for (let guestIndex = 0; guestIndex < normalizedServiceIds.length; guestIndex += 1) {
    for (const id of normalizedServiceIds[guestIndex]) {
      const service = serviceById.get(id)!;
      const addOnKey = normalizedAddOns[guestIndex][id];
      const priceCents = Math.round(selectedServicePrice(service, addOnKey) * 100);
      const name = serviceDisplayNameWithAddOn(service, "en", addOnKey);
      subtotalCents += priceCents;
      const key = `${name}\u0000${priceCents}`;
      const existing = lineItemsByKey.get(key);
      if (existing) existing.quantity = String(Number(existing.quantity) + 1);
      else lineItemsByKey.set(key, { name, quantity: "1", base_price_money: { amount: BigInt(priceCents), currency: "CAD" } });
    }
  }

  const comboDiscount = getComboDiscountDetails(normalizedServiceIds, normalizedAddOns).amount;
  const comboDiscountCents = Math.min(subtotalCents, Math.round(comboDiscount * 100));
  const manualDiscountCents = manualDiscount?.type === "FIXED_AMOUNT" ? Math.round(manualDiscount.value * 100) : 0;
  if (manualDiscount?.type === "FIXED_AMOUNT" && manualDiscountCents > subtotalCents - comboDiscountCents) {
    return NextResponse.json({ error: "The discount cannot exceed the remaining service subtotal." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (manualDiscount?.type === "PERCENTAGE" && comboDiscountCents >= subtotalCents) {
    return NextResponse.json({ error: "A percentage discount cannot be applied to a zero balance." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const discounts = [] as Record<string, unknown>[];
  if (comboDiscountCents > 0) discounts.push({ uid: "tui-combo-discount", name: "Combo discount", type: "FIXED_AMOUNT", scope: "ORDER", amount_money: { amount: comboDiscountCents, currency: "CAD" } });
  if (manualDiscount?.type === "FIXED_AMOUNT" && manualDiscountCents > 0) discounts.push({ uid: "tui-manual-discount", name: "Manual discount", type: "FIXED_AMOUNT", scope: "ORDER", amount_money: { amount: manualDiscountCents, currency: "CAD" } });
  if (manualDiscount?.type === "PERCENTAGE") discounts.push({ uid: "tui-manual-discount", name: "Manual discount", type: "PERCENTAGE", scope: "ORDER", percentage: String(manualDiscount.value) });

  const identity = createHash("sha256").update(bookingId).digest("base64url").slice(0, 32);
  const referenceId = bookingId.length <= 40 ? bookingId : bookingId.slice(-40);
  const order = {
    location_id: process.env.SQUARE_LOCATION_ID,
    reference_id: referenceId,
    line_items: Array.from(lineItemsByKey.values()).map((item) => ({ ...item, base_price_money: { ...item.base_price_money, amount: Number(item.base_price_money.amount) } })),
    discounts,
    taxes: [
      { uid: "tui-gst", name: "GST 5%", type: "ADDITIVE", scope: "ORDER", percentage: "5" },
      { uid: "tui-qst", name: "QST 9.975%", type: "ADDITIVE", scope: "ORDER", percentage: "9.975" },
    ],
    fulfillments: [{
      type: "PICKUP",
      state: "PROPOSED",
      pickup_details: { recipient: { display_name: customerName, phone_number: customerPhone } },
    }],
  };

  try {
    const response = await fetch(`${squareBaseUrl()}/orders`, {
      method: "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`, "Square-Version": SQUARE_API_VERSION, "Content-Type": "application/json" },
      body: JSON.stringify({ idempotency_key: `tui-order-${identity}`, order }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = Array.isArray(result.errors) ? result.errors.map((error: { detail?: string }) => error.detail).filter(Boolean).join("; ") : "";
      return NextResponse.json({ error: details || `Square returned HTTP ${response.status}.` }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    if (!result.order?.id) throw new Error("Square did not return an order ID.");
    return NextResponse.json({ success: true, squareOrderId: result.order.id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send the order to Square.";
    return NextResponse.json({ error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
