import { NextResponse } from "next/server";
import { SQUARE_API_VERSION } from "@/data/squareConfig";

const MAX_ITEMS = 120;
const MAX_AMOUNT_CENTS = 10_000_000;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export async function POST(request: Request) {
  const input: unknown = await request.json().catch(() => null);
  if (!isRecord(input) || !Array.isArray(input.items) || input.items.length === 0 || input.items.length > MAX_ITEMS) {
    return NextResponse.json({ error: "Invalid checkout items." }, { status: 400 });
  }
  const items = input.items.flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== "string" || !item.name.trim() || item.name.length > 200 || !Number.isInteger(item.amountCents) || Number(item.amountCents) < 0 || Number(item.amountCents) > MAX_AMOUNT_CENTS) return [];
    return [{ name: item.name.trim(), amountCents: Number(item.amountCents) }];
  });
  if (items.length !== input.items.length || items.reduce((sum, item) => sum + item.amountCents, 0) <= 0) {
    return NextResponse.json({ error: "Checkout contains invalid or empty amounts." }, { status: 400 });
  }

  const subtotalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  const discountCents = Number.isInteger(input.discountCents) && Number(input.discountCents) >= 0 && Number(input.discountCents) <= subtotalCents ? Number(input.discountCents) : 0;
  const tipCents = Number.isInteger(input.tipCents) && Number(input.tipCents) >= 0 && Number(input.tipCents) <= MAX_AMOUNT_CENTS ? Number(input.tipCents) : 0;
  const customerName = typeof input.customerName === "string" ? input.customerName.trim().slice(0, 100) : "";
  const customerPhone = typeof input.customerPhone === "string" ? input.customerPhone.trim().slice(0, 30) : "";
  const locationId = process.env.SQUARE_LOCATION_ID;
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!locationId || !accessToken) return NextResponse.json({ error: "Square is not configured." }, { status: 500 });

  const money = (amount: number) => ({ amount, currency: "CAD" });
  const lineItems = [
    ...items.map((item) => ({ name: item.name, quantity: "1", base_price_money: money(item.amountCents), tax_ids: ["TVQ", "TPS"] })),
    ...(tipCents > 0 ? [{ name: "Tip", quantity: "1", base_price_money: money(tipCents) }] : []),
  ];
  const payload = {
    idempotency_key: crypto.randomUUID(),
    payment_link: {
      reference_id: (customerName || customerPhone ? `${customerName} ${customerPhone}`.trim() : `TUI-${Date.now().toString(36).toUpperCase()}`).slice(0, 40),
      description: `Tui Nail Spa${customerName ? ` — ${customerName}` : ""}${customerPhone ? ` · ${customerPhone}` : ""}`.slice(0, 255),
      order: {
        location_id: locationId,
        line_items: lineItems,
        discounts: discountCents > 0 ? [{ name: "Combo discount", type: "FIXED_AMOUNT", amount_money: money(discountCents), scope: "ORDER" }] : [],
        taxes: [
          { uid: "TVQ", name: "TVQ", type: "ADDITIVE", percentage: "9.975", scope: "LINE_ITEM" },
          { uid: "TPS", name: "TPS", type: "ADDITIVE", percentage: "5", scope: "LINE_ITEM" },
        ],
        metadata: { internal_subtotal_cents: String(subtotalCents), tip_cents: String(tipCents) },
      },
      checkout_options: { allow_tipping: false, redirect_url: `${new URL(request.url).origin}/?checkout=complete` },
    },
  };
  const baseUrl = process.env.SQUARE_ENVIRONMENT === "sandbox" ? "https://connect.squareupsandbox.com/v2" : "https://connect.squareup.com/v2";
  const response = await fetch(`${baseUrl}/online-checkout/payment-links`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Square-Version": SQUARE_API_VERSION, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(result?.errors) ? result.errors.map((error: { detail?: string }) => error.detail).filter(Boolean).join("; ") : "Square could not create a checkout link.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  const url = result?.payment_link?.url;
  if (typeof url !== "string") return NextResponse.json({ error: "Square did not return a payment link." }, { status: 502 });
  return NextResponse.json({ url, orderId: result?.payment_link?.order_id ?? null });
}
