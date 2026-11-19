import { NextResponse } from "next/server";
import { serviceById, serviceDisplayName } from "@/data/serviceTree";
import { SQUARE_API_VERSION, SQUARE_TEAM_MEMBER_IDS } from "@/data/squareConfig";
import type { Technician } from "@/data/staffSchedule";

const SQUARE_PRODUCTION_URL = "https://connect.squareup.com/v2";
const SQUARE_SANDBOX_URL = "https://connect.squareupsandbox.com/v2";
const MAX_GUESTS = 3;
const MAX_SQUARE_NOTE_LENGTH = 500;
const REFERENCE_PATTERN = /^[A-Za-z0-9-]{4,40}$/;

type BookingGuest = { serviceIds: string[]; technician: Technician };
type BookingClient = { firstName: string; lastName: string; countryCode: string; phone: string; email: string; notes: string };
type BookingRequest = { reference: string; startAt: string; client: BookingClient; guests: BookingGuest[] };

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
  const countryCode = readText(client.countryCode, 6) ?? "+1";
  const phone = readText(client.phone, 30);
  const email = readText(client.email, 254);
  const notes = typeof client.notes === "string" ? client.notes.trim().slice(0, 500) : "";
  if (!firstName || !lastName || !phone || !email || !COUNTRY_CODE_PATTERN.test(countryCode)) return null;

  const parsedGuests: BookingGuest[] = [];
  for (const guest of guests as Record<string, unknown>[]) {
    if (!isTechnician(guest.technician) || !Array.isArray(guest.serviceIds) || guest.serviceIds.length === 0) return null;
    const serviceIds = guest.serviceIds.filter((id): id is string => typeof id === "string" && serviceById.has(id));
    if (serviceIds.length !== guest.serviceIds.length) return null;
    parsedGuests.push({ serviceIds, technician: guest.technician });
  }

  return { reference, startAt, client: { firstName, lastName, countryCode, phone, email, notes }, guests: parsedGuests };
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

type CatalogLocationScope = {
  present_at_all_locations?: boolean;
  present_at_location_ids?: string[];
  absent_at_location_ids?: string[];
};
type CatalogVariation = CatalogLocationScope & {
  id: string;
  version: number;
  item_variation_data?: { name?: string; available_for_booking?: boolean; team_member_ids?: string[] };
};
type CatalogItem = CatalogLocationScope & {
  id: string;
  item_data?: { name?: string; variations?: CatalogVariation[] };
};

function isAvailableAtLocation(scope: CatalogLocationScope, locationId: string) {
  const present = scope.present_at_all_locations === true || (scope.present_at_location_ids ?? []).includes(locationId);
  return present && !(scope.absent_at_location_ids ?? []).includes(locationId);
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function fetchCatalogItems(): Promise<CatalogItem[]> {
  const items: CatalogItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await squareRequest<{ objects?: CatalogItem[]; cursor?: string }>("catalog_search", "/catalog/search", {
      object_types: ["ITEM"],
      include_deleted_objects: false,
      limit: 100,
      cursor,
    });
    items.push(...(page.objects ?? []));
    cursor = page.cursor;
  } while (cursor);
  return items;
}

function resolveServiceVariation(items: CatalogItem[], locationId: string, guest: BookingGuest): CatalogVariation {
  const memberId = SQUARE_TEAM_MEMBER_IDS[guest.technician];
  const candidates = items
    .filter((item) => isAvailableAtLocation(item, locationId))
    .flatMap((item) =>
      (item.item_data?.variations ?? [])
        .filter((variation) => {
          const data = variation.item_variation_data;
          const teamIds = data?.team_member_ids ?? [];
          return (
            isAvailableAtLocation(variation, locationId) &&
            data?.available_for_booking === true &&
            (teamIds.length === 0 || teamIds.includes(memberId))
          );
        })
        .map((variation) => ({
          variation,
          name: normalizeName(`${item.item_data?.name ?? ""} ${variation.item_variation_data?.name ?? ""}`),
        })),
    );

  if (candidates.length === 0) {
    throw new SquareStepError("find_service_variation", 422, [
      { code: "NOT_FOUND", field: null, detail: `No bookable Square variation for ${guest.technician} at location ${locationId}.` },
    ]);
  }

  const service = serviceById.get(guest.serviceIds[0]);
  const target = service ? normalizeName(service.nameEn) : "";
  const match = candidates.find((candidate) => candidate.name === target) ?? candidates.find((candidate) => target && candidate.name.includes(target));
  return (match ?? candidates[0]).variation;
}

export async function POST(request: Request) {
  const parsed = parseBookingRequest(await request.json().catch(() => null));
  if (!parsed) {
    return NextResponse.json({ error: "Invalid booking request." }, { status: 400 });
  }

  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!process.env.SQUARE_ACCESS_TOKEN || !locationId) {
    return NextResponse.json({ error: "Square is not configured.", step: "config", detail: "SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID is missing." }, { status: 500 });
  }

  try {
    const { customer } = await squareRequest<{ customer: { id: string } }>("create_customer", "/customers", {
      idempotency_key: `${parsed.reference}-customer`,
      given_name: parsed.client.firstName,
      family_name: parsed.client.lastName,
      email_address: parsed.client.email,
      phone_number: toE164(parsed.client.countryCode, parsed.client.phone),
      note: parsed.client.notes || undefined,
    });

    const catalogItems = await fetchCatalogItems();

    const bookings = [];
    for (const [index, guest] of parsed.guests.entries()) {
      const variation = resolveServiceVariation(catalogItems, locationId, guest);
      const { booking } = await squareRequest<{ booking: { id: string } }>("create_booking", "/bookings", {
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
              service_variation_id: variation.id,
              service_variation_version: variation.version,
              team_member_id: SQUARE_TEAM_MEMBER_IDS[guest.technician],
            },
          ],
        },
      });
      bookings.push(booking.id);
    }

    return NextResponse.json({ bookingIds: bookings });
  } catch (error) {
    if (error instanceof SquareStepError) {
      console.error("[v0] Square booking failed:", error.message);
      return NextResponse.json(
        { error: "Square booking failed.", step: error.step, status: error.status, errors: error.errors },
        { status: 502 },
      );
    }
    console.error("[v0] Square booking failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Square booking failed.", step: "unknown", detail: "Unexpected server error." }, { status: 502 });
  }
}
