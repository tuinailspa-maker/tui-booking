import { NextResponse } from "next/server";
import { selectedServiceDuration, selectedServicePrice, serviceById, serviceDisplayNameWithAddOn, type ServiceAddOnKey } from "@/data/serviceTree";
import { SQUARE_API_VERSION } from "@/data/squareConfig";
import { getServiceVariationLinks } from "@/data/squareVariations";
import { calculateBill, centsToDollars } from "@/data/billing";
import { verifyGuestAssignments } from "@/data/squareStaff";
import { isWithinBusinessHours, type Technician } from "@/data/staffSchedule";

const SQUARE_PRODUCTION_URL = "https://connect.squareup.com/v2";
const SQUARE_SANDBOX_URL = "https://connect.squareupsandbox.com/v2";
const MAX_GUESTS = 3;
const MAX_SQUARE_NOTE_LENGTH = 500;
const REQUEST_ID_PATTERN = /^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$/;

type BookingGuest = { serviceIds: string[]; addOns: Record<string, ServiceAddOnKey>; technician: Technician };
type BookingClient = { firstName: string; lastName: string; countryCode: string; phone: string; email?: string; notes: string };
type BookingRequest = { requestId: string; startAt: string; client: BookingClient; guests: BookingGuest[] };

type SquareApiError = { code: string | null; field: string | null; detail: string };

class SquareStepError extends Error {
  constructor(
    readonly step: string,
    readonly status: number,
    readonly errors: SquareApiError[],
  ) {
    const summary = errors.map((error) => [error.code, error.field && `field ${error.field}`, error.detail].filter(Boolean).join(" - ")).join("; ");
    super(`${step} failed (${status}): ${summary || `HTTP ${status}`}`);
  }
}

function squareBaseUrl() {
  return process.env.SQUARE_ENVIRONMENT === "sandbox" ? SQUARE_SANDBOX_URL : SQUARE_PRODUCTION_URL;
}

const COUNTRY_CODE_PATTERN = /^\+\d{1,4}$/;

function toE164(countryCode: string, phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) return `+${trimmed.replace(/\D/g, "")}`;
  return `${countryCode}${trimmed.replace(/\D/g, "")}`;
}

function isTechnician(value: unknown): value is Technician {
  // Membership in the active Square roster is verified in POST via verifyGuestAssignments.
  return typeof value === "string" && value.trim().length > 0 && value.length <= 100;
}

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

function parseBookingRequest(body: unknown): BookingRequest | null {
  if (!body || typeof body !== "object") return null;
  const input = body as Record<string, unknown>;
  const requestId = readText(input.requestId, 36);
  const startAt = readText(input.startAt, 40);
  const client = input.client as Record<string, unknown> | undefined;
  const guests = input.guests;
  if (!requestId || !REQUEST_ID_PATTERN.test(requestId) || !startAt || Number.isNaN(Date.parse(startAt))) return null;
  if (!client || !Array.isArray(guests) || guests.length < 1 || guests.length > MAX_GUESTS) return null;

  const firstName = readText(client.firstName, 80);
  const lastName = readText(client.lastName, 80);
  const countryCode = readText(client.countryCode, 6) ?? "+1";
  const phone = readText(client.phone, 30);
  const email = readText(client.email, 254);
  const notes = typeof client.notes === "string" ? client.notes.trim().slice(0, 500) : "";
  if (!firstName || !lastName || !phone || (client.email !== undefined && !email) || !COUNTRY_CODE_PATTERN.test(countryCode)) return null;

  const parsedGuests: BookingGuest[] = [];
  for (const guest of guests as Record<string, unknown>[]) {
    if (!isTechnician(guest.technician) || !Array.isArray(guest.serviceIds) || guest.serviceIds.length === 0) return null;
    const serviceIds = guest.serviceIds.filter((id): id is string => typeof id === "string" && serviceById.has(id));
    if (serviceIds.length !== guest.serviceIds.length) return null;
    const addOns: Record<string, ServiceAddOnKey> = {};
    if (guest.addOns !== undefined) {
      if (!guest.addOns || typeof guest.addOns !== "object" || Array.isArray(guest.addOns)) return null;
      for (const [serviceId, addOnKey] of Object.entries(guest.addOns as Record<string, unknown>)) {
        const service = serviceById.get(serviceId);
        if (!serviceIds.includes(serviceId) || !service?.addOn || addOnKey !== service.addOn.key) return null;
        addOns[serviceId] = service.addOn.key;
      }
    }
    parsedGuests.push({ serviceIds, addOns, technician: guest.technician });
  }

  return { requestId, startAt, client: { firstName, lastName, countryCode, phone, email: email ?? undefined, notes }, guests: parsedGuests };
}

async function squareRequest<T>(step: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${squareBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      "Square-Version": SQUARE_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errors: SquareApiError[] = Array.isArray(data.errors)
      ? data.errors.map((error: Record<string, unknown>) => ({
          code: typeof error.code === "string" ? error.code : null,
          field: typeof error.field === "string" ? error.field : null,
          detail: typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`,
        }))
      : [];
    throw new SquareStepError(step, response.status, errors);
  }
  return data as T;
}

const SLOT_UNAVAILABLE_MESSAGE = "This time slot is no longer available. Please choose another time.";

function buildSellerNote(request: BookingRequest, guest: BookingGuest, guestIndex: number) {
  const lines = guest.serviceIds.map((id) => {
    const service = serviceById.get(id);
    const addOnKey = guest.addOns[id];
    return service ? `${serviceDisplayNameWithAddOn(service, "en", addOnKey)} — $${selectedServicePrice(service, addOnKey)} (${selectedServiceDuration(service, addOnKey)} min)` : id;
  });
  const guestBill = calculateBill({
    selections: [guest.serviceIds],
    addOns: [guest.addOns],
    manualDiscountCents: calculateBill({ selections: request.guests.map((item) => item.serviceIds), addOns: request.guests.map((item) => item.addOns) }).guestComboDiscountCents[guestIndex],
  });
  const money = (cents: number) => `$${centsToDollars(cents).toFixed(2)}`;
  const note = [
    `Booking ${request.requestId} · GUEST ${guestIndex + 1}/${request.guests.length}.`,
    `Services: ${lines.join("; ")}. Total ${guestDurationMinutes(guest)} min.`,
    `Purchase Subtotal ${money(guestBill.subtotalCents)} CAD; TVQ 9.975% ${money(guestBill.tvqCents)}; TPS 5% ${money(guestBill.tpsCents)}; Tip $0.00; Total ${money(guestBill.totalBeforeTipCents)} CAD.`,
    `Combo discount -${money(guestBill.manualDiscountCents)}; client note: ${request.client.notes || "none"}.`,
    `Client: ${request.client.firstName} ${request.client.lastName}, ${request.client.phone}, ${request.client.email || ""}.`,
  ].join(" ");
  return note.slice(0, MAX_SQUARE_NOTE_LENGTH);
}

type AppointmentSegment = { duration_minutes: number; service_variation_id: string; service_variation_version: number; team_member_id: string };

/** One segment per mapped service, using its exact live Square variation and version. Never falls back to another service. */
async function buildAppointmentSegments(request: BookingRequest, teamMemberIds: string[]): Promise<AppointmentSegment[][]> {
  let live: Awaited<ReturnType<typeof getServiceVariationLinks>>;
  try {
    live = await getServiceVariationLinks();
  } catch (error) {
    throw new SquareStepError("fetch_catalog", 502, [{ code: "CATALOG_LOOKUP_FAILED", field: null, detail: error instanceof Error ? error.message : "Could not load the Square service catalog." }]);
  }
  const bill = calculateBill({ selections: request.guests.map((guest) => guest.serviceIds), addOns: request.guests.map((guest) => guest.addOns) });

  return request.guests.map((guest, guestIndex) => {
    const teamMemberId = teamMemberIds[guestIndex];
    const segments: AppointmentSegment[] = [];
    let unmappedMinutes = 0;
    for (const line of bill.guestLines[guestIndex]) {
      const variation = live.get(line.serviceId);
      if (!variation) {
        if (line.square) {
          throw new SquareStepError("match_service", 502, [{ code: "SERVICE_VARIATION_NOT_FOUND", field: line.serviceId, detail: `"${line.nameEn}" has no bookable Square variation. Run the Square catalog sync in the admin.` }]);
        }
        unmappedMinutes += line.durationMinutes;
        continue;
      }
      segments.push({ duration_minutes: line.durationMinutes, service_variation_id: variation.variationId, service_variation_version: variation.version, team_member_id: teamMemberId });
    }
    if (segments.length === 0) {
      throw new SquareStepError("match_service", 400, [{ code: "NO_BOOKABLE_SERVICE", field: null, detail: `Guest ${guestIndex + 1} has no service that exists in the Square booking catalog.` }]);
    }
    segments[segments.length - 1].duration_minutes += unmappedMinutes;
    return segments;
  });
}

function guestDurationMinutes(guest: BookingGuest) {
  return guest.serviceIds.reduce((sum, id) => {
    const service = serviceById.get(id);
    return sum + (service ? selectedServiceDuration(service, guest.addOns[id]) : 0);
  }, 0);
}

export async function POST(request: Request) {
  const parsed = parseBookingRequest(await request.json().catch(() => null));
  if (!parsed) {
    return NextResponse.json({ error: "Invalid booking request." }, { status: 400 });
  }
  const longestGuestDuration = Math.max(...parsed.guests.map(guestDurationMinutes));
  if (!isWithinBusinessHours(parsed.startAt, longestGuestDuration)) {
    return NextResponse.json({ error: "Appointments must start between 8:00 AM and the daily closing time in Toronto, and finish by closing." }, { status: 400 });
  }

  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!process.env.SQUARE_ACCESS_TOKEN || !locationId) {
    return NextResponse.json({ error: "Square is not configured.", step: "config", detail: "SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID is missing." }, { status: 500 });
  }

  try {
    const assignment = await verifyGuestAssignments(locationId, Date.parse(parsed.startAt), parsed.guests.map((guest) => ({ technician: guest.technician, durationMinutes: guestDurationMinutes(guest) })));
    if (!assignment.ok) {
      const detail = assignment.reason === "duplicate_staff"
        ? "Each guest needs a different technician."
        : assignment.reason === "unknown_staff"
          ? `Not an active Square team member: ${assignment.unavailable.join(", ")}.`
          : `Not available for the full appointment: ${assignment.unavailable.join(", ")}.`;
      return NextResponse.json({ error: SLOT_UNAVAILABLE_MESSAGE, step: "availability_check", detail }, { status: 409 });
    }

    const { customer } = await squareRequest<{ customer: { id: string } }>("create_customer", "/customers", {
      idempotency_key: `${parsed.requestId}-customer`,
      given_name: parsed.client.firstName,
      family_name: parsed.client.lastName,
      ...(parsed.client.email ? { email_address: parsed.client.email } : {}),
      phone_number: toE164(parsed.client.countryCode, parsed.client.phone),
      note: parsed.client.notes || undefined,
    });

    const segmentsByGuest = await buildAppointmentSegments(parsed, assignment.members.map((member) => member.teamMemberId));

    const bookings = [];
    for (const [index, guest] of parsed.guests.entries()) {
      const { booking } = await squareRequest<{ booking: { id: string } }>("create_booking", "/bookings", {
        idempotency_key: `${parsed.requestId}-${index + 1}`,
        booking: {
          location_id: locationId,
          start_at: new Date(parsed.startAt).toISOString(),
          customer_id: customer.id,
          customer_note: buildSellerNote(parsed, guest, index),
          seller_note: buildSellerNote(parsed, guest, index),
          appointment_segments: segmentsByGuest[index],
        },
      });
      bookings.push(booking.id);
    }

    return NextResponse.json({ booking: { id: bookings[0] }, bookingIds: bookings });
  } catch (error) {
    if (error instanceof SquareStepError) {
      console.error("[v0] Square booking failed:", error.message);
      return NextResponse.json(
        { error: "Square booking failed.", step: error.step, status: error.status, errors: error.errors, detail: error.errors.map((item) => item.detail).filter(Boolean).join("; ") },
        { status: 502 },
      );
    }
    console.error("[v0] Square booking failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Square booking failed.", step: "unknown", detail: "Unexpected server error." }, { status: 502 });
  }
}
