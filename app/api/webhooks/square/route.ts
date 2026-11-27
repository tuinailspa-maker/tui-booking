import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after, NextResponse } from "next/server";
import { orderBusinessDate, syncSquareDate, torontoDate } from "@/data/squareCheckoutSync";
import { clearSquareVariationCache } from "@/data/squareVariations";
import { bumpSquareSyncVersion } from "@/data/squareSync";

const DEFAULT_NOTIFICATION_URL = "https://book.tuinailspa.ca/api/webhooks/square";
const CHECKOUT_EVENT_PREFIXES = ["booking.", "order.", "payment."];
const SYNC_EVENT_PREFIXES = ["booking.", "team_member.", "labor.", "location.", "catalog.", "order.", "payment."];

function isValidSignature(body: string, signature: string | null, signatureKey: string, notificationUrl: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", signatureKey).update(notificationUrl + body).digest();
  const received = Buffer.from(signature, "base64");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function POST(request: Request) {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!signatureKey) {
    console.error("[v0] Square webhook rejected: SQUARE_WEBHOOK_SIGNATURE_KEY is not set.");
    return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  }

  const body = await request.text();
  const notificationUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ?? DEFAULT_NOTIFICATION_URL;
  if (!isValidSignature(body, request.headers.get("x-square-hmacsha256-signature"), signatureKey, notificationUrl)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const event = (() => {
    try {
      return JSON.parse(body) as { type?: unknown; merchant_id?: unknown; data?: { object?: WebhookObject } };
    } catch {
      return null;
    }
  })();
  const eventType = typeof event?.type === "string" ? event.type : "";
  if (!SYNC_EVENT_PREFIXES.some((prefix) => eventType.startsWith(prefix))) {
    return NextResponse.json({ received: true, synced: false });
  }

  if (eventType.startsWith("catalog.")) clearSquareVariationCache();
  try {
    await bumpSquareSyncVersion(eventType);
  } catch (error) {
    console.error("[v0] Square webhook could not record sync version:", error instanceof Error ? error.message : error);
    // A non-2xx response makes Square retry delivery.
    return NextResponse.json({ error: "Could not record sync." }, { status: 500 });
  }
  revalidatePath("/");
  revalidatePath("/admin");
  if (CHECKOUT_EVENT_PREFIXES.some((prefix) => eventType.startsWith(prefix))) {
    after(async () => {
      try {
        const date = await checkoutDateForEvent(eventType, event?.data?.object);
        if (!date) return;
        const { reconciled, stats } = await syncSquareDate(date);
        if (reconciled.size > 0 || stats.walkIns > 0) await bumpSquareSyncVersion("checkout.reconciled");
      } catch (error) {
        console.error("[v0] Square webhook checkout reconciliation failed:", error instanceof Error ? error.message : error);
      }
    });
  }
  return NextResponse.json({ received: true, synced: true });
}

type WebhookObject = {
  booking?: { start_at?: string };
  order_created?: { order_id?: string };
  order_updated?: { order_id?: string; state?: string };
  payment?: { order_id?: string; status?: string; created_at?: string; updated_at?: string };
};

async function checkoutDateForEvent(eventType: string, object: WebhookObject | undefined): Promise<string | null> {
  if (eventType.startsWith("booking.")) return object?.booking?.start_at ? torontoDate(object.booking.start_at) : null;
  if (eventType.startsWith("payment.")) {
    const payment = object?.payment;
    if (payment?.status !== "COMPLETED") return null;
    // Square POS / Appointments orders can still be OPEN when the payment completes; fall back to the payment time.
    const fromOrder = payment.order_id ? await orderBusinessDate(payment.order_id).catch(() => null) : null;
    const paidAt = payment.created_at ?? payment.updated_at;
    return fromOrder ?? (paidAt ? torontoDate(paidAt) : null);
  }
  const orderId = object?.payment?.order_id ?? object?.order_updated?.order_id ?? object?.order_created?.order_id;
  return orderId ? orderBusinessDate(orderId) : null;
}
