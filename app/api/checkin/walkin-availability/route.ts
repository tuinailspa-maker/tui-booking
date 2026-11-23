import { NextResponse } from "next/server";
import { localTorontoStart, openGroupSlots } from "@/data/dayAvailability";
import { getStaffRoster } from "@/data/squareStaff";
import { getTorontoToday } from "@/data/staffSchedule";
import { parseWalkinDate, parseWalkinGuests, walkinDurationMinutes } from "@/data/walkin";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const guests = parseWalkinGuests(body);
  const today = getTorontoToday();
  const date = parseWalkinDate(body?.date, today);
  if (!guests) return NextResponse.json({ error: "Choose at least one service for each guest (1–3 guests)." }, { status: 400 });
  if (!date) return NextResponse.json({ error: "Choose a date from today onward." }, { status: 400 });
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!process.env.SQUARE_ACCESS_TOKEN || !locationId) return NextResponse.json({ error: "Square is not configured." }, { status: 500 });

  const durations = guests.map((guest) => walkinDurationMinutes(guest.services));
  const isToday = date === today;
  try {
    const roster = await getStaffRoster(locationId);
    const open = await openGroupSlots(roster, locationId, date, durations);
    const slots = Object.keys(open).sort().map((time) => ({
      time,
      startAt: new Date(localTorontoStart(date, time)).toISOString(),
      assignments: open[time].map((member, index) => ({ guest: index + 1, teamMemberId: member.teamMemberId, technician: member.name })),
    }));
    return NextResponse.json({ date, isToday, guestCount: guests.length, durations, slots }, { headers: NO_STORE });
  } catch (error) {
    console.error("[v0] Walk-in availability failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Square could not check availability." }, { status: 502, headers: NO_STORE });
  }
}
