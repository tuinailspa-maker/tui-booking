import { Pool } from "pg";
import { BUSINESS_TIME_ZONE } from "@/data/staffSchedule";
import { SQUARE_API_VERSION, SQUARE_TEAM_MEMBER_IDS } from "@/data/squareConfig";

const SQUARE_API = process.env.SQUARE_ENVIRONMENT === "sandbox" ? "https://connect.squareupsandbox.com/v2" : "https://connect.squareup.com/v2";
const LOCATION_ID = process.env.SQUARE_LOCATION_ID || "R73A64VPAR34X";

export const LATE_AFTER_MINUTES = 10;
// Ignore appointments that started long ago so a fresh deploy doesn't text everyone from this morning.
export const LATE_WINDOW_MINUTES = 120;
export const CANCEL_CALLBACK_PREFIX = "cancel:";
const INACTIVE_STATUSES = ["CANCELLED_BY_CUSTOMER", "CANCELLED_BY_SELLER", "DECLINED", "COMPLETED", "NO_SHOW"];

export type SquareBooking = {
  id: string;
  version?: number;
  status?: string;
  start_at?: string;
  customer_id?: string;
  seller_note?: string;
  appointment_segments?: { team_member_id?: string }[];
};
type SquareCustomer = { id: string; given_name?: string; family_name?: string; phone_number?: string };

const globalForCheckin = globalThis as typeof globalThis & { checkinPool?: Pool; checkinTableReady?: Promise<void> };
const pool = globalForCheckin.checkinPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
if (process.env.NODE_ENV !== "production") globalForCheckin.checkinPool = pool;
export { pool as checkinPool };

function ensureTable() {
  globalForCheckin.checkinTableReady ??= pool.query(`
    CREATE TABLE IF NOT EXISTS booking_checkin_status (
      booking_id text PRIMARY KEY,
      checked_in_at timestamptz,
      late_notified_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `).then(() => undefined).catch((error) => {
    globalForCheckin.checkinTableReady = undefined;
    throw error;
  });
  return globalForCheckin.checkinTableReady;
}

export async function recordCheckIn(bookingId: string, checkedInAt: Date) {
  await ensureTable();
  await pool.query(
    `INSERT INTO booking_checkin_status (booking_id, checked_in_at) VALUES ($1, $2)
     ON CONFLICT (booking_id) DO UPDATE SET checked_in_at = COALESCE(booking_checkin_status.checked_in_at, EXCLUDED.checked_in_at), updated_at = now()`,
    [bookingId, checkedInAt.toISOString()],
  );
}

export async function checkedInOrNotified(bookingIds: string[]) {
  if (!bookingIds.length) return new Set<string>();
  await ensureTable();
  const result = await pool.query<{ booking_id: string }>(
    `SELECT booking_id FROM booking_checkin_status WHERE booking_id = ANY($1::text[]) AND (checked_in_at IS NOT NULL OR late_notified_at IS NOT NULL)`,
    [bookingIds],
  );
  return new Set(result.rows.map((row) => row.booking_id));
}

/** Atomically claims the late notification so concurrent cron runs never send twice. */
export async function claimLateNotification(bookingId: string) {
  await ensureTable();
  const result = await pool.query(
    `INSERT INTO booking_checkin_status (booking_id, late_notified_at) VALUES ($1, now())
     ON CONFLICT (booking_id) DO UPDATE SET late_notified_at = now(), updated_at = now()
     WHERE booking_checkin_status.late_notified_at IS NULL AND booking_checkin_status.checked_in_at IS NULL
     RETURNING booking_id`,
    [bookingId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function releaseLateNotification(bookingId: string) {
  await pool.query(`UPDATE booking_checkin_status SET late_notified_at = NULL, updated_at = now() WHERE booking_id = $1`, [bookingId]);
}

export async function square<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  if (!process.env.SQUARE_ACCESS_TOKEN) throw new Error("Square is not configured.");
  const response = await fetch(`${SQUARE_API}${path}`, {
    method,
    cache: "no-store",
    headers: { Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`, "Square-Version": SQUARE_API_VERSION, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.errors?.map((item: { detail?: string }) => item.detail).filter(Boolean).join("; ") || `Square returned ${response.status}.`);
  return data as T;
}

function torontoParts(date: Date) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
}

function torontoDayStart(now: Date) {
  const today = torontoParts(now);
  const guess = Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day));
  const atGuess = torontoParts(new Date(guess));
  const offset = Date.UTC(Number(atGuess.year), Number(atGuess.month) - 1, Number(atGuess.day), Number(atGuess.hour), Number(atGuess.minute), Number(atGuess.second)) - guess;
  return new Date(guess - offset);
}

/** Today's (America/Toronto) active bookings that started 10+ minutes ago, within the late window. */
export async function lateBookingCandidates(now = new Date()) {
  const dayStart = torontoDayStart(now);
  const latestStart = now.getTime() - LATE_AFTER_MINUTES * 60_000;
  const earliestStart = Math.max(dayStart.getTime(), now.getTime() - LATE_WINDOW_MINUTES * 60_000);
  if (latestStart < earliestStart) return [];
  const query = new URLSearchParams({ location_id: LOCATION_ID, start_at_min: new Date(earliestStart).toISOString(), start_at_max: new Date(latestStart + 60_000).toISOString(), limit: "100" });
  const bookings: SquareBooking[] = [];
  let cursor: string | undefined;
  do {
    const page = await square<{ bookings?: SquareBooking[]; cursor?: string }>(`/bookings?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    bookings.push(...(page.bookings ?? []));
    cursor = page.cursor;
  } while (cursor);
  return bookings.filter((booking) => {
    const startAt = booking.start_at ? Date.parse(booking.start_at) : NaN;
    if (!Number.isFinite(startAt) || startAt < earliestStart || startAt > latestStart) return false;
    if (INACTIVE_STATUSES.includes(booking.status ?? "")) return false;
    const note = booking.seller_note ?? "";
    return Boolean(booking.customer_id) && !note.includes("[TUI_CHECKED_IN") && !note.includes("[TUI_WALK_IN]");
  });
}

export async function squareCustomer(customerId: string) {
  const result = await square<{ customer?: SquareCustomer }>(`/customers/${encodeURIComponent(customerId)}`);
  return result.customer;
}

export function customerName(customer?: SquareCustomer) {
  return [customer?.given_name, customer?.family_name].filter(Boolean).join(" ") || "Guest";
}

export function bookingServices(booking: SquareBooking) {
  return booking.seller_note?.match(/Services:\s*([\s\S]+?)(?:\. Guest subtotal|\. Combo discount:|$)/)?.[1]?.split(/;\s*/).map((line) => line.split(/\s+—\s+\$/)[0]).join(", ") || "Appointment";
}

export function bookingTechnicians(booking: SquareBooking) {
  const names = (booking.appointment_segments ?? [])
    .map((segment) => Object.entries(SQUARE_TEAM_MEMBER_IDS).find(([, id]) => id === segment.team_member_id)?.[0])
    .filter((name): name is string => Boolean(name));
  return Array.from(new Set(names)).join(", ");
}

export function torontoTime(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}

export async function sendSms(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) throw new Error("Twilio is not configured.");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(`Twilio: ${data.message ?? response.status}`);
  }
}

// Owner alerts are best-effort: failures are logged and never surface to the guest-facing kiosk.
export async function notifyOwnerSms(body: string) {
  const to = process.env.OWNER_PHONE_NUMBER;
  if (!to) {
    console.warn("[v0] OWNER_PHONE_NUMBER is not set; owner SMS skipped.");
    return;
  }
  try {
    await sendSms(to, body.slice(0, 600));
  } catch (error) {
    console.error("[v0] Owner SMS failed:", error instanceof Error ? error.message : error);
  }
}

export async function telegram<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram is not configured.");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(`Telegram ${method}: ${data.description ?? response.status}`);
  return data.result as T;
}

export function lateSmsBody(name: string, time: string) {
  const first = name.split(/\s+/)[0];
  return [
    `Hi ${first}, this is Tui Nail Spa. Your appointment was at ${time} and we haven't seen you yet. Are you on your way? Please reply to let us know.`,
    `Bonjour ${first}, ici Tui Nail Spa. Votre rendez-vous était à ${time} et nous ne vous avons pas encore vu(e). Êtes-vous en route? Merci de nous répondre.`,
  ].join("\n\n");
}
