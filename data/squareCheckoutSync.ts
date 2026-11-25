import { createHash } from "node:crypto";
import { and, eq, gte, inArray } from "drizzle-orm";
import { calculateBill, taxCents } from "@/data/billing";
import { REPORT_USER_ID, reportsDb, serviceRevenueReports } from "@/data/reports-db";
import { SQUARE_API_VERSION } from "@/data/squareConfig";
import type { SquarePaymentSummary } from "@/data/squarePayment";
import { getStaffRoster } from "@/data/squareStaff";
import { getServiceVariationLinks } from "@/data/squareVariations";
import { allServices, serviceById, serviceDisplayNameWithAddOn, type ServiceAddOnKey } from "@/data/serviceTree";
import { BUSINESS_TIME_ZONE } from "@/data/staffSchedule";

export const ADMIN_LOCATION_ID = "R73A64VPAR34X";
const NO_SERVICE_MARKER = "[TUI_NO_SERVICE]";
const GROUP_MARKER = /Booking request ([^,]+), guest (\d+)\/(\d+)/;
const INACTIVE_STATUSES = new Set(["CANCELLED_BY_CUSTOMER", "CANCELLED_BY_SELLER", "DECLINED", "NO_SHOW"]);
/** A Square checkout can close a little before the booked start (early arrival) or hours after it. */
const EARLY_CHECKOUT_WINDOW_MS = 3 * 60 * 60 * 1000;
const LATE_CHECKOUT_WINDOW_MS = 12 * 60 * 60 * 1000;

export type SyncSegment = { duration_minutes?: number; team_member_id?: string; service_variation_id?: string };
export type SyncBooking = { id: string; status?: string; start_at?: string; customer_id?: string; seller_note?: string; appointment_segments?: SyncSegment[] };
export type ServiceSelection = { serviceIds: string[]; addOns: Record<string, ServiceAddOnKey> };
export type BookingGroup = { key: string; primaryId: string; bookings: SyncBooking[] };
export type ReconciledCheckout = { bookingId: string; serviceIds: string[][]; addOns: Record<string, ServiceAddOnKey>[]; payment: SquarePaymentSummary };

type VariationRef = { serviceId: string; addOnKey?: ServiceAddOnKey };
export type VariationIndex = { byVariationId: Map<string, VariationRef>; linkedServiceIds: Set<string> };

type SquareMoney = { amount?: number };
type SquareOrder = {
  id: string;
  reference_id?: string;
  customer_id?: string;
  state?: string;
  closed_at?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, string>;
  line_items?: { catalog_object_id?: string; name?: string; variation_name?: string; base_price_money?: SquareMoney }[];
  taxes?: { percentage?: string; applied_money?: SquareMoney }[];
  service_charges?: { name?: string; applied_money?: SquareMoney; total_money?: SquareMoney }[];
  tenders?: { type?: string; customer_id?: string }[];
  total_money?: SquareMoney;
  total_tax_money?: SquareMoney;
  total_tip_money?: SquareMoney;
  total_discount_money?: SquareMoney;
};

function squareBaseUrl() {
  return process.env.SQUARE_ENVIRONMENT === "sandbox" ? "https://connect.squareupsandbox.com/v2" : "https://connect.squareup.com/v2";
}

async function squareRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${squareBaseUrl()}${path}`, {
    method: body ? "POST" : "GET",
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

export function torontoDate(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function torontoMidnightUtc(date: string) {
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

export function nextDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

/** Reads the "Services: …" list the booking flow writes into the seller note. */
export function parseSellerNoteServices(note: string | undefined): ServiceSelection {
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

export async function loadVariationIndex(): Promise<VariationIndex> {
  const index: VariationIndex = { byVariationId: new Map(), linkedServiceIds: new Set() };
  try {
    for (const [key, variation] of await getServiceVariationLinks()) {
      const [serviceId, addOnKey] = key.split(":");
      if (!serviceById.has(serviceId) || index.byVariationId.has(variation.variationId)) continue;
      index.byVariationId.set(variation.variationId, addOnKey ? { serviceId, addOnKey: addOnKey as ServiceAddOnKey } : { serviceId });
      if (!addOnKey) index.linkedServiceIds.add(serviceId);
    }
  } catch (error) {
    console.error("[v0] Square variation lookup failed; using seller notes for services:", error instanceof Error ? error.message : error);
  }
  return index;
}

type CatalogObject = { id: string; type?: string; item_data?: { name?: string }; item_variation_data?: { item_id?: string; name?: string; price_money?: SquareMoney } };

const normalizeName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").replace(/\b(\w{2,}?)s\b/g, "$1").trim();

/** Matches a Square catalog label (item + variation name) to the serviceTree service with the longest name inside it, preferring an exact price. */
function matchServiceByName(labels: string[], priceCents?: number): VariationRef | null {
  const haystacks = labels.map(normalizeName).filter(Boolean).map((label) => ` ${label} `);
  let best: { ref: VariationRef; score: number } | null = null;
  for (const service of allServices) {
    const keys: (ServiceAddOnKey | undefined)[] = service.addOn ? [undefined, service.addOn.key] : [undefined];
    for (const addOnKey of keys) {
      const names = [serviceDisplayNameWithAddOn(service, "en", addOnKey), serviceDisplayNameWithAddOn(service, "fr", addOnKey), ...(addOnKey ? [] : [service.nameEn, service.nameFr])]
        .map(normalizeName).filter((name) => name.length >= 3);
      const length = Math.max(0, ...names.filter((name) => haystacks.some((label) => label.includes(` ${name} `))).map((name) => name.length));
      if (length === 0) continue;
      const price = addOnKey ? service.addOn?.priceCad : service.price;
      const score = length + (typeof priceCents === "number" && typeof price === "number" && Math.round(price * 100) === priceCents ? 1000 : 0);
      if (!best || score > best.score) best = { ref: addOnKey ? { serviceId: service.id, addOnKey } : { serviceId: service.id }, score };
    }
  }
  return best?.ref ?? null;
}

/** Adds Square variations missing from the catalog link table by matching their names and prices to serviceTree. */
export async function extendVariationIndex(index: VariationIndex, variationIds: Iterable<string>) {
  const unknown = Array.from(new Set(variationIds)).filter((id) => id && !index.byVariationId.has(id));
  try {
    for (let start = 0; start < unknown.length; start += 100) {
      const result = await squareRequest<{ objects?: CatalogObject[]; related_objects?: CatalogObject[] }>("/catalog/batch-retrieve", {
        object_ids: unknown.slice(start, start + 100),
        include_related_objects: true,
      });
      const itemNames = new Map((result.related_objects ?? []).filter((object) => object.type === "ITEM").map((object) => [object.id, object.item_data?.name ?? ""]));
      for (const object of result.objects ?? []) {
        const variation = object.item_variation_data;
        if (object.type !== "ITEM_VARIATION" || !variation) continue;
        const ref = matchServiceByName([variation.name ?? "", itemNames.get(variation.item_id ?? "") ?? ""], variation.price_money?.amount);
        if (ref) index.byVariationId.set(object.id, ref);
      }
    }
  } catch (error) {
    console.error("[v0] Square catalog lookup for unlinked variations failed:", error instanceof Error ? error.message : error);
  }
  return index;
}

export const segmentVariationIds = (bookings: SyncBooking[]) =>
  bookings.flatMap((booking) => (booking.appointment_segments ?? []).flatMap((segment) => segment.service_variation_id ? [segment.service_variation_id] : []));

/** Maps Square catalog variation ids back to internal services; null if any id is not an internal service. */
function selectionFromVariationIds(variationIds: string[], index: VariationIndex): ServiceSelection | null {
  if (variationIds.length === 0) return null;
  const serviceIds: string[] = [];
  const addOns: Record<string, ServiceAddOnKey> = {};
  for (const variationId of variationIds) {
    const ref = index.byVariationId.get(variationId);
    if (!ref) return null;
    if (!serviceIds.includes(ref.serviceId)) serviceIds.push(ref.serviceId);
    if (ref.addOnKey) addOns[ref.serviceId] = ref.addOnKey;
  }
  return { serviceIds, addOns };
}

function sameSelection(left: ServiceSelection, right: ServiceSelection) {
  return left.serviceIds.length === right.serviceIds.length
    && left.serviceIds.every((id) => right.serviceIds.includes(id) && (left.addOns[id] ?? "") === (right.addOns[id] ?? ""));
}

/**
 * Square's current appointment segments are the source of truth for what the guest is getting.
 * Services that have no Square catalog variation can never appear in a segment, so they are kept from the seller note.
 */
export function resolveBookingSelection(booking: SyncBooking, index: VariationIndex): ServiceSelection {
  const note = parseSellerNoteServices(booking.seller_note);
  if (booking.seller_note?.includes(NO_SERVICE_MARKER)) return note;
  const live = selectionFromVariationIds((booking.appointment_segments ?? []).flatMap((segment) => segment.service_variation_id ? [segment.service_variation_id] : []), index);
  if (!live) return note;
  if (note.serviceIds.length === 0) return live;
  const noteInSquare: ServiceSelection = { serviceIds: note.serviceIds.filter((id) => index.linkedServiceIds.has(id)), addOns: note.addOns };
  if (sameSelection(noteInSquare, live)) return note;
  const internalOnly = note.serviceIds.filter((id) => !index.linkedServiceIds.has(id) && !live.serviceIds.includes(id));
  return {
    serviceIds: [...live.serviceIds, ...internalOnly],
    addOns: { ...Object.fromEntries(internalOnly.flatMap((id) => note.addOns[id] ? [[id, note.addOns[id]]] : [])), ...live.addOns },
  };
}

export function groupSquareBookings(bookings: SyncBooking[]): BookingGroup[] {
  const groups = new Map<string, { guestIndex: number; booking: SyncBooking }[]>();
  for (const booking of bookings) {
    const marker = booking.seller_note?.match(GROUP_MARKER);
    const key = marker?.[1] ?? booking.id;
    groups.set(key, [...(groups.get(key) ?? []), { guestIndex: Number(marker?.[2] ?? 1), booking }]);
  }
  return Array.from(groups, ([key, entries]) => {
    const sorted = entries.sort((left, right) => left.guestIndex - right.guestIndex).map((entry) => entry.booking);
    return { key, primaryId: sorted[0].id, bookings: sorted };
  });
}

export async function fetchDayBookings(date: string): Promise<SyncBooking[]> {
  const startAt = torontoMidnightUtc(date);
  const endAt = torontoMidnightUtc(nextDate(date));
  const bookings: SyncBooking[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ location_id: ADMIN_LOCATION_ID, start_at_min: startAt.toISOString(), start_at_max: endAt.toISOString(), limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const page = await squareRequest<{ bookings?: SyncBooking[]; cursor?: string }>(`/bookings?${query}`);
    bookings.push(...(page.bookings ?? []));
    cursor = page.cursor;
  } while (cursor);
  return bookings.filter((booking) => {
    const startTime = booking.start_at ? Date.parse(booking.start_at) : Number.NaN;
    return !INACTIVE_STATUSES.has(booking.status ?? "") && Number.isFinite(startTime) && startTime >= startAt.getTime() && startTime < endAt.getTime();
  });
}

async function searchCompletedOrders(startAt: Date, endAt: Date): Promise<SquareOrder[]> {
  const orders: SquareOrder[] = [];
  let cursor: string | undefined;
  do {
    const page = await squareRequest<{ orders?: SquareOrder[]; cursor?: string }>("/orders/search", {
      location_ids: [ADMIN_LOCATION_ID],
      query: {
        filter: { state_filter: { states: ["COMPLETED"] }, date_time_filter: { closed_at: { start_at: startAt.toISOString(), end_at: endAt.toISOString() } } },
        sort: { sort_field: "CLOSED_AT", sort_order: "ASC" },
      },
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    orders.push(...(page.orders ?? []));
    cursor = page.cursor;
  } while (cursor);
  return orders;
}

const amountOf = (money?: SquareMoney) => typeof money?.amount === "number" ? money.amount : 0;

function summarizeOrder(order: SquareOrder): SquarePaymentSummary {
  const totalCents = amountOf(order.total_money);
  const taxTotalCents = amountOf(order.total_tax_money);
  const tipChargeCents = (order.service_charges ?? [])
    .filter((charge) => /tip|pourboire/i.test(charge.name ?? ""))
    .reduce((sum, charge) => sum + amountOf(charge.applied_money ?? charge.total_money), 0);
  const tipCents = amountOf(order.total_tip_money) + tipChargeCents;
  const subtotalCents = Math.max(0, totalCents - taxTotalCents - tipCents);
  const appliedTax = (percent: number) => order.taxes?.find((tax) => Number(tax.percentage) === percent)?.applied_money;
  const tpsApplied = appliedTax(5);
  const tvqApplied = appliedTax(9.975);
  let { tpsCents, tvqCents } = tpsApplied && tvqApplied ? { tpsCents: amountOf(tpsApplied), tvqCents: amountOf(tvqApplied) } : taxCents(subtotalCents);
  if (tpsCents + tvqCents !== taxTotalCents) tvqCents = Math.max(0, taxTotalCents - tpsCents);
  const tenderTypes = new Set((order.tenders ?? []).map((tender) => tender.type));
  return {
    orderId: order.id,
    paidAt: order.closed_at ?? order.updated_at ?? order.created_at ?? new Date().toISOString(),
    paymentMethod: tenderTypes.has("CASH") && !tenderTypes.has("CARD") ? "Cash" : "Card",
    subtotalCents,
    discountCents: amountOf(order.total_discount_money),
    tpsCents,
    tvqCents,
    tipCents,
    totalCents,
  };
}

/** Square does not link Appointments checkouts to bookings, so match our reference id first, then the booking's customer. */
function matchOrders(groups: BookingGroup[], orders: SquareOrder[]) {
  const matches = new Map<string, { order: SquareOrder; byReference: boolean }>();
  const used = new Set<string>();
  for (const group of groups) {
    const refs = new Set(group.bookings.flatMap((booking) => [booking.id, booking.id.slice(-40)]).concat(group.key, group.key.slice(-40)));
    const order = orders.find((item) => !used.has(item.id) && ((item.reference_id && refs.has(item.reference_id)) || (item.metadata?.booking_id && refs.has(item.metadata.booking_id))));
    if (order) {
      used.add(order.id);
      matches.set(group.primaryId, { order, byReference: true });
    }
  }
  const byStart = [...groups].sort((left, right) => (left.bookings[0].start_at ?? "").localeCompare(right.bookings[0].start_at ?? ""));
  for (const group of byStart) {
    if (matches.has(group.primaryId)) continue;
    const customerId = group.bookings.find((booking) => booking.customer_id)?.customer_id;
    const startTime = Date.parse(group.bookings[0].start_at ?? "");
    if (!customerId || !Number.isFinite(startTime)) continue;
    const order = orders.find((item) => {
      if (used.has(item.id)) return false;
      const customers = new Set([item.customer_id, ...(item.tenders ?? []).map((tender) => tender.customer_id)]);
      const closedAt = Date.parse(item.closed_at ?? item.created_at ?? "");
      return customers.has(customerId) && closedAt >= startTime - EARLY_CHECKOUT_WINDOW_MS && closedAt <= startTime + LATE_CHECKOUT_WINDOW_MS;
    });
    if (order) {
      used.add(order.id);
      matches.set(group.primaryId, { order, byReference: false });
    }
  }
  return matches;
}

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

const toAmount = (cents: number) => (cents / 100).toFixed(2);

/**
 * Finds the completed Square order for each booking group, rebuilds the bill from the final services
 * (serviceTree prices, combo rule, TPS/TVQ) and stores Square's exact paid amounts as the Neon checkout.
 */
export async function reconcileSquareCheckouts(
  groups: BookingGroup[],
  index: VariationIndex,
  staffNameById: Map<string, string>,
  ordersFrom: Date,
  ordersTo: Date,
): Promise<Map<string, ReconciledCheckout>> {
  const results = new Map<string, ReconciledCheckout>();
  if (groups.length === 0) return results;
  const matches = matchOrders(groups, await searchCompletedOrders(ordersFrom, new Date(Math.min(ordersTo.getTime(), Date.now() + 60_000))));
  if (matches.size === 0) return results;
  await extendVariationIndex(index, [
    ...segmentVariationIds(groups.flatMap((group) => group.bookings)),
    ...Array.from(matches.values()).flatMap(({ order }) => (order.line_items ?? []).flatMap((item) => item.catalog_object_id ? [item.catalog_object_id] : [])),
  ]);
  // Deleted or older catalog versions are not retrievable, but the paid order still names each line.
  for (const { order } of matches.values()) {
    for (const item of order.line_items ?? []) {
      if (!item.catalog_object_id || index.byVariationId.has(item.catalog_object_id)) continue;
      const ref = matchServiceByName([item.variation_name ?? "", item.name ?? ""], item.base_price_money?.amount);
      if (ref) index.byVariationId.set(item.catalog_object_id, ref);
    }
  }

  const existingRows = await reportsDb.select().from(serviceRevenueReports).where(and(
    eq(serviceRevenueReports.userId, REPORT_USER_ID),
    inArray(serviceRevenueReports.bookingId, Array.from(matches.keys())),
  ));

  for (const group of groups) {
    const match = matches.get(group.primaryId);
    if (!match) continue;
    const bookingRows = existingRows.filter((row) => row.bookingId === group.primaryId);
    // A checkout saved in /admin without a Square order (e.g. cash) wins over a customer-only guess.
    if (!match.byReference && bookingRows.length > 0 && bookingRows.every((row) => !row.squareOrderId)) continue;

    const payment = summarizeOrder(match.order);
    const orderSelection = group.bookings.length === 1
      ? selectionFromVariationIds((match.order.line_items ?? []).map((item) => item.catalog_object_id ?? ""), index)
      : null;
    const selections = orderSelection ? [orderSelection] : group.bookings.map((booking) => resolveBookingSelection(booking, index));
    const bill = calculateBill({ selections: selections.map((item) => item.serviceIds), addOns: selections.map((item) => item.addOns), tipChoice: "custom", customTipCents: payment.tipCents });
    const netByGuest = bill.guestSubtotalCents.map((gross, guestIndex) => Math.max(0, gross - (bill.guestComboDiscountCents[guestIndex] ?? 0)));
    const subtotalShares = allocate(payment.subtotalCents, netByGuest);
    const tipShares = allocate(payment.tipCents, subtotalShares);
    const transactedAt = new Date(payment.paidAt);

    for (const [guestIndex, booking] of group.bookings.entries()) {
      const lines = bill.guestLines[guestIndex] ?? [];
      const services = lines.map((line) => {
        const service = serviceById.get(line.serviceId);
        return { name: service ? serviceDisplayNameWithAddOn(service, "en", line.addOnKey) : line.nameEn, amount: line.priceCents / 100 };
      });
      const technicianId = booking.appointment_segments?.find((segment) => segment.team_member_id)?.team_member_id;
      const record = {
        id: createHash("sha256").update(`${group.primaryId}:${guestIndex}`).digest("hex"),
        userId: REPORT_USER_ID,
        bookingId: group.primaryId,
        guestIndex,
        transactedAt,
        businessDate: torontoDate(transactedAt),
        guestName: bookingRows.find((row) => row.guestIndex === guestIndex)?.guestName ?? (guestIndex === 0 ? "Square customer" : `Guest ${guestIndex + 1}`),
        technician: (technicianId && staffNameById.get(technicianId)) || "Unassigned",
        services,
        serviceSubtotal: toAmount(subtotalShares[guestIndex] ?? 0),
        tipAmount: toAmount(tipShares[guestIndex] ?? 0),
        paymentMethod: payment.paymentMethod,
        squareOrderId: payment.orderId,
        squareTipAmount: toAmount(tipShares[guestIndex] ?? 0),
        discountAmount: toAmount(Math.max(0, (bill.guestSubtotalCents[guestIndex] ?? 0) - (subtotalShares[guestIndex] ?? 0))),
        appointmentAt: booking.start_at ? new Date(booking.start_at) : null,
        updatedAt: new Date(),
      };
      const current = bookingRows.find((row) => row.guestIndex === guestIndex);
      const unchanged = current
        && current.squareOrderId === record.squareOrderId
        && Number(current.serviceSubtotal) === Number(record.serviceSubtotal)
        && Number(current.tipAmount) === Number(record.tipAmount)
        && current.paymentMethod === record.paymentMethod
        && JSON.stringify(current.services) === JSON.stringify(record.services);
      if (unchanged) continue;
      const { id: _id, userId: _userId, bookingId: _bookingId, guestIndex: _guestIndex, ...changes } = record;
      await reportsDb.insert(serviceRevenueReports).values(record).onConflictDoUpdate({
        target: [serviceRevenueReports.userId, serviceRevenueReports.bookingId, serviceRevenueReports.guestIndex],
        set: changes,
      });
    }
    if (bookingRows.some((row) => row.guestIndex >= group.bookings.length)) {
      await reportsDb.delete(serviceRevenueReports).where(and(
        eq(serviceRevenueReports.userId, REPORT_USER_ID),
        eq(serviceRevenueReports.bookingId, group.primaryId),
        gte(serviceRevenueReports.guestIndex, group.bookings.length),
      ));
    }

    results.set(group.primaryId, {
      bookingId: group.primaryId,
      serviceIds: selections.map((item) => item.serviceIds),
      addOns: selections.map((item) => item.addOns),
      payment,
    });
  }
  return results;
}

/** Re-reads one business day from Square (bookings + completed orders) and reconciles its checkouts into Neon. */
export async function reconcileSquareDate(date: string) {
  const [bookings, roster, index] = await Promise.all([fetchDayBookings(date), getStaffRoster(ADMIN_LOCATION_ID), loadVariationIndex()]);
  const dayStart = torontoMidnightUtc(date);
  return reconcileSquareCheckouts(
    groupSquareBookings(bookings),
    index,
    new Map(roster.map((member) => [member.teamMemberId, member.name])),
    new Date(dayStart.getTime() - EARLY_CHECKOUT_WINDOW_MS),
    new Date(torontoMidnightUtc(nextDate(date)).getTime() + LATE_CHECKOUT_WINDOW_MS),
  );
}

/** Business date an order belongs to, for webhook events that only carry an order id. */
export async function orderBusinessDate(orderId: string): Promise<string | null> {
  const result = await squareRequest<{ order?: SquareOrder }>(`/orders/${encodeURIComponent(orderId)}`);
  const order = result.order;
  if (!order || order.state !== "COMPLETED") return null;
  return torontoDate(order.closed_at ?? order.updated_at ?? order.created_at ?? new Date());
}
