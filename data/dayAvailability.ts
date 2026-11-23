import { getSquareAvailableStarts } from "@/data/squareAvailability";
import { availabilityCovers, fetchBusyWindows, overlapsBusy, type BusyWindow } from "@/data/squareStaff";
import type { StaffMember } from "@/data/staffRoster";
import { getSlotsForDate, isWithinBusinessHours } from "@/data/staffSchedule";

export function localTorontoStart(date: string, time: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const candidate = new Date(target);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(candidate);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const shown = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
  return target - (shown - candidate.getTime());
}

export type StaffAvailability = { member: StaffMember; starts: Map<number, number>; busy: BusyWindow[] };

/** Slot time (HH:MM) -> distinct free technician names, keeping only slots with enough technicians for the party. */
export function openSlotsForDate(date: string, staffData: StaffAvailability[], partySize: number, durationMinutes: number): Record<string, string[]> {
  const available: Record<string, string[]> = {};
  for (const slot of getSlotsForDate(date, 1)) {
    const startMs = localTorontoStart(date, slot.time);
    if (startMs <= Date.now() || !isWithinBusinessHours(new Date(startMs), durationMinutes)) continue;
    const endMs = startMs + durationMinutes * 60_000;
    const free = staffData
      .filter(({ starts, busy }) => availabilityCovers(starts, startMs, durationMinutes) && !overlapsBusy(busy, startMs, endMs))
      .map(({ member }) => member);
    // Distinct team members only; all five columns count equally toward capacity.
    const names = Array.from(new Map(free.map((member) => [member.teamMemberId, member.name])).values());
    if (names.length >= partySize) available[slot.time] = names;
  }
  return available;
}

export async function loadStaffAvailability(roster: StaffMember[], locationId: string, rangeStart: number, rangeEnd: number): Promise<StaffAvailability[]> {
  // One column failing in Square (e.g. not assigned to the probe service) must not hide every other column's slots.
  const settled = await Promise.allSettled(roster.map(async (member) => {
    const [starts, busy] = await Promise.all([
      getSquareAvailableStarts(member.teamMemberId, rangeStart, rangeEnd, locationId),
      fetchBusyWindows(locationId, member.teamMemberId, rangeStart, rangeEnd),
    ]);
    return { member, starts, busy };
  }));
  return settled.flatMap((result, index) => {
    if (result.status === "fulfilled") return [result.value];
    console.error(`[v0] Square availability skipped for ${roster[index].name}:`, result.reason instanceof Error ? result.reason.message : result.reason);
    return [];
  });
}

/** Today's (Toronto) open slots for a party, using a range that satisfies Square's 24h minimum. */
export async function openSlotsToday(roster: StaffMember[], locationId: string, today: string, partySize: number, durationMinutes: number) {
  const dayStart = localTorontoStart(today, "00:00");
  const rangeStart = Math.max(Date.now(), dayStart);
  const rangeEnd = Math.max(dayStart + 24 * 60 * 60_000, rangeStart + 24 * 60 * 60_000);
  const staffData = await loadStaffAvailability(roster, locationId, rangeStart, rangeEnd);
  if (staffData.length === 0) throw new Error("Square availability failed for every team member.");
  return openSlotsForDate(today, staffData, partySize, durationMinutes);
}
