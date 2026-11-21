import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isAdminRequestAuthorized } from "@/data/adminAuth";
import { calculateBill, parseBillInput, type BillInput, type BillTotals } from "@/data/billing";
import { SQUARE_API_VERSION } from "@/data/squareConfig";
import { assertSquareOrderMatchesBill, buildSquareOrder, loadLiveVariations } from "@/data/squareOrder";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

class SquareError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

class NoTerminalError extends Error {
  constructor(message: string, readonly pairingCode: string | null) {
    super(message);
  }
}

function squareBaseUrl() {
  return process.env.SQUARE_ENVIRONMENT === "sandbox" ? "https://connect.squareupsandbox.com/v2" : "https://connect.squareup.com/v2";
}

function jsonError(error: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });
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
    const detail = errors
      .map((error) => isRecord(error) ? [error.code, error.detail].filter((part) => typeof part === "string" && part).join(": ") : "")
      .filter(Boolean)
      .join("; ");
    throw new SquareError(`Square ${init.method ?? "GET"} ${path.split("?")[0]} failed (HTTP ${response.status})${detail ? `: ${detail}` : "."}`, response.status);
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

type Validation<T> = { value: T } | { error: string };

function validateCheckoutInput(body: Record<string, unknown>, requireIdempotencyKey = true): Validation<TerminalCheckoutInput> {
  const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim().slice(0, 100) : "";
  const customerName = typeof body.customerName === "string" ? body.customerName.trim().slice(0, 100) : "";
  const customerPhone = typeof body.customerPhone === "string" ? body.customerPhone.trim().slice(0, 30) : "";
  const providedKey = typeof body.idempotencyKey === "string" && UUID_PATTERN.test(body.idempotencyKey) ? body.idempotencyKey : "";
  const idempotencyKey = providedKey || (requireIdempotencyKey ? "" : crypto.randomUUID());
  if (requireIdempotencyKey && (!bookingId || !idempotencyKey)) return { error: "Provide a valid booking and checkout request ID." };
  const parsed = parseBillInput(body);
  if ("error" in parsed) return parsed;
  return { value: { bookingId, customerName, customerPhone, bill: parsed.value, idempotencyKey } };
}

/** Recomputes the bill server-side from the internal price list; client totals are never trusted. */
function serverBill(input: TerminalCheckoutInput) {
  const bill = calculateBill(input.bill);
  if (bill.grandTotalCents <= 0) throw new SquareError("The checkout total must be greater than $0.00.", 400);
  return bill;
}

function checkoutNote(input: Pick<TerminalCheckoutInput, "customerName" | "customerPhone">, bill: BillTotals) {
  const dollars = (cents: number) => (cents / 100).toFixed(2);
  return [
    "Tui Nail Spa",
    input.customerName,
    input.customerPhone,
    `Subtotal ${dollars(bill.subtotalCents)} + TPS ${dollars(bill.tpsCents)} + TVQ ${dollars(bill.tvqCents)}${bill.tipCents > 0 ? ` + Tip ${dollars(bill.tipCents)}` : ""}`,
  ].filter(Boolean).join(" · ").slice(0, 500);
}

type TerminalDevice = { deviceId: string; name: string };

async function listPairedDeviceCodes(locationId: string) {
  const result = await squareRequest(`/devices/codes?location_id=${encodeURIComponent(locationId)}&product_type=TERMINAL_API&status=PAIRED`);
  const codes = isRecord(result) && Array.isArray(result.device_codes) ? result.device_codes.filter(isRecord) : [];
  return codes
    .filter((code) => typeof code.device_id === "string" && code.device_id && (!code.location_id || code.location_id === locationId))
    .sort((a, b) => String(b.status_changed_at ?? b.created_at ?? "").localeCompare(String(a.status_changed_at ?? a.created_at ?? "")))
    .map((code) => ({ deviceId: String(code.device_id), name: typeof code.name === "string" ? code.name : "Square Terminal" }));
}

async function listTerminalDevices(locationId: string) {
  const result = await squareRequest(`/devices?location_id=${encodeURIComponent(locationId)}&limit=100`);
  const devices = isRecord(result) && Array.isArray(result.devices) ? result.devices.filter(isRecord) : [];
  return devices.flatMap((device) => {
    const components = Array.isArray(device.components) ? device.components.filter(isRecord) : [];
    const runsTerminalApi = components.some((component) => isRecord(component.application_details) && component.application_details.application_type === "TERMINAL_API");
    if (!runsTerminalApi) return [];
    const attributes = isRecord(device.attributes) ? device.attributes : {};
    const serial = typeof attributes.manufacturers_id === "string" && attributes.manufacturers_id
      ? attributes.manufacturers_id
      : typeof device.id === "string" ? device.id.replace(/^device:/, "") : "";
    if (!serial) return [];
    const category = isRecord(device.status) && typeof device.status.category === "string" ? device.status.category : "UNKNOWN";
    return [{ deviceId: serial, name: typeof attributes.name === "string" ? attributes.name : "Square Terminal", category }];
  });
}

async function findPairingCode(locationId: string) {
  const existing = await squareRequest(`/devices/codes?location_id=${encodeURIComponent(locationId)}&product_type=TERMINAL_API&status=UNPAIRED`).catch(() => null);
  const unpaired = isRecord(existing) && Array.isArray(existing.device_codes) ? existing.device_codes.filter(isRecord) : [];
  const now = Date.now();
  const active = unpaired.find((code) => typeof code.code === "string" && (typeof code.pair_by !== "string" || Date.parse(code.pair_by) > now + 60_000));
  if (active) return String(active.code);
  const created = await squareRequest("/devices/codes", {
    method: "POST",
    body: JSON.stringify({ idempotency_key: crypto.randomUUID(), device_code: { name: "Tui Nail Spa Terminal", product_type: "TERMINAL_API", location_id: locationId } }),
  }).catch(() => null);
  const code = isRecord(created) && isRecord(created.device_code) ? created.device_code : null;
  return code && typeof code.code === "string" ? code.code : null;
}

async function resolveTerminalDevice(locationId: string): Promise<TerminalDevice> {
  const configured = process.env.SQUARE_TERMINAL_DEVICE_ID?.trim();
  const [devicesResult, codesResult] = await Promise.allSettled([listTerminalDevices(locationId), listPairedDeviceCodes(locationId)]);
  const devices = devicesResult.status === "fulfilled" ? devicesResult.value : [];
  const pairedCodes = codesResult.status === "fulfilled" ? codesResult.value : [];

  if (devicesResult.status === "rejected" && codesResult.status === "rejected") {
    const reason = devicesResult.reason instanceof Error ? devicesResult.reason.message : "Square device lookup failed.";
    throw new NoTerminalError(`Could not look up Square Terminal devices at this location. ${reason}`, null);
  }

  const online = devices.filter((device) => device.category === "AVAILABLE");
  const configuredOnline = configured ? online.find((device) => device.deviceId === configured) : undefined;
  if (configuredOnline) return configuredOnline;
  if (online.length > 0) return online[0];

  if (devicesResult.status === "rejected") {
    const configuredPaired = configured ? pairedCodes.find((code) => code.deviceId === configured) : undefined;
    if (configuredPaired) return configuredPaired;
    if (pairedCodes.length > 0) return pairedCodes[0];
    if (configured) return { deviceId: configured, name: "Square Terminal" };
  }

  if (devices.length > 0) {
    const summary = devices.map((device) => `${device.name} (${device.category.replace(/_/g, " ").toLowerCase()})`).join(", ");
    throw new NoTerminalError(`No Square Terminal is online at this location. Found: ${summary}. Wake the Terminal, check its Wi-Fi, and make sure it is signed in to Terminal API.`, null);
  }

  const pairingCode = await findPairingCode(locationId);
  throw new NoTerminalError(
    pairingCode
      ? `No Square Terminal is paired with this location. On the Terminal, choose "Sign in with device code" and enter ${pairingCode}, then send the order again.`
      : "No Square Terminal is paired with this location. Pair a Terminal in Square Dashboard, then send the order again.",
    pairingCode,
  );
}

async function createItemizedOrder(input: TerminalCheckoutInput, bill: BillTotals, locationId: string) {
  const live = await loadLiveVariations();
  const orderResult = await squareRequest("/orders", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: createHash("sha256").update(`tui-terminal-order:${input.idempotencyKey}`).digest("hex").slice(0, 45),
      order: buildSquareOrder(bill, live, {
        locationId,
        referenceId: input.bookingId.slice(-40),
        includeTipAsServiceCharge: false,
        metadata: { ...(input.customerName ? { customer_name: input.customerName } : {}), ...(input.customerPhone ? { customer_phone: input.customerPhone } : {}) },
      }),
    }),
  });
  const order = isRecord(orderResult) && isRecord(orderResult.order) ? orderResult.order : null;
  const orderId = order && typeof order.id === "string" ? order.id : "";
  if (!order || !orderId) throw new SquareError("Square did not return a valid order.", 502);
  assertSquareOrderMatchesBill(order, bill, false);
  return orderId;
}

async function createTerminalCheckout(input: TerminalCheckoutInput) {
  const locationId = process.env.SQUARE_LOCATION_ID!;
  const bill = serverBill(input);
  const device = await resolveTerminalDevice(locationId);

  // Attach the catalog-linked order only when Square's TPS/TVQ math matches the internal bill to the cent; otherwise charge the bill total directly.
  const orderId = await createItemizedOrder(input, bill, locationId).catch((error) => {
    console.error("[square-terminal] Itemized order creation failed; charging bill total without order.", error instanceof Error ? error.message : error);
    return null;
  });

  const terminalResult = await squareRequest("/terminals/checkouts", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: input.idempotencyKey,
      checkout: {
        amount_money: { amount: bill.totalBeforeTipCents, currency: "CAD" },
        ...(bill.tipCents > 0 ? { tip_money: { amount: bill.tipCents, currency: "CAD" } } : {}),
        ...(orderId ? { order_id: orderId } : {}),
        reference_id: input.bookingId.slice(-40),
        note: checkoutNote(input, bill),
        device_options: { device_id: device.deviceId, show_itemized_cart: Boolean(orderId), skip_receipt_screen: false, tip_settings: { allow_tipping: false } },
        payment_options: { autocomplete: true },
      },
    }),
  });
  const checkout = isRecord(terminalResult) && isRecord(terminalResult.checkout) ? terminalResult.checkout : null;
  if (!checkout || typeof checkout.id !== "string" || typeof checkout.status !== "string") throw new SquareError("Square did not return a valid Terminal checkout.", 502);
  return { checkoutId: checkout.id, orderId, status: checkout.status, amountCents: bill.totalBeforeTipCents, tipCents: bill.tipCents, grandTotalCents: bill.grandTotalCents, deviceName: device.name };
}

async function createPaymentLink(body: Record<string, unknown>, origin: string) {
  const validated = validateCheckoutInput(body, false);
  if ("error" in validated) throw new SquareError(validated.error, 400);
  const input = validated.value;
  const bill = serverBill(input);
  const result = await squareRequest("/online-checkout/payment-links", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: createHash("sha256").update(`tui-payment-link:${input.idempotencyKey}`).digest("hex").slice(0, 64),
      description: checkoutNote(input, bill).slice(0, 255),
      quick_pay: {
        name: `Tui Nail Spa${input.customerName ? ` — ${input.customerName}` : ""}`.slice(0, 255),
        price_money: { amount: bill.grandTotalCents, currency: "CAD" },
        location_id: process.env.SQUARE_LOCATION_ID,
      },
      checkout_options: { allow_tipping: false, redirect_url: `${origin}/admin?checkout=complete` },
      ...(input.bookingId ? { payment_note: `Booking ${input.bookingId}`.slice(0, 500) } : {}),
    }),
  });
  const link = isRecord(result) && isRecord(result.payment_link) ? result.payment_link : null;
  if (!link || typeof link.url !== "string") throw new SquareError("Square did not return a payment link.", 502);
  return { url: link.url, orderId: typeof link.order_id === "string" ? link.order_id : null, amountCents: bill.grandTotalCents };
}

export async function POST(request: Request) {
  if (!isAdminRequestAuthorized(request)) return jsonError("Admin authentication required.", 401);
  if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) return jsonError("Square is not configured. Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID.", 503, { fallbackAvailable: false });

  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body)) return jsonError("Invalid Square Terminal request.", 400);

  try {
    if (body.action === "checkout-status") {
      const checkoutId = typeof body.checkoutId === "string" && /^[A-Za-z0-9_-]{10,255}$/.test(body.checkoutId) ? body.checkoutId : "";
      if (!checkoutId) return jsonError("A valid Terminal checkout ID is required.", 400);
      const result = await squareRequest(`/terminals/checkouts/${encodeURIComponent(checkoutId)}`);
      const checkout = isRecord(result) && isRecord(result.checkout) ? result.checkout : null;
      if (!checkout || typeof checkout.status !== "string") throw new SquareError("Square did not return a checkout status.", 502);
      return NextResponse.json({
        status: checkout.status,
        cancelReason: typeof checkout.cancel_reason === "string" ? checkout.cancel_reason : null,
        paymentIds: Array.isArray(checkout.payment_ids) ? checkout.payment_ids : [],
      }, { headers: NO_STORE });
    }

    if (body.action === "payment-link") {
      const link = await createPaymentLink(body, new URL(request.url).origin);
      return NextResponse.json(link, { headers: NO_STORE });
    }

    const validated = validateCheckoutInput(body);
    if ("error" in validated) return jsonError(validated.error, 400, { fallbackAvailable: true });
    const checkout = await createTerminalCheckout(validated.value);
    return NextResponse.json(checkout, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof NoTerminalError) return jsonError(error.message, 409, { code: "NO_TERMINAL_DEVICE", pairingCode: error.pairingCode, fallbackAvailable: true });
    const message = error instanceof Error ? error.message : "Unable to reach Square.";
    const status = error instanceof SquareError && error.status === 400 ? 400 : 502;
    return jsonError(message, status, { fallbackAvailable: body.action !== "payment-link" });
  }
}
