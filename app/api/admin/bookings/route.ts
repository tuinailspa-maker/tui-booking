import { NextResponse } from "next/server";
import { isAdminRequestAuthorized } from "@/data/adminAuth";
import { SQUARE_API_VERSION, SQUARE_TEAM_MEMBER_IDS } from "@/data/squareConfig";
import { allServices, serviceDisplayNameWithAddOn, type ServiceAddOnKey } from "@/data/serviceTree";
import { BUSINESS_TIME_ZONE } from "@/data/staffSchedule";

const SQUARE_PRODUCTION_URL = "https://connect.squareup.com/v2";
const SQUARE_SANDBOX_URL = "https://connect.squareupsandbox.com/v2";
const ADMIN_LOCATION_ID = "R73A64VPAR34X";
const INACTIVE_STATUSES = new Set(["CANCELLED_BY_CUSTOMER", "CANCELLED_BY_SELLER", "DECLINED", "COMPLETED", "NO_SHOW"]);
const NO_SERVICE_MARKER = "[TUI_NO_SERVICE]";


type SquareBooking = {
  id: string;
  version?: number;
  status?: string;
  start_at?: string;
  customer_id?: string;
  seller_note?: string;
  customer_note?: string;
  appointment_segments?: { duration_minutes?: number; team_member_id?: string; service_variation_id?: string }[];
};
type SquareCustomer = { given_name?: string; family_name?: string; phone_number?: string };
type SquareCatalogItem = { item_data?: { name?: string; variations?: { id: string; item_variation_data?: { name?: string } }[] } };

type ServiceSelection = { serviceIds: string[]; addOns: Record<string, ServiceAddOnKey> };

function squareBaseUrl() {
  return process.env.SQUARE_ENVIRONMENT === "sandbox" ? SQUARE_SANDBOX_URL : SQUARE_PRODUCTION_URL;
}

function torontoMidnightUtc(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const targetUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const localParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(targetUtc));
  const values = Object.fromEntries(localParts.map((part) => [part.type, part.value]));
  const representedUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
  return new Date(targetUtc - (representedUtc - targetUtc));
}

function nextDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function parseSellerNote(note: string | undefined): ServiceSelection {
  if (note?.includes(NO_SERVICE_MARKER)) return { serviceIds: [], addOns: {} };
  const match = note?.match(/Services:\s*([\s\S]+?)(?:\. Guest subtotal|\. Combo discount:|$)/);
  const serviceIds: string[] = [];
  const addOns: Record<string, ServiceAddOnKey> = {};
  if (!match) return { serviceIds, addOns };

  for (const rawLine of match[1].split(/;\s*/)) {
    const label = rawLine.split(/\s+—\s+\$/)[0]?.trim();
    if (!label) continue;
    const found = allServices.flatMap((service) => {
      const keys: (ServiceAddOnKey | undefined)[] = service.addOn ? [undefined, service.addOn.key] : [undefined];
      return keys.map((addOnKey) => ({ service, addOnKey, label: serviceDisplayNameWithAddOn(service, "en", addOnKey) }));
    }).find((item) => item.label === label);
    if (found) {
      serviceIds.push(found.service.id);
      if (found.addOnKey) addOns[found.service.id] = found.addOnKey;
    }
  }
  return { serviceIds, addOns };
}

function parseCatalogVariation(name: string): ServiceSelection {
  const normalizedName = normalize(name);
  if (!normalizedName) return { serviceIds: [], addOns: {} };
  const exactNameMatches = allServices.filter((service) => normalize(service.nameEn) === normalizedName);
  if (exactNameMatches.length === 1) return { serviceIds: [exactNameMatches[0].id], addOns: {} };
  const paddedName = ` ${normalizedName} `;
  const nameMatches = allServices.filter((service) => paddedName.includes(` ${normalize(service.nameEn)} `));
  const longestAliasLength = Math.max(0, ...nameMatches.map((service) => normalize(service.nameEn).length));
  const longestAliases = nameMatches.filter((service) => normalize(service.nameEn).length === longestAliasLength);
  if (longestAliases.length === 1) return { serviceIds: [longestAliases[0].id], addOns: {} };
  const candidates = allServices.flatMap((service) => {
    const keys: (ServiceAddOnKey | undefined)[] = service.addOn ? [undefined, service.addOn.key] : [undefined];
    return keys.map((addOnKey) => ({ service, addOnKey, label: normalize(serviceDisplayNameWithAddOn(service, "en", addOnKey)) }));
  }).filter((candidate) => candidate.label && normalizedName.includes(candidate.label));
  const candidate = candidates.sort((left, right) => right.label.length - left.label.length)[0];
  if (!candidate) return { serviceIds: [], addOns: {} };
  return { serviceIds: [candidate.service.id], addOns: candidate.addOnKey ? { [candidate.service.id]: candidate.addOnKey } : {} };
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function squareRequest<T>(path: string, method: "GET" | "PUT" = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${squareBaseUrl()}${path}`, {
    method,
    cache: "no-store",
    headers: { Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`, "Square-Version": SQUARE_API_VERSION, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = Array.isArray(data.errors) ? data.errors.map((error: { detail?: string }) => error.detail).filter(Boolean).join("; ") : "";
    throw new Error(details || `Square returned HTTP ${response.status}.`);
  }
  return data as T;
}

async function fetchBookings(startAt: Date, endAt: Date) {
  const bookings: SquareBooking[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({
      location_id: ADMIN_LOCATION_ID,
      start_at_min: startAt.toISOString(),
      start_at_max: endAt.toISOString(),
      limit: "100",
    });
    if (cursor) query.set("cursor", cursor);
    const page = await squareRequest<{ bookings?: SquareBooking[]; cursor?: string }>(`/bookings?${query}`);
    bookings.push(...(page.bookings ?? []));
    cursor = page.cursor;
  } while (cursor);
  return bookings.filter((booking) => {
    const startTime = booking.start_at ? Date.parse(booking.start_at) : Number.NaN;
    return !INACTIVE_STATUSES.has(booking.status ?? "") && Number.isFinite(startTime) && startTime >= startAt.getTime() && startTime < endAt.getTime();
  });
}

async function fetchCustomer(customerId: string): Promise<SquareCustomer | null> {
  try {
    const result = await squareRequest<{ customer?: SquareCustomer }>(`/customers/${encodeURIComponent(customerId)}`);
    return result.customer ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  if (!isAdminRequestAuthorized(request)) {
    return NextResponse.json({ error: "Admin authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) {
    return NextResponse.json({ error: "Provide a valid date in YYYY-MM-DD format." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!process.env.SQUARE_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Square is not configured. Set SQUARE_ACCESS_TOKEN." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const startAt = torontoMidnightUtc(date);
    const endAt = torontoMidnightUtc(nextDate(date));
    const squareBookings = await fetchBookings(startAt, endAt);
    const customerIds = Array.from(new Set(squareBookings.map((booking) => booking.customer_id).filter((id): id is string => Boolean(id))));
    const customers: [string, SquareCustomer | null][] = [];
    for (let index = 0; index < customerIds.length; index += 10) {
      const batch = await Promise.all(customerIds.slice(index, index + 10).map(async (id) => [id, await fetchCustomer(id)] as [string, SquareCustomer | null]));
      customers.push(...batch);
    }
    const customerById = new Map(customers);

    const variationNames = new Map<string, string>();
    const hasUnparsedCatalogServices = squareBookings.some((booking) =>
      !booking.seller_note?.includes(NO_SERVICE_MARKER) && parseSellerNote(booking.seller_note).serviceIds.length === 0 && booking.appointment_segments?.some((segment) => segment.service_variation_id),
    );
    if (hasUnparsedCatalogServices) {
      try {
        let cursor: string | undefined;
        do {
          const query = new URLSearchParams({ types: "ITEM", limit: "100" });
          if (cursor) query.set("cursor", cursor);
          const catalog = await squareRequest<{ objects?: SquareCatalogItem[]; cursor?: string }>(`/catalog/list?${query}`);
          for (const item of catalog.objects ?? []) {
            for (const variation of item.item_data?.variations ?? []) {
              variationNames.set(variation.id, `${item.item_data?.name ?? ""} ${variation.item_variation_data?.name ?? ""}`);
            }
          }
          cursor = catalog.cursor;
        } while (cursor);
      } catch {
        variationNames.clear();
      }
    }

    const individualBookings = squareBookings.map((booking) => {
      const segments = booking.appointment_segments ?? [];
      const technicians = Array.from(new Set(segments.map((segment) =>
        Object.entries(SQUARE_TEAM_MEMBER_IDS).find(([name, id]) => ["Jenny", "Melika", "Nana"].includes(name) && id === segment.team_member_id)?.[0],
      ).filter((name): name is string => Boolean(name))));
      const parsed = parseSellerNote(booking.seller_note);
      const segmentSelections = booking.seller_note?.includes(NO_SERVICE_MARKER) ? [] : segments.flatMap((segment) => segment.service_variation_id
        ? [parseCatalogVariation(variationNames.get(segment.service_variation_id) ?? "")]
        : []);
      const serviceSelection = parsed.serviceIds.length > 0
        ? parsed
        : {
          serviceIds: segmentSelections.flatMap((selection) => selection.serviceIds),
          addOns: Object.assign({}, ...segmentSelections.map((selection) => selection.addOns)),
        };
      const customer = booking.customer_id ? customerById.get(booking.customer_id) : null;
      const fullName = [customer?.given_name, customer?.family_name].filter(Boolean).join(" ");
      const groupMarker = booking.seller_note?.match(/Booking request ([^,]+), guest (\d+)\/(\d+)/);
      const extraGuests = Math.max(0, Number(groupMarker?.[3] ?? 1) - 1);
      return {
        id: booking.id,
        groupKey: groupMarker?.[1] ?? booking.id,
        guestIndex: Number(groupMarker?.[2] ?? 1),
        status: booking.seller_note?.match(/\[TUI_STATUS:(BOOKED|CHECKED_IN|IN_SERVICE|CHECKED_OUT)\]/)?.[1] ?? (booking.seller_note?.includes("[TUI_WALK_IN]") ? "WALK_IN_WAITING" : booking.seller_note?.includes("[TUI_CHECKED_IN:") || booking.seller_note?.includes("[TUI_CHECKED_IN]") ? "CHECKED_IN" : booking.status ?? "UNKNOWN"),
        arrivalAt: booking.seller_note?.match(/\[TUI_CHECKED_IN:(\d{4}-\d{2}-\d{2}T[^\]]+)\]/)?.[1] ?? null,
        startAt: booking.seller_note?.match(/\[TUI_QUEUE_AT:(\d{4}-\d{2}-\d{2}T[^\]]+)\]/)?.[1] ?? booking.start_at ?? "",
        customerName: `${fullName || "Square customer"}${extraGuests ? ` + ${extraGuests} ${extraGuests === 1 ? "guest" : "guests"}` : ""}`,
        phone: customer?.phone_number ?? "",
        technician: technicians.join(", ") || "Unassigned",
        serviceIds: serviceSelection.serviceIds,
        addOns: serviceSelection.addOns,
        sellerNote: booking.seller_note ?? "",
        customerNote: booking.customer_note ?? "",
        durationMinutes: (booking.appointment_segments ?? []).reduce((sum, segment) => sum + (segment.duration_minutes ?? 0), 0),
      };
    });
    const groupedBookings = new Map<string, typeof individualBookings>();
    for (const booking of individualBookings) {
      groupedBookings.set(booking.groupKey, [...(groupedBookings.get(booking.groupKey) ?? []), booking]);
    }
    const bookings = Array.from(groupedBookings.values()).map((group) => {
      const guests = group.sort((left, right) => left.guestIndex - right.guestIndex);
      return {
        id: guests[0].id,
        squareBookingIds: guests.map((guest) => guest.id),
        status: guests.every((guest) => guest.status === guests[0].status) ? guests[0].status : "MIXED",
        arrivalAt: guests.map((guest) => guest.arrivalAt).find((value) => value) ?? null,
        startAt: guests[0].startAt,
        customerName: guests[0].customerName,
        phone: guests[0].phone,
        technicians: Array.from(new Set(guests.flatMap((guest) => guest.technician.split(", ")))),
        serviceIds: guests.map((guest) => guest.serviceIds),
        addOns: guests.map((guest) => guest.addOns),
        guestNames: guests.map((guest) => guest.customerName),
        guestPhones: guests.map((guest) => guest.phone),
        durationMinutes: guests.reduce((sum, guest) => sum + guest.durationMinutes, 0),
      };
    }).sort((left, right) => left.startAt.localeCompare(right.startAt));

    return NextResponse.json({ bookings, date, locationId: ADMIN_LOCATION_ID }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Square appointments.";
    return NextResponse.json({ error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PATCH(request: Request) {
  if (!isAdminRequestAuthorized(request)) {
    return NextResponse.json({ error: "Admin authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (!process.env.SQUARE_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Square is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const body = await request.json().catch(() => null);
  const bookingId = typeof body?.bookingId === "string" ? body.bookingId : "";
  const teamMemberId = typeof body?.teamMemberId === "string" ? body.teamMemberId : "";
  const status = typeof body?.status === "string" && ["BOOKED", "CHECKED_IN", "IN_SERVICE", "CHECKED_OUT"].includes(body.status) ? body.status : "";
  const shouldAssign = Boolean(teamMemberId && Object.values(SQUARE_TEAM_MEMBER_IDS).includes(teamMemberId));
  if (!bookingId || (!status && !shouldAssign) || (teamMemberId && !shouldAssign)) {
    return NextResponse.json({ error: "Choose a valid appointment, technician, or status." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const current = await squareRequest<{ booking?: SquareBooking }>(`/bookings/${encodeURIComponent(bookingId)}`);
    if (!current.booking || typeof current.booking.version !== "number") {
      return NextResponse.json({ error: "Appointment could not be found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    if (shouldAssign && !current.booking.appointment_segments?.length) {
      return NextResponse.json({ error: "This appointment has no assignable service segments." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const patch: Record<string, unknown> = { version: current.booking.version };
    if (shouldAssign) patch.appointment_segments = current.booking.appointment_segments?.map((segment) => ({ ...segment, team_member_id: teamMemberId }));
    if (status) {
      const marker = `[TUI_STATUS:${status}]`;
      let note = (current.booking.seller_note ?? "").replace(/\s?\[TUI_STATUS:(?:BOOKED|CHECKED_IN|IN_SERVICE|CHECKED_OUT)\]/g, "").trim();
      if (status === "CHECKED_IN" && !note.includes("[TUI_CHECKED_IN")) note = `${note} [TUI_CHECKED_IN:${new Date().toISOString()}]`.trim();
      if (status === "BOOKED") note = note.replace(/\s?\[TUI_CHECKED_IN(?::[^\]]+)?\]/g, "").trim();
      note = `${note.slice(0, Math.max(0, 500 - marker.length - 1)).trim()} ${marker}`.trim();
      patch.seller_note = note;
    }
    const result = await squareRequest<{ booking: SquareBooking }>(`/bookings/${encodeURIComponent(bookingId)}`, "PUT", { booking: patch });
    return NextResponse.json({ success: true, version: result.booking.version }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update appointment.";
    return NextResponse.json({ error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
