import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { isVerifiedOwner } from "@/data/teamAccess";
import { REPORT_USER_ID, reportsDb, serviceRevenueReports } from "@/data/reports-db";
import { bumpSquareSyncVersion } from "@/data/squareSync";
import { torontoDate, walkInBookingId } from "@/data/squareCheckoutSync";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_CENTS = 10_000_000;
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

type GuestInput = { guestIndex: number; guestName: string; technician: string; services: { name: string; amount: number }[]; serviceSubtotal: number };

const forbidden = () => NextResponse.json({ error: "Only the owner can edit payments." }, { status: 403, headers: NO_STORE });
const cleanText = (value: unknown, max = 120) => typeof value === "string" ? value.trim().slice(0, max) : "";
const toCents = (value: unknown) => {
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  const cents = Math.round(amount * 100);
  return Number.isFinite(amount) && cents >= 0 && cents <= MAX_CENTS ? cents : null;
};
const toAmount = (cents: number) => (cents / 100).toFixed(2);

/** Splits a cent amount by weight so the parts always add back up to the exact total. */
function allocate(totalCents: number, weights: number[]) {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  let allocated = 0;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return totalCents - allocated;
    const share = Math.round(totalCents * (weightTotal > 0 ? weight / weightTotal : 1 / weights.length));
    allocated += share;
    return share;
  });
}

function parseGuests(value: unknown): GuestInput[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) return null;
  const guests: GuestInput[] = [];
  for (const [position, raw] of value.entries()) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const subtotalCents = toCents(item.serviceSubtotal);
    if (subtotalCents === null || !Array.isArray(item.services) || item.services.length > 30) return null;
    const services = item.services.flatMap((service) => {
      const entry = service as Record<string, unknown>;
      const cents = toCents(entry?.amount);
      const name = cleanText(entry?.name);
      return name && cents !== null ? [{ name, amount: cents / 100 }] : [];
    });
    guests.push({ guestIndex: position, guestName: cleanText(item.guestName) || `Guest ${position + 1}`, technician: cleanText(item.technician, 60) || "Unassigned", services, serviceSubtotal: subtotalCents / 100 });
  }
  return guests;
}

export async function GET(request: Request) {
  if (!await isVerifiedOwner(request)) return forbidden();
  const bookingId = cleanText(new URL(request.url).searchParams.get("bookingId"), 200);
  if (!bookingId) return NextResponse.json({ error: "Provide a booking id." }, { status: 400, headers: NO_STORE });
  try {
    const records = await reportsDb.select().from(serviceRevenueReports).where(and(eq(serviceRevenueReports.userId, REPORT_USER_ID), eq(serviceRevenueReports.bookingId, bookingId))).orderBy(asc(serviceRevenueReports.guestIndex));
    return NextResponse.json({ records }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Payments storage is temporarily unavailable." }, { status: 503, headers: NO_STORE });
  }
}

/** Owner override: mark a booking paid (Card or Cash) with an exact tip and optional Square order, or clear it. */
export async function PUT(request: Request) {
  if (!await isVerifiedOwner(request)) return forbidden();
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers: NO_STORE }); }

  const bookingId = cleanText(body.bookingId, 200);
  const status = body.status === "unpaid" ? "unpaid" : body.status === "paid" ? "paid" : null;
  const paymentMethod = body.paymentMethod === "Cash" ? "Cash" : body.paymentMethod === "Card" ? "Card" : null;
  const tipCents = toCents(body.tipAmount ?? 0);
  const squareOrderId = cleanText(body.squareOrderId, 64) || null;
  const guests = parseGuests(body.guests);
  const technicians = Array.isArray(body.technicians) ? body.technicians.slice(0, 3).map((name) => cleanText(name, 60)) : [];
  const appointmentAt = typeof body.appointmentAt === "string" && !Number.isNaN(Date.parse(body.appointmentAt)) ? new Date(body.appointmentAt) : null;

  if (!bookingId || !status) return NextResponse.json({ error: "Provide a booking and payment status." }, { status: 400, headers: NO_STORE });
  if (status === "paid" && (!paymentMethod || tipCents === null || guests === null)) return NextResponse.json({ error: "Check the payment method, tip and services." }, { status: 400, headers: NO_STORE });
  if (squareOrderId && !ORDER_ID_PATTERN.test(squareOrderId)) return NextResponse.json({ error: "Square order ID can only contain letters, numbers, - and _." }, { status: 400, headers: NO_STORE });

  try {
    const scope = and(eq(serviceRevenueReports.userId, REPORT_USER_ID), eq(serviceRevenueReports.bookingId, bookingId));
    if (status === "unpaid") {
      await reportsDb.delete(serviceRevenueReports).where(scope);
      await bumpSquareSyncVersion("checkout.manual");
      return NextResponse.json({ records: [] }, { headers: NO_STORE });
    }

    if (squareOrderId) {
      const [owner] = await reportsDb.select({ bookingId: serviceRevenueReports.bookingId }).from(serviceRevenueReports).where(and(eq(serviceRevenueReports.userId, REPORT_USER_ID), eq(serviceRevenueReports.squareOrderId, squareOrderId)));
      if (owner && owner.bookingId !== bookingId && owner.bookingId !== walkInBookingId(squareOrderId)) {
        return NextResponse.json({ error: `Square order ${squareOrderId} is already recorded on another bill.` }, { status: 409, headers: NO_STORE });
      }
    }

    const existing = await reportsDb.select().from(serviceRevenueReports).where(scope).orderBy(asc(serviceRevenueReports.guestIndex));
    const now = new Date();
    if (existing.length > 0) {
      const shares = allocate(tipCents!, existing.map((row) => Number(row.serviceSubtotal) || 0));
      for (const [position, row] of existing.entries()) {
        await reportsDb.update(serviceRevenueReports).set({
          paymentMethod: paymentMethod!,
          tipAmount: toAmount(shares[position] ?? 0),
          squareOrderId,
          squareTipAmount: null,
          technician: technicians[position] || row.technician,
          updatedAt: now,
        }).where(eq(serviceRevenueReports.id, row.id));
      }
    } else {
      if (!guests || guests.length === 0) return NextResponse.json({ error: "This bill has no services yet. Add services before marking it paid." }, { status: 400, headers: NO_STORE });
      const transactedAt = appointmentAt ?? now;
      const shares = allocate(tipCents!, guests.map((guest) => guest.serviceSubtotal));
      for (const guest of guests) {
        await reportsDb.insert(serviceRevenueReports).values({
          id: createHash("sha256").update(`${bookingId}:${guest.guestIndex}`).digest("hex"),
          userId: REPORT_USER_ID,
          bookingId,
          guestIndex: guest.guestIndex,
          transactedAt,
          businessDate: torontoDate(transactedAt),
          guestName: guest.guestName,
          technician: technicians[guest.guestIndex] || guest.technician,
          services: guest.services,
          serviceSubtotal: guest.serviceSubtotal.toFixed(2),
          tipAmount: toAmount(shares[guest.guestIndex] ?? 0),
          paymentMethod: paymentMethod!,
          squareOrderId,
          squareTipAmount: null,
          discountAmount: "0.00",
          appointmentAt,
          updatedAt: now,
        });
      }
    }
    // Linking a booking to a Square order replaces any walk-in placeholder created for that order.
    if (squareOrderId && bookingId !== walkInBookingId(squareOrderId)) {
      await reportsDb.delete(serviceRevenueReports).where(and(eq(serviceRevenueReports.userId, REPORT_USER_ID), eq(serviceRevenueReports.bookingId, walkInBookingId(squareOrderId))));
    }
    await bumpSquareSyncVersion("checkout.manual");
    const records = await reportsDb.select().from(serviceRevenueReports).where(scope).orderBy(asc(serviceRevenueReports.guestIndex));
    return NextResponse.json({ records }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Payments storage is temporarily unavailable." }, { status: 503, headers: NO_STORE });
  }
}
