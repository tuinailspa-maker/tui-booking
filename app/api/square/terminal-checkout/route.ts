import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isAdminRequestAuthorized } from "@/data/adminAuth";
import { calculateBill, parseBillInput, type BillInput } from "@/data/billing";
import { SQUARE_API_VERSION } from "@/data/squareConfig";
import { assertSquareOrderMatchesBill, buildSquareOrder, loadLiveVariations } from "@/data/squareOrder";

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
  bill: BillInput;
  idempotencyKey: string;
};

type CheckoutInputValidation = { value: TerminalCheckoutInput } | { error: string };

function validateCheckoutInput(body: Record<string, unknown>): CheckoutInputValidation {
  const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim().slice(0, 100) : "";
  const customerName = typeof body.customerName === "string" ? body.customerName.trim().slice(0, 100) : "";
  const customerPhone = typeof body.customerPhone === "string" ? body.customerPhone.trim().slice(0, 30) : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.idempotencyKey) ? body.idempotencyKey : "";
  if (!bookingId || !idempotencyKey) return { error: "Provide a valid booking and checkout request ID." };
  const parsed = parseBillInput(body);
  if ("error" in parsed) return parsed;
  return { value: { bookingId, customerName, customerPhone, bill: parsed.value, idempotencyKey } };
}

async function createSquareTerminalCheckout(input: TerminalCheckoutInput, deviceId: string) {
  const bill = calculateBill(input.bill);
  if (bill.grandTotalCents <= 0) throw new Error("The checkout total must be greater than $0.00.");

  const live = await loadLiveVariations();
  const orderKey = createHash("sha256").update(`tui-terminal-order:${input.idempotencyKey}`).digest("hex").slice(0, 45);
  const orderResult = await squareRequest("/orders", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: orderKey,
      order: buildSquareOrder(bill, live, {
        locationId: process.env.SQUARE_LOCATION_ID!,
        referenceId: input.bookingId.slice(-40),
        includeTipAsServiceCharge: false,
        metadata: { ...(input.customerName ? { customer_name: input.customerName } : {}), ...(input.customerPhone ? { customer_phone: input.customerPhone } : {}) },
      }),
    }),
  });
  const order = isRecord(orderResult) && isRecord(orderResult.order) ? orderResult.order : null;
  const orderId = order && typeof order.id === "string" ? order.id : "";
  if (!order || !orderId) throw new Error("Square did not return a valid order.");
  assertSquareOrderMatchesBill(order, bill, false);

  const note = `Tui Nail Spa${input.customerName ? ` · ${input.customerName}` : ""}${input.customerPhone ? ` · ${input.customerPhone}` : ""}`.slice(0, 500);
  const terminalResult = await squareRequest("/terminals/checkouts", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: input.idempotencyKey,
      checkout: {
        amount_money: { amount: bill.totalBeforeTipCents, currency: "CAD" },
        ...(bill.tipCents > 0 ? { tip_money: { amount: bill.tipCents, currency: "CAD" } } : {}),
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
  return { checkoutId: checkout.id, orderId, status: checkout.status, amountCents: bill.totalBeforeTipCents, tipCents: bill.tipCents, grandTotalCents: bill.grandTotalCents };
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
      const pairedDevices = await squareRequest(`/devices/codes?status=PAIRED`);
      const deviceCodes = isRecord(pairedDevices) && Array.isArray(pairedDevices.device_codes) ? pairedDevices.device_codes : [];
      const pairedDeviceCode = deviceCodes.find((candidate) =>
        isRecord(candidate)
        && candidate.status === "PAIRED"
        && candidate.location_id === locationId
        && candidate.product_type === "TERMINAL_API"
        && typeof candidate.device_id === "string"
        && candidate.device_id.length > 0,
      );
      if (isRecord(pairedDeviceCode) && typeof pairedDeviceCode.device_id === "string") {
        deviceId = pairedDeviceCode.device_id;
      } else {
        throw new Error("No paired Square Terminal was found for this location. Check that the Terminal is paired and online, or use Square Web Checkout / Payment Link instead.");
      }
    }

    const checkout = await createSquareTerminalCheckout(input, deviceId);
    return NextResponse.json(checkout, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to send this payment to Square Terminal.", 502);
  }
}
