import { NextResponse } from "next/server";
import { getSquareAvailableStarts } from "@/data/squareAvailability";
import { availabilityCovers, fetchBusyWindows, getStaffRoster, overlapsBusy, verifyGuestAssignments } from "@/data/squareStaff";
import { getSlotsForDate, isWithinBusinessHours } from "@/data/staffSchedule";

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
      const roster = await getStaffRoster(locationId);
      if (slots.length === 0 || roster.length < partySize) return NextResponse.json({ slots: {} });
      const dayStart = localTorontoStart(requestedDate, "00:00");
      const dayEnd = dayStart + 24 * 60 * 60_000;
      const rangeStart = Math.max(Date.now(), localTorontoStart(requestedDate, slots[0].time) - 12 * 60 * 60_000);
      // Working hours, days off and blocked time come from Square availability; existing bookings are re-checked per segment.
      // One column failing in Square (e.g. not assigned to the probe service) must not hide every other column's slots.
      const settled = await Promise.allSettled(roster.map(async (member) => {
        const [starts, busy] = await Promise.all([
          getSquareAvailableStarts(member.teamMemberId, rangeStart, rangeStart + 24 * 60 * 60_000, locationId),
          fetchBusyWindows(locationId, member.teamMemberId, dayStart, dayEnd),
        ]);
        return { member, starts, busy };
      }));
      const staffData = settled.flatMap((result, index) => {
        if (result.status === "fulfilled") return [result.value];
        console.error(`[v0] Square availability skipped for ${roster[index].name}:`, result.reason instanceof Error ? result.reason.message : result.reason);
        return [];
      });
      if (staffData.length === 0) throw new Error("Square availability failed for every team member.");
      const available: Record<string, string[]> = {};
      for (const slot of slots) {
        const startMs = localTorontoStart(requestedDate, slot.time);
        const endMs = startMs + durationMinutes * 60_000;
        const free = staffData
          .filter(({ starts, busy }) => availabilityCovers(starts, startMs, durationMinutes) && !overlapsBusy(busy, startMs, endMs))
          .map(({ member }) => member);
        // Distinct team members only; all five columns count equally toward capacity.
        const names = Array.from(new Map(free.map((member) => [member.teamMemberId, member.name])).values());
        if (names.length >= partySize) available[slot.time] = names;
      }
      return NextResponse.json({ slots: available, staff: roster.map(({ name, kind }) => ({ name, kind })) });
    } catch (error) {
      console.error("[v0] Square date availability search failed:", error instanceof Error ? error.message : error);
      return NextResponse.json({ error: "Square could not check appointment availability." }, { status: 502 });
    }
  }

  const startMs = typeof body.startAt === "string" ? Date.parse(body.startAt) : Number.NaN;
  const guests = body.guests as { technician?: unknown; durationMinutes?: unknown }[] | undefined;
  if (!Number.isFinite(startMs) || !Array.isArray(guests) || guests.length < 1 || guests.length > 3 || !guests.every((guest) => guest && typeof guest.technician === "string" && guest.technician.length <= 100 && Number.isInteger(guest.durationMinutes) && Number(guest.durationMinutes) > 0 && Number(guest.durationMinutes) <= 600)) {
    return NextResponse.json({ error: "Invalid availability request." }, { status: 400 });
  }
  const requestedGuests = guests as { technician: string; durationMinutes: number }[];
  if (!isWithinBusinessHours(new Date(startMs), Math.max(...requestedGuests.map((guest) => guest.durationMinutes)))) {
    return NextResponse.json({ available: false, availableTechnicians: [] });
  }

  try {
    const check = await verifyGuestAssignments(locationId, startMs, requestedGuests);
    const names = requestedGuests.map((guest) => guest.technician);
    return NextResponse.json(check.ok
      ? { available: true, availableTechnicians: names }
      : { available: false, reason: check.reason, availableTechnicians: names.filter((name) => !check.unavailable.includes(name)) });
  } catch (error) {
    console.error("[v0] Square availability check failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Square could not check appointment availability." }, { status: 502 });
  }
}
