import { Pool } from "pg";

// Serverless instances don't share memory, so the "Square changed" signal lives in Neon.
const globalForSyncDb = globalThis as typeof globalThis & { squareSyncPool?: Pool };
const pool = globalForSyncDb.squareSyncPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
if (process.env.NODE_ENV !== "production") globalForSyncDb.squareSyncPool = pool;

let tableReady: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  tableReady ??= pool
    .query(`CREATE TABLE IF NOT EXISTS square_sync_state (
      id integer PRIMARY KEY,
      version bigint NOT NULL DEFAULT 0,
      last_event_type text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`)
    .then(() => undefined)
    .catch((error) => {
      tableReady = null;
      throw error;
    });
  return tableReady;
}

/** Increments the shared version that booking and admin views poll to refetch live Square data. */
export async function bumpSquareSyncVersion(eventType: string): Promise<string> {
  await ensureTable();
  const result = await pool.query<{ version: string }>(
    `INSERT INTO square_sync_state (id, version, last_event_type, updated_at)
     VALUES (1, 1, $1, now())
     ON CONFLICT (id) DO UPDATE SET version = square_sync_state.version + 1, last_event_type = EXCLUDED.last_event_type, updated_at = now()
     RETURNING version::text AS version`,
    [eventType.slice(0, 100)],
  );
  return result.rows[0]?.version ?? "0";
}

export async function getSquareSyncVersion(): Promise<string> {
  await ensureTable();
  const result = await pool.query<{ version: string }>(`SELECT version::text AS version FROM square_sync_state WHERE id = 1`);
  return result.rows[0]?.version ?? "0";
}
