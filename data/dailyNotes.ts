import { sql } from "drizzle-orm";
import { REPORT_USER_ID, reportsDb } from "@/data/reports-db";

const MAX_NOTE_LENGTH = 2000;
const globalForNotes = globalThis as typeof globalThis & { dailyNotesReady?: Promise<void> };

function ensureTable() {
  globalForNotes.dailyNotesReady ??= reportsDb.execute(sql`
    CREATE TABLE IF NOT EXISTS technician_daily_notes (
      user_id text NOT NULL,
      technician text NOT NULL,
      business_date date NOT NULL,
      note text NOT NULL DEFAULT '',
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, technician, business_date)
    )
  `).then(() => undefined).catch((error) => {
    globalForNotes.dailyNotesReady = undefined;
    throw error;
  });
  return globalForNotes.dailyNotesReady;
}

export type DailyNote = { note: string; updatedAt: string | null };

export async function readDailyNote(technician: string, businessDate: string): Promise<DailyNote> {
  await ensureTable();
  const result = await reportsDb.execute(sql`
    SELECT note, updated_at FROM technician_daily_notes
    WHERE user_id = ${REPORT_USER_ID} AND technician = ${technician} AND business_date = ${businessDate}
  `);
  const row = result.rows[0] as { note?: string; updated_at?: Date | string } | undefined;
  return { note: row?.note ?? "", updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null };
}

export async function saveDailyNote(technician: string, businessDate: string, note: string): Promise<DailyNote> {
  await ensureTable();
  const clean = note.slice(0, MAX_NOTE_LENGTH);
  const result = await reportsDb.execute(sql`
    INSERT INTO technician_daily_notes (user_id, technician, business_date, note, updated_at)
    VALUES (${REPORT_USER_ID}, ${technician}, ${businessDate}, ${clean}, now())
    ON CONFLICT (user_id, technician, business_date)
    DO UPDATE SET note = EXCLUDED.note, updated_at = now()
    RETURNING note, updated_at
  `);
  const row = result.rows[0] as { note: string; updated_at: Date | string };
  return { note: row.note, updatedAt: new Date(row.updated_at).toISOString() };
}

export { MAX_NOTE_LENGTH };
