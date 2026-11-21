import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { clearSquareVariationCache } from "@/data/squareVariations";
import { bumpSquareSyncVersion } from "@/data/squareSync";

const DEFAULT_NOTIFICATION_URL = "https://book.tuinailspa.ca/api/webhooks/square";
const SYNC_EVENT_PREFIXES = ["booking.", "team_member.", "labor.", "location.", "catalog."];

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
      return JSON.parse(body) as { type?: unknown; merchant_id?: unknown };
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
  return NextResponse.json({ received: true, synced: true });
}
