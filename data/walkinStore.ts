import { checkinPool } from "@/data/lateCheckin";

export type WalkinBookingRecord = {
  bookingId: string;
  groupId: string;
  guestIndex: number;
  guestCount: number;
  guestName: string;
  representativeName: string;
  phone: string;
  startAt: string;
  serviceIds: string[];
  teamMemberId: string;
  checkedIn: boolean;
};

const globalForWalkin = globalThis as typeof globalThis & { walkinTableReady?: Promise<void> };

function ensureTable() {
  globalForWalkin.walkinTableReady ??= checkinPool.query(`
    CREATE TABLE IF NOT EXISTS walkin_bookings (
      booking_id text PRIMARY KEY,
      group_id text NOT NULL,
      guest_index integer NOT NULL,
      guest_count integer NOT NULL,
      guest_name text NOT NULL,
      representative_name text NOT NULL,
      phone text NOT NULL,
      start_at timestamptz NOT NULL,
      service_ids text[] NOT NULL,
      team_member_id text NOT NULL,
      checked_in boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS walkin_bookings_group_idx ON walkin_bookings (group_id);
  `).then(() => undefined).catch((error) => {
    globalForWalkin.walkinTableReady = undefined;
    throw error;
  });
  return globalForWalkin.walkinTableReady;
}

/** Saves every booking of a kiosk walk-in (one row per guest, linked by group_id). */
export async function saveWalkinBookings(records: WalkinBookingRecord[]) {
  if (records.length === 0) return;
  await ensureTable();
  await Promise.all(records.map((record) => checkinPool.query(
    `INSERT INTO walkin_bookings (booking_id, group_id, guest_index, guest_count, guest_name, representative_name, phone, start_at, service_ids, team_member_id, checked_in)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (booking_id) DO NOTHING`,
    [record.bookingId, record.groupId, record.guestIndex, record.guestCount, record.guestName, record.representativeName, record.phone, record.startAt, record.serviceIds, record.teamMemberId, record.checkedIn],
  )));
}
