import { NextResponse } from "next/server";
import { localTorontoStart, openSlotsToday } from "@/data/dayAvailability";
import { getStaffRoster } from "@/data/squareStaff";
import { getTorontoToday } from "@/data/staffSchedule";
import { parseGuestCount, parseWalkinDate, parseWalkinServices, walkinDurationMinutes } from "@/data/walkin";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const services = parseWalkinServices(body?.serviceIds);
  const guestCount = parseGuestCount(body?.guestCount);
  const today = getTorontoToday();
  const date = parseWalkinDate(body?.date, today);
  if (!services || !guestCount) return NextResponse.json({ error: "Choose at least one service and 1–3 guests." }, { status: 400 });
  if (!date) return NextResponse.json({ error: "Choose a date from today onward." }, { status: 400 });
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!process.env.SQUARE_ACCESS_TOKEN || !locationId) return NextResponse.json({ error: "Square is not configured." }, { status: 500 });

  const durationMinutes = walkinDurationMinutes(services);
  const isToday = date === today;
  try {
    const roster = await getStaffRoster(locationId);
    if (roster.length < guestCount) return NextResponse.json({ date, isToday, durationMinutes, slots: [] }, { headers: NO_STORE });
    const open = await openSlotsToday(roster, locationId, date, guestCount, durationMinutes);
    const slots = Object.keys(open).sort().map((time) => ({ time, startAt: new Date(localTorontoStart(date, time)).toISOString() }));
    return NextResponse.json({ date, isToday, durationMinutes, slots }, { headers: NO_STORE });
  } catch (error) {
    console.error("[v0] Walk-in availability failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Square could not check availability." }, { status: 502, headers: NO_STORE });
  }
}
