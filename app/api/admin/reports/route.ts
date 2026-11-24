import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { isVerifiedOwner, verifyAdminSession } from "@/data/teamAccess";
import { REPORT_USER_ID, reportsDb, serviceRevenueReports } from "@/data/reports-db";

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function getMontrealDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function GET(request: Request) {
  const session = await verifyAdminSession(request);
  if (!session) return NextResponse.json({ error: "Admin authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!isDate(from) || !isDate(to) || from > to) return NextResponse.json({ error: "Provide a valid date range." }, { status: 400 });
  try {
    const records = await reportsDb.select().from(serviceRevenueReports).where(and(
      eq(serviceRevenueReports.userId, REPORT_USER_ID),
      gte(serviceRevenueReports.businessDate, from),
      lte(serviceRevenueReports.businessDate, to),
      session.role === "staff" ? eq(serviceRevenueReports.technician, session.name) : undefined,
    )).orderBy(asc(serviceRevenueReports.transactedAt), asc(serviceRevenueReports.guestIndex));
    return NextResponse.json({ records, role: session.role, viewer: session.name, webhookConfigured: Boolean(process.env.GOOGLE_SHEETS_REPORTS_WEBHOOK_URL) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Reports storage is temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!await isVerifiedOwner(request)) return NextResponse.json({ error: "Only the owner can record checkouts." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid checkout report." }, { status: 400 });
  const payload = body as Record<string, unknown>;
  const bookingId = typeof payload.bookingId === "string" ? payload.bookingId.trim().slice(0, 180) : "";
  const transactionId = typeof payload.transactionId === "string" ? payload.transactionId.trim().slice(0, 180) : "";
  const paymentMethod = payload.paymentMethod;
  const guest = payload.guest;
  const squareOrderId = typeof payload.squareOrderId === "string" ? payload.squareOrderId.trim().slice(0, 180) || null : null;
  if (!bookingId || !transactionId || !guest || typeof guest !== "object" || (paymentMethod !== "Card" && paymentMethod !== "Cash")) return NextResponse.json({ error: "Missing or invalid checkout details." }, { status: 400 });
  const entry = guest as Record<string, unknown>;
  const guestIndex = entry.guestIndex;
  const guestName = typeof entry.guestName === "string" ? entry.guestName.trim().slice(0, 180) : "";
  const technician = typeof entry.technician === "string" ? entry.technician.trim().slice(0, 100) : "";
  const serviceSubtotal = entry.serviceSubtotal;
  const tipAmount = entry.tipAmount;
  const services = entry.services;
  if (!Number.isInteger(guestIndex) || (guestIndex as number) < 0 || !guestName || !technician || typeof serviceSubtotal !== "number" || !Number.isFinite(serviceSubtotal) || serviceSubtotal < 0 || typeof tipAmount !== "number" || !Number.isFinite(tipAmount) || tipAmount < 0 || tipAmount > 10000 || !Array.isArray(services) || services.length > 50 || services.some((service) => !service || typeof service.name !== "string" || typeof service.amount !== "number" || !Number.isFinite(service.amount) || service.amount < 0)) {
    return NextResponse.json({ error: "Invalid guest transaction values." }, { status: 400 });
  }
  const discountAmount = entry.discountAmount ?? 0;
  if (typeof discountAmount !== "number" || !Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > 100000) {
    return NextResponse.json({ error: "Invalid discount amount." }, { status: 400 });
  }
  const appointmentAtInput = typeof payload.appointmentAt === "string" ? new Date(payload.appointmentAt) : null;
  const appointmentAt = appointmentAtInput && !Number.isNaN(appointmentAtInput.getTime()) ? appointmentAtInput : null;
  const transactionDate = new Date();
  const record = {
    id: createHash("sha256").update(`${bookingId}:${guestIndex}`).digest("hex"),
    userId: REPORT_USER_ID,
    bookingId,
    guestIndex: guestIndex as number,
    transactedAt: transactionDate,
    businessDate: getMontrealDate(transactionDate),
    guestName,
    technician,
    services: services as Array<{ name: string; amount: number }>,
    serviceSubtotal: serviceSubtotal.toFixed(2),
    tipAmount: tipAmount.toFixed(2),
    paymentMethod,
    squareOrderId,
    discountAmount: discountAmount.toFixed(2),
    appointmentAt,
    updatedAt: transactionDate,
  };
  try {
    const [saved] = await reportsDb.insert(serviceRevenueReports).values(record).onConflictDoUpdate({
      target: [serviceRevenueReports.userId, serviceRevenueReports.bookingId, serviceRevenueReports.guestIndex],
      set: {
        transactedAt: record.transactedAt,
        businessDate: record.businessDate,
        guestName: record.guestName,
        technician: record.technician,
        services: record.services,
        serviceSubtotal: record.serviceSubtotal,
        tipAmount: record.tipAmount,
        paymentMethod: record.paymentMethod,
        squareOrderId: record.squareOrderId,
        squareTipAmount: null,
        discountAmount: record.discountAmount,
        appointmentAt: record.appointmentAt,
        updatedAt: record.updatedAt,
      },
    }).returning();
    const webhookUrl = process.env.GOOGLE_SHEETS_REPORTS_WEBHOOK_URL;
    let webhookDelivered: boolean | null = null;
    if (webhookUrl) {
      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": `${bookingId}:${guestIndex}` },
          body: JSON.stringify({ event: "checkout.completed", transactionId, bookingId, squareOrderId, paymentMethod, ...entry, transactedAt: transactionDate.toISOString(), businessDate: record.businessDate }),
          signal: AbortSignal.timeout(8000),
        });
        webhookDelivered = response.ok;
      } catch { webhookDelivered = false; }
    }
    return NextResponse.json({ record: saved, webhookConfigured: Boolean(webhookUrl), webhookDelivered }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Could not save this checkout to Neon. The appointment was not marked checked out." }, { status: 503 });
  }
}
