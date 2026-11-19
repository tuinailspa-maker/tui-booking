import { NextResponse } from "next/server";
import { selectedServiceDuration, serviceById, serviceDisplayNameWithAddOn } from "@/data/serviceTree";
import { BUSINESS_TIME_ZONE } from "@/data/staffSchedule";
import { SQUARE_API_VERSION, SQUARE_TEAM_MEMBER_IDS } from "@/data/squareConfig";

const API = process.env.SQUARE_ENVIRONMENT === "sandbox" ? "https://connect.squareupsandbox.com/v2" : "https://connect.squareup.com/v2";
const LOCATION_ID = process.env.SQUARE_LOCATION_ID || "R73A64VPAR34X";
const CHECKED_IN = "[TUI_CHECKED_IN]";
const WALK_IN = "[TUI_WALK_IN]";
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
function normalizePhone(value: string) { return value.replace(/\D/g, "").slice(-10); }
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
    const result = customer ? bookings.filter((booking) => booking.customer_id === customer.id).map((booking) => ({ id: booking.id, version: booking.version, name: [customer.given_name, customer.family_name].filter(Boolean).join(" ") || "Guest", time: booking.start_at, service: booking.seller_note?.match(/Services:\s*([\s\S]+?)(?:\. Guest subtotal|\. Combo discount:|$)/)?.[1]?.split(/;\s*/).map((line) => line.split(/\s+—\s+\$/)[0]).join(", ") || "Appointment", checkedIn: booking.seller_note?.includes(CHECKED_IN) ?? false })) : [];
    return NextResponse.json({ appointments: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.id !== "string" || typeof body.version !== "number") return NextResponse.json({ error: "Invalid appointment." }, { status: 400 });
  try {
    const current = await square<{ booking?: SquareBooking }>(`/bookings/${encodeURIComponent(body.id)}`);
    if (!current.booking || typeof current.booking.version !== "number") return NextResponse.json({ error: "Appointment could not be found." }, { status: 404 });
    await square(`/bookings/${encodeURIComponent(body.id)}`, "PUT", { booking: { version: current.booking.version, seller_note: `${current.booking.seller_note ?? ""} ${CHECKED_IN}`.trim() } });
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 100) : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim().slice(0, 30) : "";
  const serviceIds: string[] = Array.isArray(body?.serviceIds) ? body.serviceIds.filter((id: unknown): id is string => typeof id === "string" && serviceById.has(id)).slice(0, 8) : [];
  const guestCount = Number.isInteger(body?.guestCount) && body.guestCount >= 1 && body.guestCount <= 3 ? body.guestCount : 1;
  if (!name || normalizePhone(phone).length !== 10 || serviceIds.length === 0) return NextResponse.json({ error: "Enter a name, valid phone number, and at least one service." }, { status: 400 });
  try {
    const catalog = await square<{ objects?: CatalogItem[] }>("/catalog/search", "POST", { object_types: ["ITEM"], include_deleted_objects: false, limit: 100 });
    const selected = serviceIds.map((id) => serviceById.get(id)!);
    const service = selected[0];
    const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const variations = (catalog.objects ?? []).flatMap((item) => (item.item_data?.variations ?? []).map((variation) => ({ variation, name: normalized(`${item.item_data?.name ?? ""} ${variation.item_variation_data?.name ?? ""}`) })));
    const target = normalized(service.nameEn);
    const match = variations.find(({ variation, name: candidate }) => variation.item_variation_data?.available_for_booking && (candidate === target || candidate.includes(target)));
    if (!match) throw new Error(`No bookable Square service was found for ${service.nameEn}.`);
    const teamId = Object.values(SQUARE_TEAM_MEMBER_IDS)[0];
    const phoneNumber = phone.startsWith("+") ? `+${phone.replace(/\D/g, "")}` : `+1${phone.replace(/\D/g, "")}`;
    const customerSearch = await square<{ customers?: SquareCustomer[] }>("/customers/search", "POST", { query: { filter: { phone_number: { exact: phoneNumber } } }, limit: 1 });
    let customer = customerSearch.customers?.[0];
    if (!customer) {
      const parts = name.split(/\s+/); const created = await square<{ customer: SquareCustomer }>("/customers", "POST", { idempotency_key: crypto.randomUUID(), given_name: parts[0], family_name: parts.slice(1).join(" ") || undefined, phone_number: phoneNumber }); customer = created.customer;
    }
    const notes = `${WALK_IN} ${CHECKED_IN} Guests: ${guestCount}. Services: ${selected.map((item) => `${serviceDisplayNameWithAddOn(item, "en")} — $${item.priceCad} (${item.durationMinutes} min)`).join("; ")}. Guest subtotal $${selected.reduce((sum, item) => sum + item.priceCad, 0)} CAD.`;
    const duration = selected.reduce((sum, item) => sum + selectedServiceDuration(item), 0);
    const created = await square<{ booking: { id: string } }>("/bookings", "POST", { idempotency_key: crypto.randomUUID(), booking: { location_id: LOCATION_ID, start_at: new Date().toISOString(), customer_id: customer.id, seller_note: notes.slice(0, 500), appointment_segments: [{ duration_minutes: duration, service_variation_id: match.variation.id, service_variation_version: match.variation.version, team_member_id: teamId }] } });
    return NextResponse.json({ success: true, id: created.booking.id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}
