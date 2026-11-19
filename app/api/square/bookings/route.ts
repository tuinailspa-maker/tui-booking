import { NextResponse } from "next/server";
import { serviceById } from "@/data/serviceTree";
import {
  SQUARE_API_VERSION,
  SQUARE_FALLBACK_VARIATION,
  SQUARE_TEAM_MEMBER_IDS,
} from "@/data/squareConfig";
import type { Technician } from "@/data/staffSchedule";

const SQUARE_BASE_URL = "https://connect.squareup.com/v2";
const MAX_GUESTS = 3;
const MAX_SQUARE_NOTE_LENGTH = 500;
const REFERENCE_PATTERN = /^[A-Za-z0-9-]{4,40}$/;

type BookingGuest = { serviceIds: string[]; technician: Technician };
type BookingClient = { firstName: string; lastName: string; phone: string; email: string; notes: string };
type BookingRequest = { reference: string; startAt: string; client: BookingClient; guests: BookingGuest[] };

function isTechnician(value: unknown): value is Technician {
  return typeof value === "string" && value in SQUARE_TEAM_MEMBER_IDS;
}

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

function parseBookingRequest(body: unknown): BookingRequest | null {
  if (!body || typeof body !== "object") return null;
  const input = body as Record<string, unknown>;
  const reference = readText(input.reference, 40);
  const startAt = readText(input.startAt, 40);
  const client = input.client as Record<string, unknown> | undefined;
  const guests = input.guests;
  if (!reference || !REFERENCE_PATTERN.test(reference) || !startAt || Number.isNaN(Date.parse(startAt))) return null;
  if (!client || !Array.isArray(guests) || guests.length < 1 || guests.length > MAX_GUESTS) return null;

  const firstName = readText(client.firstName, 80);
  const lastName = readText(client.lastName, 80);
  const phone = readText(client.phone, 30);
  const email = readText(client.email, 254);
  const notes = typeof client.notes === "string" ? client.notes.trim().slice(0, 500) : "";
  if (!firstName || !lastName || !phone || !email) return null;

  const parsedGuests: BookingGuest[] = [];
  for (const guest of guests as Record<string, unknown>[]) {
    if (!isTechnician(guest.technician) || !Array.isArray(guest.serviceIds) || guest.serviceIds.length === 0) return null;
    const serviceIds = guest.serviceIds.filter((id): id is string => typeof id === "string" && serviceById.has(id));
    if (serviceIds.length !== guest.serviceIds.length) return null;
    parsedGuests.push({ serviceIds, technician: guest.technician });
  }

  return { reference, startAt, client: { firstName, lastName, phone, email, notes }, guests: parsedGuests };
}

async function squareRequest<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${SQUARE_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      "Square-Version": SQUARE_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Square ${path} failed: ${JSON.stringify(data.errors ?? response.status)}`);
  }
  return data as T;
}

function buildSellerNote(request: BookingRequest, guest: BookingGuest, guestIndex: number) {
  const lines = guest.serviceIds.map((id) => {
    const service = serviceById.get(id);
    return service ? `${service.nameEn} $${service.priceCad} (${service.durationMinutes} min)` : id;
  });
  const total = guest.serviceIds.reduce((sum, id) => sum + (serviceById.get(id)?.priceCad ?? 0), 0);
  const note = [
    `Ref ${request.reference}, guest ${guestIndex + 1}/${request.guests.length}.`,
    `Services: ${lines.join("; ")}. Total $${total} CAD.`,
    `Client: ${request.client.firstName} ${request.client.lastName}, ${request.client.phone}, ${request.client.email}.`,
  ].join(" ");
  return note.slice(0, MAX_SQUARE_NOTE_LENGTH);
}

function guestDurationMinutes(guest: BookingGuest) {
  return guest.serviceIds.reduce((sum, id) => sum + (serviceById.get(id)?.durationMinutes ?? 0), 0);
}

export async function POST(request: Request) {
  const parsed = parseBookingRequest(await request.json().catch(() => null));
  if (!parsed) {
    return NextResponse.json({ error: "Invalid booking request." }, { status: 400 });
  }

  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!process.env.SQUARE_ACCESS_TOKEN || !locationId) {
    return NextResponse.json({ error: "Square is not configured." }, { status: 500 });
  }

  try {
    const { customer } = await squareRequest<{ customer: { id: string } }>("/customers", {
      idempotency_key: `${parsed.reference}-customer`,
      given_name: parsed.client.firstName,
      family_name: parsed.client.lastName,
      email_address: parsed.client.email,
      note: parsed.client.notes || undefined,
    });

    const bookings = [];
    for (const [index, guest] of parsed.guests.entries()) {
      const { booking } = await squareRequest<{ booking: { id: string } }>("/bookings", {
        idempotency_key: `${parsed.reference}-${index + 1}`,
        booking: {
          location_id: locationId,
          start_at: new Date(parsed.startAt).toISOString(),
          customer_id: customer.id,
          customer_note: parsed.client.notes || undefined,
          seller_note: buildSellerNote(parsed, guest, index),
          appointment_segments: [
            {
              duration_minutes: guestDurationMinutes(guest),
              service_variation_id: SQUARE_FALLBACK_VARIATION.id,
              service_variation_version: SQUARE_FALLBACK_VARIATION.version,
              team_member_id: SQUARE_TEAM_MEMBER_IDS[guest.technician],
            },
          ],
        },
      });
      bookings.push(booking.id);
    }

    return NextResponse.json({ bookingIds: bookings });
  } catch (error) {
    console.error("[v0] Square booking sync failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Square booking failed." }, { status: 502 });
  }
}
