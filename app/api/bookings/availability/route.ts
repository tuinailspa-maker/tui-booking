import { NextResponse } from "next/server";
import { localTorontoStart, loadStaffAvailability, openSlotsForDate } from "@/data/dayAvailability";
import { getStaffRoster, verifyGuestAssignments } from "@/data/squareStaff";
import type { StaffMember } from "@/data/staffRoster";
import { getSlotsForDate, isWithinBusinessHours } from "@/data/staffSchedule";

const NEXT_DATE_SEARCH_DAYS = 14;

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** First later date where Square has enough distinct technicians free for the whole group. */
async function findNextOpenDate(requestedDate: string, roster: StaffMember[], locationId: string, partySize: number, durationMinutes: number, preferred: StaffMember | null): Promise<string | null> {
  const firstDate = addDays(requestedDate, 1);
  const rangeStart = Math.max(Date.now(), localTorontoStart(firstDate, "00:00"));
  const rangeEnd = localTorontoStart(addDays(firstDate, NEXT_DATE_SEARCH_DAYS), "00:00");
  const staffData = await loadStaffAvailability(roster, locationId, rangeStart, rangeEnd);
  if (staffData.length < partySize) return null;
  for (let offset = 0; offset < NEXT_DATE_SEARCH_DAYS; offset += 1) {
    const candidate = addDays(firstDate, offset);
    if (Object.keys(withPreferred(openSlotsForDate(candidate, staffData, partySize, durationMinutes), preferred)).length > 0) return candidate;
  }
  return null;
}

/** Keeps only slots where the chosen technician is one of the free team members. */
function withPreferred(slots: Record<string, string[]>, preferred: StaffMember | null): Record<string, string[]> {
  if (!preferred) return slots;
  return Object.fromEntries(Object.entries(slots).filter(([, names]) => names.includes(preferred.name)));
}

export async function POST(request: Request) {
  const input: unknown = await request.json().catch(() => null);
  if (!input || typeof input !== "object") return NextResponse.json({ error: "Invalid availability request." }, { status: 400 });
  const body = input as { date?: unknown; partySize?: unknown; durationMinutes?: unknown; startAt?: unknown; guests?: unknown; teamMemberId?: unknown };
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
      const fullRoster = await getStaffRoster(locationId);
      const requestedMemberId = typeof body.teamMemberId === "string" && body.teamMemberId ? body.teamMemberId : null;
      const preferred = requestedMemberId ? fullRoster.find((member) => member.teamMemberId === requestedMemberId) ?? null : null;
      if (requestedMemberId && !preferred) return NextResponse.json({ slots: {}, nextDate: null });
      // A solo guest with a chosen technician only needs that one column searched (team_member_id_filter);
      // a group still needs the rest of the team for the other guests.
      const roster = preferred && partySize === 1 ? [preferred] : fullRoster;
      if (slots.length === 0 || roster.length < partySize) return NextResponse.json({ slots: {} });
      const dayStart = localTorontoStart(requestedDate, "00:00");
      const dayEnd = dayStart + 24 * 60 * 60_000;
      // Square's availability search needs a range of at least 24h.
      const rangeStart = Math.max(Date.now(), dayStart);
      // Working hours, days off and blocked time come from Square availability; existing bookings are re-checked per segment.
      const staffData = await loadStaffAvailability(roster, locationId, rangeStart, Math.max(dayEnd, rangeStart + 24 * 60 * 60_000));
      if (staffData.length === 0) throw new Error("Square availability failed for every team member.");
      const available = withPreferred(openSlotsForDate(requestedDate, staffData, partySize, durationMinutes), preferred);
      const nextDate = Object.keys(available).length === 0
        ? await findNextOpenDate(requestedDate, roster, locationId, partySize, durationMinutes, preferred).catch(() => null)
        : null;
      return NextResponse.json({ slots: available, nextDate, staff: roster.map(({ name, kind }) => ({ name, kind })) });
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
