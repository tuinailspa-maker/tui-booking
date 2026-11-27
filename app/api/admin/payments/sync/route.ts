import { NextResponse } from "next/server";
import { isVerifiedOwner } from "@/data/teamAccess";
import { syncSquareDate } from "@/data/squareCheckoutSync";
import { bumpSquareSyncVersion } from "@/data/squareSync";

export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

/** Pulls one America/Toronto business day of completed Square payments and reconciles them into Neon. */
export async function POST(request: Request) {
  if (!await isVerifiedOwner(request)) return NextResponse.json({ error: "Only the owner can sync Square payments." }, { status: 403, headers: NO_STORE });
  const body = await request.json().catch(() => ({})) as { date?: unknown };
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) && !Number.isNaN(Date.parse(`${body.date}T12:00:00Z`)) ? body.date : null;
  if (!date) return NextResponse.json({ error: "Choose a valid date." }, { status: 400, headers: NO_STORE });
  try {
    const { stats } = await syncSquareDate(date);
    if (stats.matched > 0 || stats.walkIns > 0) await bumpSquareSyncVersion("checkout.reconciled");
    return NextResponse.json({ date, ...stats }, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Square payments could not be synced.";
    return NextResponse.json({ error: message }, { status: 502, headers: NO_STORE });
  }
}
