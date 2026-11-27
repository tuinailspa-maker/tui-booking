import { connection, NextResponse } from "next/server";
import { bumpSquareSyncVersion, getSquareSyncVersion } from "@/data/squareSync";
import { syncSquareDate } from "@/data/squareCheckoutSync";
import { isVerifiedOwner } from "@/data/teamAccess";

export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  await connection();
  try {
    const version = await getSquareSyncVersion();
    return NextResponse.json({ version }, { headers: NO_STORE });
  } catch (error) {
    console.error("[v0] Square sync version lookup failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ version: null }, { headers: NO_STORE });
  }
}

/**
 * Pulls one America/Toronto day from Square (v2/bookings + completed v2/payments), marks matching
 * bookings Paid by Card with Square's exact tip, and inserts unmatched card payments as walk-ins in Neon.
 */
export async function POST(request: Request) {
  if (!await isVerifiedOwner(request)) return NextResponse.json({ error: "Only the owner can sync Square." }, { status: 403, headers: NO_STORE });
  const body = await request.json().catch(() => ({})) as { date?: unknown };
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) && !Number.isNaN(Date.parse(`${body.date}T12:00:00Z`)) ? body.date : null;
  if (!date) return NextResponse.json({ error: "Choose a valid date." }, { status: 400, headers: NO_STORE });
  try {
    const { stats } = await syncSquareDate(date);
    if (stats.matched > 0 || stats.walkIns > 0) await bumpSquareSyncVersion("checkout.reconciled");
    return NextResponse.json({ date, ...stats }, { headers: NO_STORE });
  } catch (error) {
    console.error("[v0] Square day sync failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not sync this day from Square. Try again in a moment." }, { status: 502, headers: NO_STORE });
  }
}
