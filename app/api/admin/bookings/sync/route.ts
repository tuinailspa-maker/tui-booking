import { NextResponse } from "next/server";
import { reconcileSquareDate } from "@/data/squareCheckoutSync";
import { isVerifiedOwner } from "@/data/teamAccess";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!await isVerifiedOwner(request)) return NextResponse.json({ error: "Only the owner can sync checkouts." }, { status: 403, headers: noStore });
  const body = await request.json().catch(() => null) as { date?: unknown; bookingId?: unknown } | null;
  const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  const bookingId = typeof body?.bookingId === "string" ? body.bookingId.slice(0, 180) : null;
  if (!date) return NextResponse.json({ error: "Provide a valid date." }, { status: 400, headers: noStore });
  try {
    const reconciled = await reconcileSquareDate(date);
    return NextResponse.json({ synced: reconciled.size, checkout: bookingId ? reconciled.get(bookingId) ?? null : null }, { headers: noStore });
  } catch (error) {
    console.error("[v0] Square checkout sync failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not read this checkout from Square. Try again in a moment." }, { status: 502, headers: noStore });
  }
}
