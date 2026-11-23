import { NextResponse } from "next/server";
import { selectedServiceDuration, serviceById, serviceDisplayNameWithAddOn } from "@/data/serviceTree";
import { BUSINESS_TIME_ZONE } from "@/data/staffSchedule";
import { SQUARE_API_VERSION, SQUARE_TEAM_MEMBER_IDS } from "@/data/squareConfig";
import { notifyOwnerSms, recordCheckIn, torontoTime } from "@/data/lateCheckin";

const API = process.env.SQUARE_ENVIRONMENT === "sandbox" ? "https://connect.squareupsandbox.com/v2" : "https://connect.squareup.com/v2";
const LOCATION_ID = process.env.SQUARE_LOCATION_ID || "R73A64VPAR34X";
const CHECKED_IN = "[TUI_CHECKED_IN:";
const WALK_IN = "[TUI_WALK_IN]";
const NO_SERVICE = "[TUI_NO_SERVICE]";
type SquareBooking = { id: string; version?: number; status?: string; start_at?: string; customer_id?: string; seller_note?: string; appointment_segments?: { duration_minutes?: number; service_variation_id?: string; team_member_id?: string }[] };
type SquareCustomer = { id: string; given_name?: string; family_name?: string; phone_number?: string };
type Variation = { id: string; version: number; item_variation_data?: { name?: string; available_for_booking?: boolean; team_member_ids?: string[] } };
type CatalogItem = { item_data?: { name?: string; variations?: Variation[] } };

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Square request failed.";
  return NextResponse.json({ error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
}
async function square<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  if (!process.env.SQUARE_ACCESS_TOKEN) throw new Error("Square is not configured.");
  const response = await fetch(`${API}${path}`, { method, cache: "no-store", headers: { Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`, "Square-Version": SQUARE_API_VERSION, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.errors?.map((item: { detail?: string }) => item.detail).filter(Boolean).join("; ") || `Square returned ${response.status}.`);
  return data as T;
}
function torontoDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function dayStart(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
  return new Date(guess - (Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - guess));
}
// The Square seller-note marker stays the source of truth for the kiosk; the DB row only feeds the late-guest cron.
async function saveCheckIn(bookingId: string, at: Date) {
  try { await recordCheckIn(bookingId, at); } catch (error) { console.error("Saving check-in status failed:", error); }
}
function normalizePhone(value: string) { return value.replace(/\D/g, "").slice(-10); }
function technicianName(id?: string) { return Object.entries(SQUARE_TEAM_MEMBER_IDS).find(([, teamMemberId]) => teamMemberId === id)?.[0] ?? "Unassigned"; }
async function todayBookings() {
  const date = torontoDate(); const start = dayStart(date); const end = dayStart(new Date(start.getTime() + 36 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const query = new URLSearchParams({ location_id: LOCATION_ID, start_at_min: start.toISOString(), start_at_max: new Date(start.getTime() + 36 * 60 * 60 * 1000).toISOString(), limit: "100" });
  const list: SquareBooking[] = []; let cursor: string | undefined;
  do { const page = await square<{ bookings?: SquareBooking[]; cursor?: string }>(`/bookings?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`); list.push(...(page.bookings ?? [])); cursor = page.cursor; } while (cursor);
  return list.filter((booking) => booking.start_at && Date.parse(booking.start_at) >= start.getTime() && Date.parse(booking.start_at) < end.getTime() && !["CANCELLED_BY_CUSTOMER", "CANCELLED_BY_SELLER", "DECLINED", "COMPLETED", "NO_SHOW"].includes(booking.status ?? ""));
}
export async function GET(request: Request) {
  const url = new URL(request.url);
  const phone = normalizePhone(url.searchParams.get("phone") ?? "");
  if (url.searchParams.get("customer") === "1") {
    if (phone.length !== 10) return NextResponse.json({ error: "Enter a 10-digit phone number." }, { status: 400 });
    try {
      const formatted = `+1${phone}`;
      const result = await square<{ customers?: SquareCustomer[] }>("/customers/search", "POST", { query: { filter: { phone_number: { exact: formatted } } }, limit: 1 });
      const customer = result.customers?.[0];
      return NextResponse.json({ name: [customer?.given_name, customer?.family_name].filter(Boolean).join(" ") }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) { return responseError(error); }
  }
  if (phone.length !== 10) return NextResponse.json({ error: "Enter a 10-digit phone number." }, { status: 400 });
  try {
    const [bookings, customerResult] = await Promise.all([
      todayBookings(),
      square<{ customers?: SquareCustomer[] }>("/customers/search", "POST", { query: { filter: { phone_number: { exact: `+1${phone}` } } }, limit: 1 }),
    ]);
    const customer = customerResult.customers?.[0];
    const result = customer ? bookings.filter((booking) => booking.customer_id === customer.id).map((booking) => ({ id: booking.id, version: booking.version, name: [customer.given_name, customer.family_name].filter(Boolean).join(" ") || "Guest", time: booking.start_at, service: booking.seller_note?.match(/Services:\s*([\s\S]+?)(?:\. Guest subtotal|\. Combo discount:|$)/)?.[1]?.split(/;\s*/).map((line) => line.split(/\s+—\s+\$/)[0]).join(", ") || "Appointment", technician: Array.from(new Set((booking.appointment_segments ?? []).map((segment) => technicianName(segment.team_member_id)))).filter((name) => name !== "Unassigned").join(", ") || "Unassigned", checkedIn: booking.seller_note?.includes(CHECKED_IN) || booking.seller_note?.includes("[TUI_CHECKED_IN]") || false })) : [];
    return NextResponse.json({ appointments: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string" || typeof body.version !== "number" || typeof body.phone !== "string" || normalizePhone(body.phone).length !== 10) return NextResponse.json({ error: "Invalid appointment." }, { status: 400 });
  try {
    const current = await square<{ booking?: SquareBooking }>(`/bookings/${encodeURIComponent(body.id)}`);
    if (!current.booking || typeof current.booking.version !== "number") return NextResponse.json({ error: "Appointment could not be found." }, { status: 404 });
    const booking = current.booking;
    const todaysBookings = await todayBookings();
    if (!booking.customer_id || !booking.start_at || !todaysBookings.some((item) => item.id === booking.id)) return NextResponse.json({ error: "This appointment is not available for check-in today." }, { status: 404 });
    const customer = await square<{ customer?: SquareCustomer }>(`/customers/${encodeURIComponent(booking.customer_id)}`);
    if (!customer.customer?.phone_number || normalizePhone(customer.customer.phone_number) !== normalizePhone(body.phone)) return NextResponse.json({ error: "The phone number does not match this appointment." }, { status: 403 });
    if (booking.seller_note?.includes(CHECKED_IN)) {
      await saveCheckIn(booking.id, new Date());
      return NextResponse.json({ success: true, alreadyCheckedIn: true }, { headers: { "Cache-Control": "no-store" } });
    }
    const arrivalAt = new Date().toISOString();
    const checkInMarker = `${CHECKED_IN}${arrivalAt}]`;
    const note = `${(booking.seller_note ?? "").slice(0, 500 - checkInMarker.length - 1)} ${checkInMarker}`.trim();
    await square(`/bookings/${encodeURIComponent(body.id)}`, "PUT", { booking: { version: booking.version, seller_note: note } });
    await saveCheckIn(booking.id, new Date(arrivalAt));
    const guestName = [customer.customer.given_name, customer.customer.family_name].filter(Boolean).join(" ") || "Guest";
    await notifyOwnerSms(`${guestName} (hẹn ${torontoTime(booking.start_at)}) đã check-in tại quầy`);
    return NextResponse.json({ success: true, arrivalAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 100) : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim().slice(0, 30) : "";
  const serviceIds: string[] = Array.isArray(body?.serviceIds) ? body.serviceIds.filter((id: unknown): id is string => typeof id === "string" && serviceById.has(id) && /^(hands-|enhancement-|feet-|waxing-)/.test(id)).slice(0, 8) : [];
  const guestCount = Number.isInteger(body?.guestCount) && body.guestCount >= 1 && body.guestCount <= 4 ? body.guestCount : 1;
  if (!name || normalizePhone(phone).length !== 10) return NextResponse.json({ error: "Enter a name and valid phone number." }, { status: 400 });
  try {
    const catalog = await square<{ objects?: CatalogItem[] }>("/catalog/search", "POST", { object_types: ["ITEM"], include_deleted_objects: false, limit: 100 });
    const selected = serviceIds.map((id) => serviceById.get(id)!);
    const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const variations = (catalog.objects ?? []).flatMap((item) => (item.item_data?.variations ?? []).map((variation) => ({ variation, name: normalized(`${item.item_data?.name ?? ""} ${variation.item_variation_data?.name ?? ""}`) })));
    const serviceMatches = selected.map((item) => {
      const target = normalized(item.nameEn);
      const match = variations.find(({ variation, name: candidate }) => variation.item_variation_data?.available_for_booking && (candidate === target || candidate.includes(target)));
      if (!match) throw new Error(`No bookable Square service was found for ${item.nameEn}.`);
      return { item, variation: match.variation };
    });
    const teamId = Object.values(SQUARE_TEAM_MEMBER_IDS)[0];
    const phoneNumber = phone.startsWith("+") ? `+${phone.replace(/\D/g, "")}` : `+1${phone.replace(/\D/g, "")}`;
    const customerSearch = await square<{ customers?: SquareCustomer[] }>("/customers/search", "POST", { query: { filter: { phone_number: { exact: phoneNumber } } }, limit: 1 });
    let customer = customerSearch.customers?.[0];
    if (!customer) {
      const parts = name.split(/\s+/); const created = await square<{ customer: SquareCustomer }>("/customers", "POST", { idempotency_key: crypto.randomUUID(), given_name: parts[0], family_name: parts.slice(1).join(" ") || undefined, phone_number: phoneNumber }); customer = created.customer;
    }
    const fallbackVariation = serviceMatches.length ? null : variations.find(({ variation }) => variation.item_variation_data?.available_for_booking)?.variation;
    if (!serviceMatches.length && !fallbackVariation) throw new Error("No bookable Square service is available to create the walk-in queue entry.");
    const queueAt = new Date();
    const bookingStartAt = new Date(queueAt.getTime() + 2 * 60_000);
    const notes = `${WALK_IN} [TUI_QUEUE_AT:${queueAt.toISOString()}] ${serviceMatches.length ? "" : `${NO_SERVICE} `}Guests: ${guestCount}. Services: ${selected.length ? selected.map((item) => `${serviceDisplayNameWithAddOn(item, "en")} — $${item.priceCad} (${selectedServiceDuration(item)} min)`).join("; ") : "No service selected"}. Guest subtotal $${selected.reduce((sum, item) => sum + item.priceCad, 0)} CAD.`;
    const segments = serviceMatches.length
      ? serviceMatches.map(({ item, variation }) => ({ duration_minutes: selectedServiceDuration(item), service_variation_id: variation.id, service_variation_version: variation.version, team_member_id: teamId }))
      : [{ duration_minutes: 15, service_variation_id: fallbackVariation!.id, service_variation_version: fallbackVariation!.version, team_member_id: teamId }];
    const created = await square<{ booking: { id: string } }>("/bookings", "POST", { idempotency_key: crypto.randomUUID(), booking: { location_id: LOCATION_ID, start_at: bookingStartAt.toISOString(), customer_id: customer.id, seller_note: notes.slice(0, 500), appointment_segments: segments } });
    await notifyOwnerSms(`Tui: new walk-in waiting - ${name}, ${phoneNumber}, ${guestCount} guest${guestCount > 1 ? "s" : ""}. Services: ${selected.length ? selected.map((item) => item.nameEn).join(", ") : "not chosen"}`);
    return NextResponse.json({ success: true, id: created.booking.id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}
