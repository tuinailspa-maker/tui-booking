import { NextResponse } from "next/server";
import { getSquareAvailableStarts, isSquareSlotAvailable } from "@/data/squareAvailability";
import { SQUARE_TEAM_MEMBER_IDS } from "@/data/squareConfig";
import { getSlotsForDate, isWithinBusinessHours, type Technician } from "@/data/staffSchedule";

function squareAvailabilityCoversDuration(starts: Map<number, number>, startMs: number, durationMinutes: number): boolean {
  for (let offsetMinutes = 0; offsetMinutes < durationMinutes; offsetMinutes += 30) {
    if (!starts.has(startMs + offsetMinutes * 60_000)) return false;
  }
  return true;
}

function localTorontoStart(date: string, time: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const candidate = new Date(target);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(candidate);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const shown = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
  return target - (shown - candidate.getTime());
}


export async function POST(request: Request) {
  const input: unknown = await request.json().catch(() => null);
  if (!input || typeof input !== "object") return NextResponse.json({ error: "Invalid availability request." }, { status: 400 });
  const body = input as { date?: unknown; partySize?: unknown; durationMinutes?: unknown; startAt?: unknown; guests?: unknown };
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!token || !locationId) return NextResponse.json({ error: "Square is not configured." }, { status: 500 });

  if (typeof body.date === "string") {
    const partySize = Number(body.partySize);
    const durationMinutes = Number(body.durationMinutes);
    const requestedDate = body.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || !Number.isInteger(partySize) || partySize < 1 || partySize > 3 || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 600) {
      return NextResponse.json({ error: "Invalid availability request." }, { status: 400 });
    }
    const slots = getSlotsForDate(requestedDate, 1).filter((slot) => isWithinBusinessHours(new Date(localTorontoStart(requestedDate, slot.time)), durationMinutes));
    try {
      const technicianNames = Object.keys(SQUARE_TEAM_MEMBER_IDS) as Technician[];
      if (slots.length === 0 || technicianNames.length < partySize) return NextResponse.json({ slots: {} });
      const earliest = localTorontoStart(requestedDate, slots[0].time);
      const rangeStart = Math.max(Date.now(), earliest - 12 * 60 * 60_000);
      const rangeEnd = rangeStart + 24 * 60 * 60_000;
      const startsByTechnician = await Promise.all(technicianNames.map(async (name) => ({
        name,
        starts: await getSquareAvailableStarts(SQUARE_TEAM_MEMBER_IDS[name], rangeStart, rangeEnd, locationId),
      })));
      const available: Record<string, Technician[]> = {};
      for (const slot of slots) {
        const startMs = localTorontoStart(requestedDate, slot.time);
        const staffForSlot = startsByTechnician.filter(({ starts }) => squareAvailabilityCoversDuration(starts, startMs, durationMinutes)).map(({ name }) => name);
        if (staffForSlot.length >= partySize) available[slot.time] = staffForSlot;
      }
      return NextResponse.json({ slots: available });
    } catch (error) {
      console.error("[v0] Square date availability search failed:", error instanceof Error ? error.message : error);
      return NextResponse.json({ error: "Square could not check appointment availability." }, { status: 502 });
    }
  }

  const startMs = typeof body.startAt === "string" ? Date.parse(body.startAt) : Number.NaN;
  const guests = body.guests as { technician?: unknown; durationMinutes?: unknown }[] | undefined;
  if (!Number.isFinite(startMs) || !Array.isArray(guests) || guests.length < 1 || guests.length > 3 || !guests.every((guest) => guest && typeof guest.technician === "string" && guest.technician in SQUARE_TEAM_MEMBER_IDS && Number.isInteger(guest.durationMinutes) && Number(guest.durationMinutes) > 0 && Number(guest.durationMinutes) <= 600)) {
    return NextResponse.json({ error: "Invalid availability request." }, { status: 400 });
  }
  const requestedGuests = guests as { technician: Technician; durationMinutes: number }[];
  if (!isWithinBusinessHours(new Date(startMs), Math.max(...requestedGuests.map((guest) => guest.durationMinutes)))) {
    return NextResponse.json({ available: false, availableTechnicians: [] });
  }
  const names = requestedGuests.map((guest) => guest.technician);
  if (new Set(names).size !== names.length) return NextResponse.json({ available: false, availableTechnicians: [] });

  try {
    const results = await Promise.all(requestedGuests.map(async ({ technician, durationMinutes }) =>
      await isSquareSlotAvailable(SQUARE_TEAM_MEMBER_IDS[technician], startMs, durationMinutes, locationId)));
    const availableTechnicians = names.filter((_, index) => results[index]);
    return NextResponse.json({ available: availableTechnicians.length === names.length, availableTechnicians });
  } catch (error) {
    console.error("[v0] Square availability check failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Square could not check appointment availability." }, { status: 502 });
  }
}
