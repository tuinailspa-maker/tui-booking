import { NextResponse } from "next/server";
import { localTorontoStart, openSlotsToday } from "@/data/dayAvailability";
import { notifyOwnerSms, recordCheckIn, square, telegram } from "@/data/lateCheckin";
import { buildGuestSegments, SegmentMappingError } from "@/data/squareSegments";
import { getStaffRoster, verifyGuestAssignments } from "@/data/squareStaff";
import { bumpSquareSyncVersion } from "@/data/squareSync";
import { getServiceVariationLinks } from "@/data/squareVariations";
import { getTorontoToday } from "@/data/staffSchedule";
import { ownerDateTimeLabel, parseGuestCount, parseWalkinDate, parseWalkinServices, walkinDurationMinutes, walkinServiceSummary } from "@/data/walkin";

const REQUEST_ID_PATTERN = /^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$/;
const NO_STORE = { "Cache-Control": "no-store" };
const SLOT_TAKEN = "This time was just taken. Please choose another time.";

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

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 100) : "";
  const digits = typeof body?.phone === "string" ? body.phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") : "";
  const services = parseWalkinServices(body?.serviceIds);
  const guestCount = parseGuestCount(body?.guestCount);
  const requestId = typeof body?.requestId === "string" && REQUEST_ID_PATTERN.test(body.requestId) ? body.requestId : null;
  const time = typeof body?.time === "string" && /^\d{2}:\d{2}$/.test(body.time) ? body.time : null;
  const today = getTorontoToday();
  const date = parseWalkinDate(body?.date, today);
  if (!name || digits.length !== 10 || !services || !guestCount || !requestId || !time || !date) return fail("Invalid walk-in booking.", 400);

  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!process.env.SQUARE_ACCESS_TOKEN || !locationId) return fail("Square is not configured.", 500);

  // Only same-day bookings count as an arrival; future bookings check in normally on the day.
  const isToday = date === today;
  const startMs = localTorontoStart(date, time);
  const durationMinutes = walkinDurationMinutes(services);
  const serviceIds = services.map((service) => service.id);

  try {
    // Re-derive the free technicians for this exact slot on the server; the client only picks a time.
    const roster = await getStaffRoster(locationId);
    const open = await openSlotsToday(roster, locationId, date, guestCount, durationMinutes);
    const technicians = open[time]?.slice(0, guestCount);
    if (!technicians || technicians.length < guestCount) return fail(SLOT_TAKEN, 409);
    const guests = technicians.map((technician) => ({ technician, durationMinutes }));
    const assignment = await verifyGuestAssignments(locationId, startMs, guests);
    if (!assignment.ok) return fail(SLOT_TAKEN, 409);

    const phoneE164 = `+1${digits}`;
    const customer = await findOrCreateCustomer(name, phoneE164, requestId);
    const live = await getServiceVariationLinks();
    const segmentsByGuest = assignment.members.map((member) => buildGuestSegments(serviceIds, {}, live, member.teamMemberId));

    const checkedInAt = new Date();
    const summary = walkinServiceSummary(services);
    const created: CreatedBooking[] = [];
    try {
      for (const [index, segments] of segmentsByGuest.entries()) {
        const tags = isToday ? `[WALK-IN] [CHECKED_IN] [TUI_CHECKED_IN:${checkedInAt.toISOString()}]` : "[KIOSK-BOOKED]";
        const note = `${tags} Guests: ${guestCount} (guest ${index + 1}/${guestCount}). Services: ${summary}. Client: ${name}, ${phoneE164}.`;
        const { booking } = await square<{ booking: CreatedBooking }>("/bookings", "POST", {
          idempotency_key: `${requestId}-${index + 1}`,
          booking: { location_id: locationId, start_at: new Date(startMs).toISOString(), customer_id: customer.id, seller_note: note.slice(0, 500), appointment_segments: segments },
        });
        created.push(booking);
      }
    } catch (error) {
      // Never leave a partial group on the calendar.
      await cancelBookings(requestId, created);
      throw error;
    }

    if (isToday) {
      await Promise.all(created.map((booking) => recordCheckIn(booking.id, checkedInAt).catch((error) => console.error("[v0] Saving walk-in check-in failed:", booking.id, error))));
    }
    await bumpSquareSyncVersion("booking.created.walkin").catch(() => undefined);

    const startIso = new Date(startMs).toISOString();
    const when = ownerDateTimeLabel(startIso);
    const ownerSms = notifyOwnerSms(
      `Tui ${isToday ? "walk-in booked" : "kiosk booking"}: ${name}, ${phoneE164}, ${when}, ${guestCount} guest${guestCount > 1 ? "s" : ""}. Services: ${services.map((service) => service.displayNameEn).join(", ")}`,
    );
    const ownerChatId = process.env.OWNER_CHAT_ID;
    if (ownerChatId) {
      const text = [
        isToday ? "Walk-in booked and checked in" : "Kiosk booking for a future date (not checked in)",
        `Name: ${name}`,
        `Phone: ${phoneE164}`,
        `Date & time: ${when}`,
        `Guests: ${guestCount}`,
        `Services: ${services.map((service) => service.displayNameEn).join(", ")}`,
        `Technician: ${technicians.join(", ")}`,
      ].join("\n");
      await telegram("sendMessage", { chat_id: ownerChatId, text }).catch((error) => console.error("[v0] Walk-in Telegram notice failed:", error instanceof Error ? error.message : error));
    }
    await ownerSms;

    return NextResponse.json({ success: true, bookingIds: created.map((booking) => booking.id), startAt: startIso, isToday, technicians }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SegmentMappingError) return fail("One of the selected services is not bookable in Square yet. Please ask a team member.", 400);
    console.error("[v0] Walk-in booking failed:", error instanceof Error ? error.message : error);
    return fail("Square could not create the booking.", 502);
  }
}
