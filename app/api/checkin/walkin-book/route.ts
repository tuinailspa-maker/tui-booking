import { NextResponse } from "next/server";
import { localTorontoStart, openGroupSlots } from "@/data/dayAvailability";
import { notifyOwnerSms, recordCheckIn, square, telegram } from "@/data/lateCheckin";
import { buildGuestSegments, SegmentMappingError } from "@/data/squareSegments";
import { getStaffRoster, verifyGuestAssignments } from "@/data/squareStaff";
import { bumpSquareSyncVersion } from "@/data/squareSync";
import { getServiceVariationLinks } from "@/data/squareVariations";
import type { StaffMember } from "@/data/staffRoster";
import { getTorontoToday } from "@/data/staffSchedule";
import { ownerDateTimeLabel, parseWalkinDate, parseWalkinGuests, walkinDurationMinutes, walkinServiceSummary } from "@/data/walkin";
import { saveWalkinBookings } from "@/data/walkinStore";

const REQUEST_ID_PATTERN = /^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$/;
const NO_STORE = { "Cache-Control": "no-store" };
const SLOT_TAKEN = "This time was just taken. Please choose another time.";
const START_LEAD_MS = 2 * 60_000;

function warnNotice(channel: string, error: unknown) {
  console.warn(`[v0] Walk-in ${channel} notice skipped:`, error instanceof Error ? error.message : error);
}

type SquareCustomer = { id: string; given_name?: string; family_name?: string };
type CreatedBooking = { id: string; version?: number };

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

async function findOrCreateCustomer(name: string, phoneE164: string, requestId: string) {
  const search = await square<{ customers?: SquareCustomer[] }>("/customers/search", "POST", { query: { filter: { phone_number: { exact: phoneE164 } } }, limit: 1 });
  if (search.customers?.[0]) return search.customers[0];
  const [givenName, ...rest] = name.split(/\s+/);
  const created = await square<{ customer: SquareCustomer }>("/customers", "POST", { idempotency_key: `${requestId}-customer`, given_name: givenName, family_name: rest.join(" ") || undefined, phone_number: phoneE164 });
  return created.customer;
}

async function cancelBookings(requestId: string, bookings: CreatedBooking[]) {
  await Promise.all(bookings.map((booking) => square(`/bookings/${encodeURIComponent(booking.id)}/cancel`, "POST", {
    idempotency_key: `${requestId}-cancel-${booking.id}`.slice(0, 128),
    ...(typeof booking.version === "number" ? { booking_version: booking.version } : {}),
  }).catch((error) => console.error("[v0] Walk-in rollback failed:", booking.id, error instanceof Error ? error.message : error))));
}

/** The kiosk's suggested technicians, when they are real, distinct roster members (one per guest). */
function requestedTechnicians(value: unknown, roster: StaffMember[], guestCount: number): StaffMember[] | null {
  if (!Array.isArray(value) || value.length !== guestCount) return null;
  const byId = new Map(roster.map((member) => [member.teamMemberId, member]));
  const members = value.map((id) => (typeof id === "string" ? byId.get(id) : undefined));
  if (members.some((member) => !member)) return null;
  return new Set(value).size === value.length ? (members as StaffMember[]) : null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 100) : "";
  const digits = typeof body?.phone === "string" ? body.phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") : "";
  const parsedGuests = parseWalkinGuests(body);
  const requestId = typeof body?.requestId === "string" && REQUEST_ID_PATTERN.test(body.requestId) ? body.requestId : null;
  const time = typeof body?.time === "string" && /^\d{2}:\d{2}$/.test(body.time) ? body.time : null;
  const today = getTorontoToday();
  const date = parseWalkinDate(body?.date, today);
  if (!name || digits.length !== 10 || !parsedGuests || !requestId || !time || !date) return fail("Invalid walk-in booking.", 400);

  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!process.env.SQUARE_ACCESS_TOKEN || !locationId) return fail("Square is not configured.", 500);

  // Guest 1 is always the person at the kiosk.
  const guests = parsedGuests.map((guest, index) => (index === 0 ? { ...guest, name } : guest));
  const guestCount = guests.length;
  const isGroup = guestCount > 1;
  // Only same-day bookings count as an arrival; future bookings check in normally on the day.
  const isToday = date === today;
  const startMs = localTorontoStart(date, time);
  const durations = guests.map((guest) => walkinDurationMinutes(guest.services));

  try {
    // Re-check the exact start time on the server: the whole group must still fit, each with a different technician.
    const roster = await getStaffRoster(locationId);
    const open = await openGroupSlots(roster, locationId, date, durations);
    const fresh = open[time];
    if (!fresh) return fail(SLOT_TAKEN, 409);
    const verify = (members: StaffMember[]) => verifyGuestAssignments(locationId, startMs, members.map((member, index) => ({ technician: member.name, durationMinutes: durations[index] })));
    const requested = requestedTechnicians(body?.assignments, roster, guestCount);
    let assignment = requested ? await verify(requested) : null;
    if (!assignment?.ok) assignment = await verify(fresh);
    if (!assignment.ok) return fail(SLOT_TAKEN, 409);
    const technicians = assignment.members;

    const phoneE164 = `+1${digits}`;
    const customer = await findOrCreateCustomer(name, phoneE164, requestId);
    const live = await getServiceVariationLinks();
    const segmentsByGuest = guests.map((guest, index) => buildGuestSegments(guest.services.map((service) => service.id), {}, live, technicians[index].teamMemberId));

    const checkedInAt = new Date();
    // Square rejects a start_at in the past, so a "now" slot is pushed 2 minutes ahead (same as the kiosk check-in).
    const startIso = new Date(Math.max(startMs, checkedInAt.getTime() + START_LEAD_MS)).toISOString();
    const statusTags = isToday ? `[CHECKED_IN] [TUI_CHECKED_IN:${checkedInAt.toISOString()}]` : "[KIOSK-BOOKED]";
    const created: CreatedBooking[] = [];
    try {
      for (const [index, segments] of segmentsByGuest.entries()) {
        const guest = guests[index];
        const label = isGroup ? `[WALK-IN GROUP ${index + 1}/${guestCount}] - ${guest.name} ${statusTags}` : isToday ? `[WALK-IN] ${statusTags}` : statusTags;
        const note = `${label} Guests: ${guestCount}. Services: ${walkinServiceSummary(guest.services)}. Client: ${name}, ${phoneE164}.`;
        const { booking } = await square<{ booking: CreatedBooking }>("/bookings", "POST", {
          idempotency_key: `${requestId}-${index + 1}`,
          booking: { location_id: locationId, start_at: startIso, customer_id: customer.id, seller_note: note.slice(0, 500), appointment_segments: segments },
        });
        created.push(booking);
      }
    } catch (error) {
      // Never leave a partial group on the calendar.
      await cancelBookings(requestId, created);
      throw error;
    }

    // Persist to Neon and refresh /admin before any notification is attempted.
    try {
      await saveWalkinBookings(created.map((booking, index) => ({
      bookingId: booking.id,
      groupId: requestId,
      guestIndex: index + 1,
      guestCount,
      guestName: guests[index].name,
      representativeName: name,
      phone: phoneE164,
      startAt: startIso,
      serviceIds: guests[index].services.map((service) => service.id),
      teamMemberId: technicians[index].teamMemberId,
      checkedIn: isToday,
      })));
    } catch (error) {
      console.error("[v0] Saving walk-in bookings to Neon failed:", error instanceof Error ? error.message : error);
    }
    if (isToday) {
      await Promise.all(created.map((booking) => recordCheckIn(booking.id, checkedInAt).catch((error) => console.error("[v0] Saving walk-in check-in failed:", booking.id, error))));
    }
    await bumpSquareSyncVersion("booking.created.walkin").catch(() => undefined);

    // Notifications are best-effort: a Twilio or Telegram error never fails a saved booking.
    const when = ownerDateTimeLabel(startIso);
    const serviceNames = (index: number) => guests[index].services.map((service) => service.displayNameEn).join(", ");
    try {
      const smsGuests = isGroup ? guests.map((guest, index) => `G${index + 1} ${guest.name}: ${serviceNames(index)}`).join("; ") : `Services: ${serviceNames(0)}`;
      await notifyOwnerSms(
        `Tui ${isToday ? "walk-in" : "kiosk booking"}${isGroup ? " group" : ""}: ${name}, ${phoneE164}, ${when}, ${guestCount} guest${isGroup ? "s" : ""}. ${smsGuests}`,
      );
    } catch (error) {
      warnNotice("SMS", error);
    }
    const ownerChatId = process.env.OWNER_CHAT_ID;
    if (ownerChatId) try {
      const heading = isToday ? `Walk-in ${isGroup ? "group " : ""}booked and checked in` : `Kiosk ${isGroup ? "group " : ""}booking for a future date (not checked in)`;
      const text = [
        heading,
        `Name: ${name}`,
        `Phone: ${phoneE164}`,
        `Date & time: ${when}`,
        `Guests: ${guestCount}`,
        ...(isGroup
          ? guests.map((guest, index) => `${index + 1}. ${guest.name} — ${serviceNames(index)} (Technician: ${technicians[index].name})`)
          : [`Services: ${serviceNames(0)}`, `Technician: ${technicians[0].name}`]),
      ].join("\n");
      await telegram("sendMessage", { chat_id: ownerChatId, text });
    } catch (error) {
      warnNotice("Telegram", error);
    }

    return NextResponse.json({ success: true, bookingIds: created.map((booking) => booking.id), startAt: startIso, isToday, technicians: technicians.map((member) => member.name) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SegmentMappingError) return fail("One of the selected services is not bookable in Square yet. Please ask a team member.", 400);
    console.error("[v0] Walk-in booking failed:", error instanceof Error ? error.message : error);
    return fail("Square could not create the booking.", 502);
  }
}
