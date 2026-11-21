import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isAdminRequestAuthorized } from "@/data/adminAuth";
import { SQUARE_API_VERSION } from "@/data/squareConfig";
import { selectedServicePrice, serviceById, serviceDisplayNameWithAddOn, type ServiceAddOnKey } from "@/data/serviceTree";

const MAX_AMOUNT_CENTS = 10_000_000;
const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isCents = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_AMOUNT_CENTS;

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
  serviceIds: string[][];
  addOns: Record<string, ServiceAddOnKey>[];
  subtotalCents: number;
  tpsCents: number;
  tvqCents: number;
  tipCents: number;
  totalCents: number;
  idempotencyKey: string;
};

type Validation<T> = { value: T } | { error: string };

function validateAmounts(body: Record<string, unknown>): Validation<Pick<TerminalCheckoutInput, "subtotalCents" | "tpsCents" | "tvqCents" | "tipCents" | "totalCents">> {
  const { subtotalCents, tipCents, totalCents } = body;
  if (!isCents(subtotalCents) || !isCents(tipCents) || !isCents(totalCents)) return { error: "Provide a valid bill subtotal, tip, and total in cents." };
  const tpsCents = Math.round(subtotalCents * TPS_RATE);
  const tvqCents = Math.round(subtotalCents * TVQ_RATE);
  const expectedTotal = subtotalCents + tpsCents + tvqCents + tipCents;
  // The bill rounds taxes in dollars while this rounds in cents; allow a one-cent float rounding difference per tax.
  if (Math.abs(expectedTotal - totalCents) > 2) return { error: `The bill total (${(totalCents / 100).toFixed(2)}) does not match subtotal + TPS + TVQ + tip (${(expectedTotal / 100).toFixed(2)}). Refresh the bill and try again.` };
  if (totalCents <= 0) return { error: "The checkout total must be greater than $0.00." };
  return { value: { subtotalCents, tpsCents: tpsCents + (totalCents - expectedTotal), tvqCents, tipCents, totalCents } };
}

function validateCheckoutInput(body: Record<string, unknown>): Validation<TerminalCheckoutInput> {
  const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim().slice(0, 100) : "";
  const customerName = typeof body.customerName === "string" ? body.customerName.trim().slice(0, 100) : "";
  const customerPhone = typeof body.customerPhone === "string" ? body.customerPhone.trim().slice(0, 30) : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" && UUID_PATTERN.test(body.idempotencyKey) ? body.idempotencyKey : "";
  const { serviceIds, addOns } = body;

  if (!bookingId || !idempotencyKey || !Array.isArray(serviceIds) || serviceIds.length < 1 || serviceIds.length > 3 || !Array.isArray(addOns) || addOns.length !== serviceIds.length) {
    return { error: "Provide a valid booking, services, and checkout request ID." };
  }
  const amounts = validateAmounts(body);
  if ("error" in amounts) return amounts;

  const normalizedServiceIds: string[][] = [];
  const normalizedAddOns: Record<string, ServiceAddOnKey>[] = [];
  for (let guestIndex = 0; guestIndex < serviceIds.length; guestIndex += 1) {
    const guestServices: unknown = serviceIds[guestIndex];
    const guestAddOns: unknown = addOns[guestIndex];
    if (!Array.isArray(guestServices) || guestServices.length > 30 || !isRecord(guestAddOns)) return { error: "Each guest must have valid services." };
    const validIds: string[] = [];
    const validAddOns: Record<string, ServiceAddOnKey> = {};
    for (const id of guestServices) {
      if (typeof id !== "string" || !serviceById.has(id)) return { error: "A selected service is not in the salon service menu." };
      const service = serviceById.get(id)!;
      const addOn = guestAddOns[id];
      if (addOn !== undefined && (!service.addOn || addOn !== service.addOn.key)) return { error: "A selected add-on is not available for that service." };
      validIds.push(id);
      if (addOn !== undefined) validAddOns[id] = addOn as ServiceAddOnKey;
    }
    normalizedServiceIds.push(validIds);
    normalizedAddOns.push(validAddOns);
  }

  return { value: { bookingId, customerName, customerPhone, serviceIds: normalizedServiceIds, addOns: normalizedAddOns, idempotencyKey, ...amounts.value } };
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

async function createItemizedOrder(input: TerminalCheckoutInput, locationId: string) {
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
  const adjustmentCents = input.subtotalCents - grossSubtotalCents;
  if (adjustmentCents > 0) lineItems.set("tui-subtotal-adjustment", { name: "Subtotal adjustment", quantity: 1, amountCents: adjustmentCents });
  const taxed = Array.from(lineItems.values());
  if (taxed.length === 0) return null;

  const appliedTaxes = [{ tax_uid: "tui-gst" }, { tax_uid: "tui-qst" }];
  const discountCents = adjustmentCents < 0 ? Math.min(grossSubtotalCents, -adjustmentCents) : 0;
  const orderResult = await squareRequest("/orders", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: createHash("sha256").update(`tui-terminal-order:${input.idempotencyKey}`).digest("hex").slice(0, 64),
      order: {
        location_id: locationId,
        reference_id: input.bookingId.slice(-40),
        line_items: [
          ...taxed.map((item, index) => ({
            uid: `tui-${index + 1}`,
            name: item.name,
            quantity: String(item.quantity),
            base_price_money: { amount: item.amountCents, currency: "CAD" },
            applied_taxes: appliedTaxes,
            ...(discountCents > 0 ? { applied_discounts: [{ discount_uid: "tui-bill-discount" }] } : {}),
          })),
          ...(input.tipCents > 0 ? [{ uid: "tui-tip", name: "Tip", quantity: "1", base_price_money: { amount: input.tipCents, currency: "CAD" } }] : []),
        ],
        discounts: discountCents > 0 ? [{ uid: "tui-bill-discount", name: "Bill discount", type: "FIXED_AMOUNT", scope: "LINE_ITEM", amount_money: { amount: discountCents, currency: "CAD" } }] : [],
        taxes: [
          { uid: "tui-gst", name: "TPS / GST (5%)", type: "ADDITIVE", scope: "LINE_ITEM", percentage: "5" },
          { uid: "tui-qst", name: "TVQ / QST (9.975%)", type: "ADDITIVE", scope: "LINE_ITEM", percentage: "9.975" },
        ],
        ...(input.customerName || input.customerPhone ? { metadata: { customer_name: input.customerName || "-", customer_phone: input.customerPhone || "-" } } : {}),
      },
    }),
  });
  const order = isRecord(orderResult) && isRecord(orderResult.order) ? orderResult.order : null;
  const orderId = order && typeof order.id === "string" ? order.id : "";
  const totalMoney = order && isRecord(order.total_money) ? order.total_money : null;
  const orderTotal = totalMoney && Number.isSafeInteger(totalMoney.amount) ? Number(totalMoney.amount) : null;
  return orderId ? { orderId, orderTotal } : null;
}

function checkoutNote(input: Pick<TerminalCheckoutInput, "customerName" | "customerPhone" | "subtotalCents" | "tpsCents" | "tvqCents" | "tipCents">) {
  const dollars = (cents: number) => (cents / 100).toFixed(2);
  return [
    "Tui Nail Spa",
    input.customerName,
    input.customerPhone,
    `Subtotal ${dollars(input.subtotalCents)} + TPS ${dollars(input.tpsCents)} + TVQ ${dollars(input.tvqCents)}${input.tipCents > 0 ? ` + Tip ${dollars(input.tipCents)}` : ""}`,
  ].filter(Boolean).join(" · ").slice(0, 500);
}

async function createTerminalCheckout(input: TerminalCheckoutInput) {
  const locationId = process.env.SQUARE_LOCATION_ID!;
  const device = await resolveTerminalDevice(locationId);

  // Attach the itemized order only when Square's tax math lands on the exact bill total; otherwise charge the bill total directly.
  const order = await createItemizedOrder(input, locationId).catch((error) => {
    console.error("[square-terminal] Itemized order creation failed; charging bill total without order.", error instanceof Error ? error.message : error);
    return null;
  });
  const orderId = order && order.orderTotal === input.totalCents ? order.orderId : null;

  const terminalResult = await squareRequest("/terminals/checkouts", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: input.idempotencyKey,
      checkout: {
        amount_money: { amount: input.totalCents, currency: "CAD" },
        ...(orderId ? { order_id: orderId } : {}),
        reference_id: input.bookingId.slice(-40),
        note: checkoutNote(input),
        device_options: { device_id: device.deviceId, show_itemized_cart: Boolean(orderId), skip_receipt_screen: false, tip_settings: { allow_tipping: false } },
        payment_options: { autocomplete: true },
      },
    }),
  });
  const checkout = isRecord(terminalResult) && isRecord(terminalResult.checkout) ? terminalResult.checkout : null;
  if (!checkout || typeof checkout.id !== "string" || typeof checkout.status !== "string") throw new SquareError("Square did not return a valid Terminal checkout.", 502);
  return { checkoutId: checkout.id, orderId, status: checkout.status, amountCents: input.totalCents, deviceName: device.name };
}

async function createPaymentLink(body: Record<string, unknown>, origin: string) {
  const amounts = validateAmounts(body);
  if ("error" in amounts) throw new SquareError(amounts.error, 400);
  const idempotencyKey = typeof body.idempotencyKey === "string" && UUID_PATTERN.test(body.idempotencyKey) ? body.idempotencyKey : crypto.randomUUID();
  const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim().slice(0, 100) : "";
  const customerName = typeof body.customerName === "string" ? body.customerName.trim().slice(0, 100) : "";
  const customerPhone = typeof body.customerPhone === "string" ? body.customerPhone.trim().slice(0, 30) : "";
  const result = await squareRequest("/online-checkout/payment-links", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: createHash("sha256").update(`tui-payment-link:${idempotencyKey}`).digest("hex").slice(0, 64),
      description: checkoutNote({ customerName, customerPhone, ...amounts.value }).slice(0, 255),
      quick_pay: {
        name: `Tui Nail Spa${customerName ? ` — ${customerName}` : ""}`.slice(0, 255),
        price_money: { amount: amounts.value.totalCents, currency: "CAD" },
        location_id: process.env.SQUARE_LOCATION_ID,
      },
      checkout_options: { allow_tipping: false, redirect_url: `${origin}/admin?checkout=complete` },
      ...(bookingId ? { payment_note: `Booking ${bookingId}`.slice(0, 500) } : {}),
    }),
  });
  const link = isRecord(result) && isRecord(result.payment_link) ? result.payment_link : null;
  if (!link || typeof link.url !== "string") throw new SquareError("Square did not return a payment link.", 502);
  return { url: link.url, orderId: typeof link.order_id === "string" ? link.order_id : null, amountCents: amounts.value.totalCents };
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
