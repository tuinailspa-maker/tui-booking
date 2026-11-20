import { NextResponse } from "next/server";
import { isSquareSlotAvailable, listActiveSquareTeamMemberIds } from "@/data/squareAvailability";
import { SQUARE_TEAM_MEMBER_IDS } from "@/data/squareConfig";
import { isWithinBusinessHours, type Technician } from "@/data/staffSchedule";

export async function POST(request: Request) {
  const input: unknown = await request.json().catch(() => null);
  if (!input || typeof input !== "object") return NextResponse.json({ error: "Invalid availability request." }, { status: 400 });
  const body = input as { startAt?: unknown; guests?: unknown };
  const startMs = typeof body.startAt === "string" ? Date.parse(body.startAt) : Number.NaN;
  const guests = body.guests as { technician?: unknown; durationMinutes?: unknown }[] | undefined;
  if (!Number.isFinite(startMs) || !Array.isArray(guests) || guests.length < 1 || guests.length > 3 || !guests.every((guest) => guest && typeof guest.technician === "string" && guest.technician in SQUARE_TEAM_MEMBER_IDS && Number.isInteger(guest.durationMinutes) && Number(guest.durationMinutes) > 0 && Number(guest.durationMinutes) <= 600)) {
    return NextResponse.json({ error: "Invalid availability request." }, { status: 400 });
  }
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!token || !locationId) return NextResponse.json({ error: "Square is not configured." }, { status: 500 });
  const requestedGuests = guests as { technician: Technician; durationMinutes: number }[];
  if (!isWithinBusinessHours(new Date(startMs), Math.max(...requestedGuests.map((guest) => guest.durationMinutes)))) {
    return NextResponse.json({ available: false, availableTechnicians: [] });
  }
  const names = requestedGuests.map((guest) => guest.technician);
  if (new Set(names).size !== names.length) return NextResponse.json({ available: false, availableTechnicians: [] });

  try {
    const activeIds = await listActiveSquareTeamMemberIds(locationId);
    const results = await Promise.all(requestedGuests.map(async ({ technician, durationMinutes }) =>
      activeIds.has(SQUARE_TEAM_MEMBER_IDS[technician]) &&
      await isSquareSlotAvailable(SQUARE_TEAM_MEMBER_IDS[technician], startMs, durationMinutes, locationId)));
    const availableTechnicians = names.filter((_, index) => results[index]);
    return NextResponse.json({ available: availableTechnicians.length === names.length, availableTechnicians });
  } catch (error) {
    console.error("[v0] Square availability check failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Square could not check appointment availability." }, { status: 502 });
  }
}
