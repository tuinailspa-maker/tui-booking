import { NextResponse } from "next/server";
import { SQUARE_API_VERSION, SQUARE_TEAM_MEMBER_IDS } from "@/data/squareConfig";
import { isWithinBusinessHours, type Technician } from "@/data/staffSchedule";

const baseUrl = () => process.env.SQUARE_ENVIRONMENT === "sandbox" ? "https://connect.squareupsandbox.com/v2" : "https://connect.squareup.com/v2";

export async function POST(request: Request) {
  const input: unknown = await request.json().catch(() => null);
  if (!input || typeof input !== "object") return NextResponse.json({ error: "Invalid availability request." }, { status: 400 });
  const body = input as { startAt?: unknown; guests?: unknown };
  const startMs = typeof body.startAt === "string" ? Date.parse(body.startAt) : Number.NaN;
  const guests = body.guests as { technician?: unknown; durationMinutes?: unknown }[] | undefined;
  if (!Number.isFinite(startMs) || !Array.isArray(guests) || guests.length < 1 || guests.length > 3 || !guests.every((guest) => guest && typeof guest.technician === "string" && guest.technician in SQUARE_TEAM_MEMBER_IDS && Number.isInteger(guest.durationMinutes) && Number(guest.durationMinutes) > 0 && Number(guest.durationMinutes) <= 600)) {
    return NextResponse.json({ error: "Invalid availability request." }, { status: 400 });
  }
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!token || !locationId) return NextResponse.json({ error: "Square is not configured." }, { status: 500 });
  const requestedGuests = guests as { technician: Technician; durationMinutes: number }[];
  if (!isWithinBusinessHours(new Date(startMs), Math.max(...requestedGuests.map((guest) => guest.durationMinutes)))) {
    return NextResponse.json({ available: false, availableTechnicians: [] });
  }
  const names = requestedGuests.map((guest) => guest.technician);
  if (new Set(names).size !== names.length) return NextResponse.json({ available: false, availableTechnicians: [] });
  const results = await Promise.all(requestedGuests.map(async ({ technician: name, durationMinutes }) => {
    const endAt = new Date(startMs + durationMinutes * 60_000).toISOString();
    const params = new URLSearchParams({ location_id: locationId, team_member_id: SQUARE_TEAM_MEMBER_IDS[name], start_at_min: new Date(startMs - 86_400_000).toISOString(), start_at_max: new Date(startMs + 86_400_000).toISOString(), limit: "100" });
    const response = await fetch(`${baseUrl()}/bookings?${params}`, { headers: { Authorization: `Bearer ${token}`, "Square-Version": SQUARE_API_VERSION } });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error("Square could not check appointment availability.");
    const busy = (result?.bookings ?? []).some((booking: { status?: string; start_at?: string; appointment_segments?: { duration_minutes?: number }[] }) => {
      if (["CANCELLED_BY_CUSTOMER", "CANCELLED_BY_SELLER", "DECLINED"].includes(booking.status ?? "")) return false;
      const busyStart = Date.parse(booking.start_at ?? "");
      const busyMinutes = (booking.appointment_segments ?? []).reduce((total, segment) => total + (segment.duration_minutes ?? 0), 0);
      return Number.isFinite(busyStart) && busyMinutes > 0 && busyStart < Date.parse(endAt) && busyStart + busyMinutes * 60_000 > startMs;
    });
    return busy ? null : name;
  }));
  const availableTechnicians = results.filter((name): name is Technician => name !== null);
  return NextResponse.json({ available: availableTechnicians.length === names.length, availableTechnicians });
}
