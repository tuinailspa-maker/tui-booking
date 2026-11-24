import { SQUARE_API_VERSION, SQUARE_TEAM_MEMBER_IDS } from "@/data/squareConfig";
import { getSquareAvailableStarts } from "@/data/squareAvailability";
import { DEFAULT_STAFF_ROSTER, sortStaff, staffKind, type StaffMember } from "@/data/staffRoster";

const PRODUCTION_URL = "https://connect.squareup.com/v2";
const SANDBOX_URL = "https://connect.squareupsandbox.com/v2";
const INACTIVE_BOOKING_STATUSES = new Set(["CANCELLED_BY_CUSTOMER", "CANCELLED_BY_SELLER", "DECLINED", "NO_SHOW"]);
const SLOT_STEP_MINUTES = 15;

export type BusyWindow = { bookingId: string; startMs: number; endMs: number; createdAtMs: number };

function squareBaseUrl() {
  return process.env.SQUARE_ENVIRONMENT === "sandbox" ? SANDBOX_URL : PRODUCTION_URL;
}

function authHeaders(json = false) {
  return {
    Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
    "Square-Version": SQUARE_API_VERSION,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function fetchBookableTeamMemberIds(): Promise<Set<string> | null> {
  try {
    const ids = new Set<string>();
    let cursor: string | undefined;
    do {
      const params = new URLSearchParams({ limit: "100", bookable_only: "true" });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`${squareBaseUrl()}/bookings/team-member-booking-profiles?${params}`, { cache: "no-store", headers: authHeaders() });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return null;
      for (const profile of (data.team_member_booking_profiles ?? []) as { team_member_id?: string; is_bookable?: boolean }[]) {
        if (profile.team_member_id && profile.is_bookable !== false) ids.add(profile.team_member_id);
      }
      cursor = data.cursor;
    } while (cursor);
    return ids;
  } catch {
    return null;
  }
}

export type PublicTechnicianProfile = { teamMemberId: string; name: string; imageUrl: string | null };

/**
 * Technicians customers can pick by name: Square team members whose booking profile is bookable
 * at this location. Owner/manager accounts with Bookable turned off and the virtual Option
 * capacity columns are left out; they still count toward "Any available".
 */
export async function getBookableTechnicians(locationId: string): Promise<PublicTechnicianProfile[]> {
  const roster = (await getStaffRoster(locationId)).filter((member) => member.kind === "real");
  const profiles = new Map<string, { imageUrl: string | null }>();
  try {
    let cursor: string | undefined;
    do {
      const params = new URLSearchParams({ limit: "100", bookable_only: "true", location_id: locationId });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`${squareBaseUrl()}/bookings/team-member-booking-profiles?${params}`, { cache: "no-store", headers: authHeaders() });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.errors?.map((error: { detail?: string }) => error.detail).filter(Boolean).join("; ") || "Square booking profile list failed.");
      for (const profile of (data.team_member_booking_profiles ?? []) as { team_member_id?: string; is_bookable?: boolean; profile_image_url?: string }[]) {
        if (profile.team_member_id && profile.is_bookable === true) profiles.set(profile.team_member_id, { imageUrl: profile.profile_image_url || null });
      }
      cursor = data.cursor;
    } while (cursor);
  } catch (error) {
    console.error("[v0] Square booking profiles lookup failed, showing roster technicians:", error instanceof Error ? error.message : error);
    return roster.map((member) => ({ teamMemberId: member.teamMemberId, name: member.name, imageUrl: null }));
  }
  return roster
    .filter((member) => profiles.has(member.teamMemberId))
    .map((member) => ({ teamMemberId: member.teamMemberId, name: member.name, imageUrl: profiles.get(member.teamMemberId)?.imageUrl ?? null }));
}

// Only used when Square is unreachable; every successful lookup is fetched live so columns
// opened or closed in Square Appointments take effect on the very next request.
let lastGoodRoster: { locationId: string; roster: StaffMember[] } | null = null;

/**
 * All ACTIVE Square team members at the location, fetched live (no-store) on every call.
 * Known staff keep their names (Jenny, Melika, Nana, Option 1, Option 2); every member is
 * equal booking capacity. Falls back to the last live roster, then the static roster.
 */
export async function getStaffRoster(locationId: string): Promise<StaffMember[]> {
  const knownById = new Map(Object.entries(SQUARE_TEAM_MEMBER_IDS).map(([name, id]) => [id, name]));
  try {
    const members: { id: string; given_name?: string; family_name?: string }[] = [];
    let cursor: string | undefined;
    do {
      const response = await fetch(`${squareBaseUrl()}/team-members/search`, {
        method: "POST",
        cache: "no-store",
        headers: authHeaders(true),
        body: JSON.stringify({ query: { filter: { location_ids: [locationId], status: "ACTIVE" } }, limit: 200, ...(cursor ? { cursor } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("Square team member search failed.");
      members.push(...(data.team_members ?? []));
      cursor = data.cursor;
    } while (cursor);
    if (members.length === 0) return DEFAULT_STAFF_ROSTER;
    // Owners/admins can be ACTIVE team members without performing services; Square rejects
    // availability searches for them, so only bookable members (plus known columns) count.
    const bookable = await fetchBookableTeamMemberIds();
    const bookableMembers = bookable ? members.filter((member) => bookable.has(member.id) || knownById.has(member.id)) : members;

    const usedNames = new Set<string>();
    const roster = bookableMembers.map((member) => {
      const known = knownById.get(member.id);
      let name = known ?? ([member.given_name, member.family_name].filter(Boolean).join(" ").trim() || `Team ${member.id.slice(-4)}`);
      if (usedNames.has(name)) name = `${name} (${member.id.slice(-4)})`;
      usedNames.add(name);
      return { name, teamMemberId: member.id, kind: known ? staffKind(known) : "real" as const };
    });
    const sorted = sortStaff(roster);
    lastGoodRoster = { locationId, roster: sorted };
    return sorted;
  } catch (error) {
    console.error("[v0] Square roster lookup failed, using last known staff:", error instanceof Error ? error.message : error);
    return lastGoodRoster?.locationId === locationId ? lastGoodRoster.roster : DEFAULT_STAFF_ROSTER;
  }
}

/** Every Square booking segment for one team member that overlaps [fromMs, toMs]. */
export async function fetchBusyWindows(locationId: string, teamMemberId: string, fromMs: number, toMs: number): Promise<BusyWindow[]> {
  const windows: BusyWindow[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({
      location_id: locationId,
      team_member_id: teamMemberId,
      start_at_min: new Date(fromMs - 12 * 60 * 60_000).toISOString(),
      start_at_max: new Date(toMs).toISOString(),
      limit: "100",
    });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`${squareBaseUrl()}/bookings?${params}`, { cache: "no-store", headers: authHeaders() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.errors?.map((error: { detail?: string }) => error.detail).filter(Boolean).join("; ") || "Square booking list failed.");
    for (const booking of (data.bookings ?? []) as { id: string; status?: string; start_at?: string; created_at?: string; appointment_segments?: { duration_minutes?: number; team_member_id?: string }[] }[]) {
      if (booking.status && INACTIVE_BOOKING_STATUSES.has(booking.status)) continue;
      let cursorMs = booking.start_at ? Date.parse(booking.start_at) : Number.NaN;
      if (!Number.isFinite(cursorMs)) continue;
      const createdAtMs = booking.created_at ? Date.parse(booking.created_at) : 0;
      for (const segment of booking.appointment_segments ?? []) {
        const endMs = cursorMs + (segment.duration_minutes ?? 0) * 60_000;
        if (segment.team_member_id === teamMemberId && endMs > cursorMs && cursorMs < toMs && endMs > fromMs) {
          windows.push({ bookingId: booking.id, startMs: cursorMs, endMs, createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0 });
        }
        cursorMs = endMs;
      }
    }
    cursor = data.cursor;
  } while (cursor);
  return windows;
}

export function overlapsBusy(windows: BusyWindow[], startMs: number, endMs: number, excludeBookingIds: string[] = []): boolean {
  return windows.some((window) => !excludeBookingIds.includes(window.bookingId) && window.startMs < endMs && window.endMs > startMs);
}

/**
 * Square availability (working hours, days off, blocked/clocked-out time, existing bookings) must
 * cover the full [startMs, startMs + duration] window. Square aligns starts quarter-hourly and each
 * start is free for its probe segment's duration, so chain starts until the window is covered.
 */
export function availabilityCovers(starts: Map<number, number>, startMs: number, durationMinutes: number): boolean {
  let offset = 0;
  while (offset < durationMinutes) {
    const segmentMinutes = starts.get(startMs + offset * 60_000);
    if (segmentMinutes === undefined) return false;
    if (offset + Math.max(segmentMinutes, SLOT_STEP_MINUTES) >= durationMinutes) return true;
    offset += SLOT_STEP_MINUTES;
  }
  return true;
}

type StaffCheckOptions = { excludeBookingIds?: string[]; checkSquareAvailability?: boolean };

/** True when the member is bookable for the full [startMs, startMs + duration] window. */
export async function isStaffFree(locationId: string, member: StaffMember, startMs: number, durationMinutes: number, options: StaffCheckOptions = {}): Promise<boolean> {
  const endMs = startMs + durationMinutes * 60_000;
  const busy = await fetchBusyWindows(locationId, member.teamMemberId, startMs, endMs);
  if (overlapsBusy(busy, startMs, endMs, options.excludeBookingIds)) return false;
  if (options.checkSquareAvailability === false || startMs <= Date.now()) return true;
  const rangeStart = Math.max(Date.now(), startMs - 12 * 60 * 60_000);
  const starts = await getSquareAvailableStarts(member.teamMemberId, rangeStart, rangeStart + 24 * 60 * 60_000, locationId);
  return availabilityCovers(starts, startMs, durationMinutes);
}

export type GuestAssignment = { technician: string; durationMinutes: number };
export type AssignmentCheck =
  | { ok: true; members: StaffMember[] }
  | { ok: false; reason: "unknown_staff" | "duplicate_staff" | "unavailable"; unavailable: string[] };

/**
 * Cross-checks every guest segment of a 1-3 guest booking: each technician must be an
 * active Square team member, every guest needs a distinct team_member_id, and each
 * member must be free for that guest's whole duration.
 */
export async function verifyGuestAssignments(locationId: string, startMs: number, guests: GuestAssignment[]): Promise<AssignmentCheck> {
  const roster = await getStaffRoster(locationId);
  const byName = new Map(roster.map((member) => [member.name, member]));
  const members = guests.map((guest) => byName.get(guest.technician));
  if (members.some((member) => !member)) return { ok: false, reason: "unknown_staff", unavailable: guests.filter((_, index) => !members[index]).map((guest) => guest.technician) };
  const resolved = members as StaffMember[];
  if (new Set(resolved.map((member) => member.teamMemberId)).size !== resolved.length) return { ok: false, reason: "duplicate_staff", unavailable: [] };
  const results = await Promise.all(resolved.map((member, index) => isStaffFree(locationId, member, startMs, guests[index].durationMinutes)));
  const unavailable = resolved.filter((_, index) => !results[index]).map((member) => member.name);
  return unavailable.length ? { ok: false, reason: "unavailable", unavailable } : { ok: true, members: resolved };
}
