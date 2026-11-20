import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isAdminRequestAuthorized } from "@/data/adminAuth";
import { SQUARE_API_VERSION } from "@/data/squareConfig";
import { selectedServicePrice, serviceById, serviceDisplayNameWithAddOn, type ServiceAddOnKey } from "@/data/serviceTree";

const MAX_AMOUNT_CENTS = 10_000_000;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function squareBaseUrl() {
  return process.env.SQUARE_ENVIRONMENT === "sandbox" ? "https://connect.squareupsandbox.com/v2" : "https://connect.squareup.com/v2";
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

async function squareRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${squareBaseUrl()}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      "Square-Version": SQUARE_API_VERSION,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errors = isRecord(result) && Array.isArray(result.errors) ? result.errors : [];
    const detail = errors.map((error) => isRecord(error) && typeof error.detail === "string" ? error.detail : "").filter(Boolean).join("; ");
    throw new Error(detail || `Square returned HTTP ${response.status}.`);
  }
  return result;
}

type TerminalCheckoutInput = {
  bookingId: string;
  customerName: string;
  customerPhone: string;
  serviceIds: string[][];
  addOns: Record<string, ServiceAddOnKey>[];
  subtotalCents: number;
  tipCents: number;
  idempotencyKey: string;
};

type CheckoutInputValidation = { value: TerminalCheckoutInput } | { error: string };

function validateCheckoutInput(body: Record<string, unknown>): CheckoutInputValidation {
  const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim().slice(0, 100) : "";
  const customerName = typeof body.customerName === "string" ? body.customerName.trim().slice(0, 100) : "";
  const customerPhone = typeof body.customerPhone === "string" ? body.customerPhone.trim().slice(0, 30) : "";
  const serviceIds = body.serviceIds;
  const addOns = body.addOns;
  const subtotalCents = body.subtotalCents;
  const tipCents = body.tipCents;
  const idempotencyKey = typeof body.idempotencyKey === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.idempotencyKey) ? body.idempotencyKey : "";

  if (!bookingId || !idempotencyKey || !Array.isArray(serviceIds) || serviceIds.length < 1 || serviceIds.length > 3 || !Array.isArray(addOns) || addOns.length !== serviceIds.length || typeof subtotalCents !== "number" || !Number.isSafeInteger(subtotalCents) || subtotalCents < 0 || subtotalCents > MAX_AMOUNT_CENTS || typeof tipCents !== "number" || !Number.isSafeInteger(tipCents) || tipCents < 0 || tipCents > MAX_AMOUNT_CENTS) {
    return { error: "Provide a valid booking, services, bill subtotal, tip, and checkout request ID." } as const;
  }

  const normalizedServiceIds: string[][] = [];
  const normalizedAddOns: Record<string, ServiceAddOnKey>[] = [];
  for (let guestIndex = 0; guestIndex < serviceIds.length; guestIndex += 1) {
    const guestServices = serviceIds[guestIndex];
    const guestAddOns = addOns[guestIndex];
    if (!Array.isArray(guestServices) || guestServices.length < 1 || guestServices.length > 30 || !isRecord(guestAddOns)) return { error: "Each guest must have at least one valid service." } as const;
    const validIds: string[] = [];
    const validAddOns: Record<string, ServiceAddOnKey> = {};
    for (const id of guestServices) {
      if (typeof id !== "string" || !serviceById.has(id)) return { error: "A selected service is not in the salon service menu." } as const;
      const service = serviceById.get(id)!;
      const addOn = guestAddOns[id];
      if (addOn !== undefined && (!service.addOn || addOn !== service.addOn.key)) return { error: "A selected add-on is not available for that service." } as const;
      validIds.push(id);
      if (addOn !== undefined) validAddOns[id] = addOn as ServiceAddOnKey;
    }
    normalizedServiceIds.push(validIds);
    normalizedAddOns.push(validAddOns);
  }

  return {
    value: {
      bookingId,
      customerName,
      customerPhone,
      serviceIds: normalizedServiceIds,
      addOns: normalizedAddOns,
      subtotalCents: Number(subtotalCents),
      tipCents: Number(tipCents),
      idempotencyKey,
    },
  } as const;
}

async function createSquareTerminalCheckout(input: TerminalCheckoutInput, deviceId: string) {
  const locationId = process.env.SQUARE_LOCATION_ID!;
  const lineItems = new Map<string, { name: string; quantity: number; amountCents: number }>();
  let grossSubtotalCents = 0;
  for (let guestIndex = 0; guestIndex < input.serviceIds.length; guestIndex += 1) {
    for (const id of input.serviceIds[guestIndex]) {
      const service = serviceById.get(id)!;
      const addOn = input.addOns[guestIndex][id];
      const amountCents = Math.round(selectedServicePrice(service, addOn) * 100);
      const name = serviceDisplayNameWithAddOn(service, "en", addOn);
      grossSubtotalCents += amountCents;
      const key = `${name}\u0000${amountCents}`;
      const existing = lineItems.get(key);
      if (existing) existing.quantity += 1;
      else lineItems.set(key, { name, quantity: 1, amountCents });
    }
  }

  const billSubtotalCents = input.subtotalCents;
  if (billSubtotalCents + input.tipCents <= 0) throw new Error("The checkout total must be greater than $0.00.");

  const adjustmentCents = billSubtotalCents - grossSubtotalCents;
  const discounts = adjustmentCents < 0 ? [{
    uid: "tui-terminal-bill-discount",
    name: "Bill discount",
    type: "FIXED_AMOUNT",
    scope: "ORDER",
    amount_money: { amount: Math.min(grossSubtotalCents, -adjustmentCents), currency: "CAD" },
  }] : [];
  if (adjustmentCents > 0) lineItems.set("tui-subtotal-adjustment", { name: "Subtotal adjustment", quantity: 1, amountCents: adjustmentCents });

  const orderKey = createHash("sha256").update(`tui-terminal-order:${input.idempotencyKey}`).digest("hex");
  const orderResult = await squareRequest("/orders", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: orderKey,
      order: {
        location_id: locationId,
        reference_id: input.bookingId.slice(-40),
        line_items: Array.from(lineItems.values()).map((item, index) => ({
          uid: `tui-${index + 1}`,
          name: item.name,
          quantity: String(item.quantity),
          base_price_money: { amount: item.amountCents, currency: "CAD" },
        })),
        discounts,
        taxes: [
          { uid: "tui-gst", name: "GST / TPS (5%)", type: "ADDITIVE", scope: "ORDER", percentage: "5" },
          { uid: "tui-qst", name: "QST / TVQ (9.975%)", type: "ADDITIVE", scope: "ORDER", percentage: "9.975" },
        ],
        ...(input.customerName || input.customerPhone ? { metadata: { customer_name: input.customerName, customer_phone: input.customerPhone } } : {}),
      },
    }),
  });
  const order = isRecord(orderResult) && isRecord(orderResult.order) ? orderResult.order : null;
  const orderId = order && typeof order.id === "string" ? order.id : "";
  const totalMoney = order && isRecord(order.total_money) ? order.total_money : null;
  const amountCents = totalMoney && Number.isSafeInteger(totalMoney.amount) ? Number(totalMoney.amount) : null;
  if (!orderId || amountCents === null || amountCents <= 0) throw new Error("Square did not return a valid taxed order total.");

  const note = `Tui Nail Spa${input.customerName ? ` · ${input.customerName}` : ""}${input.customerPhone ? ` · ${input.customerPhone}` : ""}`.slice(0, 500);
  const terminalResult = await squareRequest("/terminals/checkouts", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: input.idempotencyKey,
      checkout: {
        amount_money: { amount: amountCents, currency: "CAD" },
        ...(input.tipCents > 0 ? { tip_money: { amount: input.tipCents, currency: "CAD" } } : {}),
        order_id: orderId,
        reference_id: input.bookingId.slice(-40),
        note,
        device_options: { device_id: deviceId, show_itemized_cart: true, tip_settings: { allow_tipping: false } },
        payment_options: { autocomplete: true },
      },
    }),
  });
  const checkout = isRecord(terminalResult) && isRecord(terminalResult.checkout) ? terminalResult.checkout : null;
  if (!checkout || typeof checkout.id !== "string" || typeof checkout.status !== "string") throw new Error("Square did not return a valid Terminal checkout.");
  return { checkoutId: checkout.id, orderId, status: checkout.status, amountCents, tipCents: input.tipCents };
}

export async function POST(request: Request) {
  if (!isAdminRequestAuthorized(request)) return jsonError("Admin authentication required.", 401);
  if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) return jsonError("Square is not configured. Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID.", 503);

  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body)) return jsonError("Invalid Square Terminal request.", 400);

  try {
    if (body.action === "checkout-status") {
      const checkoutId = typeof body.checkoutId === "string" && /^[A-Za-z0-9_-]{10,255}$/.test(body.checkoutId) ? body.checkoutId : "";
      if (!checkoutId) return jsonError("A valid Terminal checkout ID is required.", 400);
      const result = await squareRequest(`/terminals/checkouts/${encodeURIComponent(checkoutId)}`, { method: "GET" });
      const checkout = isRecord(result) && isRecord(result.checkout) ? result.checkout : null;
      if (!checkout || typeof checkout.status !== "string") throw new Error("Square did not return a checkout status.");
      return NextResponse.json({ status: checkout.status, paymentIds: Array.isArray(checkout.payment_ids) ? checkout.payment_ids : [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const validated = validateCheckoutInput(body);
    if ("error" in validated) return jsonError(validated.error, 400);
    const input = validated.value;
    const locationId = process.env.SQUARE_LOCATION_ID;
    let deviceId = process.env.SQUARE_TERMINAL_DEVICE_ID;

    if (body.action === "pairing-status") {
      const deviceCodeId = typeof body.deviceCodeId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(body.deviceCodeId) ? body.deviceCodeId : "";
      if (!deviceCodeId) return jsonError("A valid Terminal pairing request is required.", 400);
      const result = await squareRequest(`/devices/codes/${encodeURIComponent(deviceCodeId)}`, { method: "GET" });
      const code = isRecord(result) && isRecord(result.device_code) ? result.device_code : null;
      if (!code || code.location_id !== locationId || code.product_type !== "TERMINAL_API") return jsonError("The Terminal pairing code does not match this Square location.", 400);
      if (code.status !== "PAIRED" || typeof code.device_id !== "string") {
        if (code.status === "UNPAIRED") return NextResponse.json({ pairingRequired: true, deviceCodeId, pairingCode: typeof code.code === "string" ? code.code : undefined, pairBy: code.pair_by ?? null }, { headers: { "Cache-Control": "no-store" } });
        return jsonError("This Terminal pairing code expired or was canceled. Start pairing again.", 410);
      }
      deviceId = code.device_id;
    }

    if (!deviceId) {
      const pairingResult = await squareRequest("/devices/codes", {
        method: "POST",
        body: JSON.stringify({
          idempotency_key: crypto.randomUUID(),
          device_code: { name: "Tui Nail Spa Terminal", product_type: "TERMINAL_API", location_id: locationId },
        }),
      });
      const code = isRecord(pairingResult) && isRecord(pairingResult.device_code) ? pairingResult.device_code : null;
      if (!code || typeof code.id !== "string" || typeof code.code !== "string") throw new Error("Square did not return a Terminal pairing code.");
      return NextResponse.json({ pairingRequired: true, deviceCodeId: code.id, pairingCode: code.code, pairBy: code.pair_by ?? null }, { headers: { "Cache-Control": "no-store" } });
    }

    const checkout = await createSquareTerminalCheckout(input, deviceId);
    return NextResponse.json(checkout, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to send this payment to Square Terminal.", 502);
  }
}
