import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

export const REPORT_USER_ID = "tui-admin";

const globalForReportsDb = globalThis as typeof globalThis & { reportsPool?: Pool };
const pool = globalForReportsDb.reportsPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
if (process.env.NODE_ENV !== "production") globalForReportsDb.reportsPool = pool;

export const serviceRevenueReports = pgTable("service_revenue_reports", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  bookingId: text("booking_id").notNull(),
  guestIndex: integer("guest_index").notNull(),
  transactedAt: timestamp("transacted_at", { withTimezone: true }).notNull(),
  businessDate: date("business_date").notNull(),
  guestName: text("guest_name").notNull(),
  technician: text("technician").notNull(),
  services: jsonb("services").notNull().$type<Array<{ name: string; amount: number }>>(),
  serviceSubtotal: numeric("service_subtotal", { precision: 10, scale: 2 }).notNull(),
  tipAmount: numeric("tip_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  paymentMethod: text("payment_method").notNull(),
  squareOrderId: text("square_order_id"),
  squareTipAmount: numeric("square_tip_amount", { precision: 10, scale: 2 }),
  discountAmount: numeric("discount_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  appointmentAt: timestamp("appointment_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("service_revenue_reports_user_booking_guest_key").on(table.userId, table.bookingId, table.guestIndex),
  index("service_revenue_reports_user_date_idx").on(table.userId, table.businessDate),
]);

export const adminTeamAccess = pgTable("admin_team_access", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().$type<"owner" | "staff">(),
  pinHash: text("pin_hash").notNull(),
  pinSalt: text("pin_salt").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("admin_team_access_user_name_key").on(table.userId, table.name),
]);

export const reportsDb = drizzle(pool, { schema: { serviceRevenueReports, adminTeamAccess } });
