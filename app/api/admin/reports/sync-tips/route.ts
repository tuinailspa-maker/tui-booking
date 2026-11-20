import { NextResponse } from "next/server";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { isAdminRequestAuthorized } from "@/data/adminAuth";
import { REPORT_USER_ID, reportsDb, serviceRevenueReports } from "@/data/reports-db";
import { SQUARE_API_VERSION } from "@/data/squareConfig";

type SquarePayment = { order_id?: string; tip_money?: { amount?: number; currency?: string } };

export async function POST(request: Request) {
  if (!isAdminRequestAuthorized(request)) return NextResponse.json({ error: "Admin authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) return NextResponse.json({ error: "Square payment sync is not configured." }, { status: 503 });
  let body: { from?: string; to?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid date range." }, { status: 400 }); }
  if (!body.from || !body.to || !/^\d{4}-\d{2}-\d{2}$/.test(body.from) || !/^\d{4}-\d{2}-\d{2}$/.test(body.to) || body.from > body.to) return NextResponse.json({ error: "Provide a valid date range." }, { status: 400 });
  try {
    const records = await reportsDb.select().from(serviceRevenueReports).where(and(
      eq(serviceRevenueReports.userId, REPORT_USER_ID),
      gte(serviceRevenueReports.businessDate, body.from),
      lte(serviceRevenueReports.businessDate, body.to),
    ));
    const orderIds = [...new Set(records.flatMap((record) => record.squareOrderId ? [record.squareOrderId] : []))];
    if (orderIds.length === 0) return NextResponse.json({ syncedOrders: 0, syncedRecords: 0 });
    const beginTime = new Date(`${body.from}T00:00:00.000Z`).toISOString();
    const endTime = new Date(`${body.to}T23:59:59.999Z`).toISOString();
    const origin = process.env.SQUARE_ENVIRONMENT === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
    let cursor: string | undefined;
    const matchedPayments: SquarePayment[] = [];
    do {
      const url = new URL("/v2/payments", origin);
      url.searchParams.set("location_id", process.env.SQUARE_LOCATION_ID);
      url.searchParams.set("begin_time", beginTime);
      url.searchParams.set("end_time", endTime);
      url.searchParams.set("sort_order", "ASC");
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor", cursor);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`, "Square-Version": SQUARE_API_VERSION }, signal: AbortSignal.timeout(12000), cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return NextResponse.json({ error: payload.errors?.[0]?.detail || "Square could not return payments for this range." }, { status: response.status });
      matchedPayments.push(...(payload.payments ?? []).filter((payment: SquarePayment) => payment.order_id && orderIds.includes(payment.order_id)));
      cursor = payload.cursor;
    } while (cursor);

    const tipByOrder = new Map<string, number>();
    for (const payment of matchedPayments) {
      if (!payment.order_id || payment.tip_money?.currency && payment.tip_money.currency !== "CAD") continue;
      tipByOrder.set(payment.order_id, (tipByOrder.get(payment.order_id) ?? 0) + (payment.tip_money?.amount ?? 0));
    }
    let syncedRecords = 0;
    for (const [orderId, tipCents] of tipByOrder) {
      const orderRecords = records.filter((record) => record.squareOrderId === orderId);
      if (!orderRecords.length) continue;
      const subtotals = orderRecords.map((record) => Math.max(0, Math.round(Number(record.serviceSubtotal) * 100)));
      const subtotalTotal = subtotals.reduce((sum, value) => sum + value, 0);
      let allocated = 0;
      for (let index = 0; index < orderRecords.length; index++) {
        const share = index === orderRecords.length - 1
          ? tipCents - allocated
          : Math.round(tipCents * (subtotalTotal > 0 ? subtotals[index] / subtotalTotal : 1 / orderRecords.length));
        allocated += share;
        const row = orderRecords[index];
        await reportsDb.update(serviceRevenueReports).set({ tipAmount: (share / 100).toFixed(2), squareTipAmount: (share / 100).toFixed(2), updatedAt: new Date() }).where(and(
          eq(serviceRevenueReports.id, row.id),
          eq(serviceRevenueReports.userId, REPORT_USER_ID),
          inArray(serviceRevenueReports.squareOrderId, [orderId]),
        ));
        syncedRecords++;
      }
    }
    return NextResponse.json({ syncedOrders: tipByOrder.size, syncedRecords });
  } catch {
    return NextResponse.json({ error: "Could not sync Square tips for this date range." }, { status: 503 });
  }
}
