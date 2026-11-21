import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { calculateBill, parseBillInput } from "@/data/billing";
import { SQUARE_API_VERSION } from "@/data/squareConfig";
import { assertSquareOrderMatchesBill, buildSquareOrder, loadLiveVariations } from "@/data/squareOrder";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body)) return jsonError("Invalid checkout request.", 400);
  const parsed = parseBillInput(body);
  if ("error" in parsed) return jsonError(parsed.error, 400);

  const bill = calculateBill(parsed.value);
  if (bill.grandTotalCents <= 0) return jsonError("The bill total must be greater than $0.00.", 400);

  const locationId = process.env.SQUARE_LOCATION_ID;
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!locationId || !accessToken) return jsonError("Square is not configured.", 500);

  const customerName = typeof body.customerName === "string" ? body.customerName.trim().slice(0, 100) : "";
  const customerPhone = typeof body.customerPhone === "string" ? body.customerPhone.trim().slice(0, 30) : "";
  const bookingId = typeof body.bookingId === "string" ? body.bookingId.trim().slice(0, 100) : "";
  const requestKey = typeof body.idempotencyKey === "string" && /^[0-9a-f-]{36}$/i.test(body.idempotencyKey) ? body.idempotencyKey : crypto.randomUUID();

  const live = await loadLiveVariations();
  const order = buildSquareOrder(bill, live, {
    locationId,
    referenceId: bookingId || `TUI-${Date.now().toString(36).toUpperCase()}`,
    includeTipAsServiceCharge: true,
    metadata: { ...(customerName ? { customer_name: customerName } : {}), ...(customerPhone ? { customer_phone: customerPhone } : {}) },
  });

  const response = await fetch(`${process.env.SQUARE_ENVIRONMENT === "sandbox" ? "https://connect.squareupsandbox.com/v2" : "https://connect.squareup.com/v2"}/online-checkout/payment-links`, {
    method: "POST",
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}`, "Square-Version": SQUARE_API_VERSION, "Content-Type": "application/json" },
    body: JSON.stringify({
      idempotency_key: createHash("sha256").update(`tui-payment-link:${requestKey}`).digest("hex").slice(0, 45),
      description: `Tui Nail Spa${customerName ? ` — ${customerName}` : ""}${customerPhone ? ` · ${customerPhone}` : ""}`.slice(0, 255),
      order,
      checkout_options: { allow_tipping: false, redirect_url: `${new URL(request.url).origin}/?checkout=complete` },
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(result?.errors) ? result.errors.map((error: { detail?: string }) => error.detail).filter(Boolean).join("; ") : "";
    return jsonError(message || "Square could not create a checkout link.", 502);
  }
  const url = result?.payment_link?.url;
  if (typeof url !== "string") return jsonError("Square did not return a payment link.", 502);

  const squareOrder = Array.isArray(result?.related_resources?.orders) ? result.related_resources.orders[0] : null;
  if (isRecord(squareOrder)) {
    try {
      assertSquareOrderMatchesBill(squareOrder, bill, true);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Square total does not match the bill.", 502);
    }
  }
  return NextResponse.json({ url, orderId: result?.payment_link?.order_id ?? null, totalCents: bill.grandTotalCents }, { headers: { "Cache-Control": "no-store" } });
}
