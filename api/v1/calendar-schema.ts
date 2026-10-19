import type { NeonQueryFunction } from "@neondatabase/serverless";
import { ensureFoundationSchema } from "./foundation-schema";

type Sql = NeonQueryFunction<false, false>;
let ready: Promise<void> | null = null;

/**
 * Idempotent calendar schema (mirrors the calendar part of drizzle/0010_calendar_entitlements.sql):
 * - calendar_busy: busy blocks of a member, scoped to the couple they were uploaded in. All-day events are
 *   never stored. `title` exists for the per-calendar title opt-in (and is read by the Today partner status)
 *   but nothing writes it yet, so it is always NULL.
 * - calendar_sync: last upload per user (window, device zone, time), so "never synced" differs from
 *   "synced, nothing busy" and the partner status knows which span the blocks cover.
 */
export function ensureCalendarSchema(sql: Sql) {
  if (!ready) ready = (async () => {
    await ensureFoundationSchema(sql);
    await sql`CREATE TABLE IF NOT EXISTS calendar_busy (id bigserial PRIMARY KEY, couple_id text NOT NULL REFERENCES couples(id) ON DELETE CASCADE, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK (ends_at > starts_at), synced_at timestamptz NOT NULL DEFAULT now())`;
    await sql`ALTER TABLE calendar_busy ADD COLUMN IF NOT EXISTS title text CHECK (title IS NULL OR char_length(title) <= 80)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_calendar_busy_user ON calendar_busy(user_id, starts_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_calendar_busy_couple ON calendar_busy(couple_id, starts_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_calendar_busy_ends ON calendar_busy(ends_at)`;
    // One row per user; the upsert also serializes concurrent uploads of the same user (row lock).
    await sql`CREATE TABLE IF NOT EXISTS calendar_sync (user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, couple_id text NOT NULL REFERENCES couples(id) ON DELETE CASCADE, window_from timestamptz NOT NULL, window_to timestamptz NOT NULL, time_zone text, synced_at timestamptz NOT NULL DEFAULT now())`;
  })().catch((error) => { ready = null; throw error; });
  return ready;
}

/**
 * Retention for the daily cron (`calendarBlocksDeleted` of `GET /api/cron/retention`): deletes blocks that
 * ended more than a day ago and blocks (and sync rows) of anyone who is no longer an active member of the
 * couple they were uploaded in (unpaired or left). Returns the number of blocks deleted.
 */
export async function pruneCalendar(sql: Sql): Promise<number> {
  await ensureCalendarSchema(sql);
  const rows = await sql`WITH deleted AS (DELETE FROM calendar_busy b WHERE b.ends_at < now() - interval '1 day' OR NOT EXISTS (SELECT 1 FROM couple_members m JOIN couples c ON c.id = m.couple_id AND c.unpaired_at IS NULL WHERE m.couple_id = b.couple_id AND m.user_id = b.user_id AND m.left_at IS NULL) RETURNING 1) SELECT count(*)::int AS n FROM deleted`;
  await sql`DELETE FROM calendar_sync s WHERE NOT EXISTS (SELECT 1 FROM couple_members m JOIN couples c ON c.id = m.couple_id AND c.unpaired_at IS NULL WHERE m.couple_id = s.couple_id AND m.user_id = s.user_id AND m.left_at IS NULL)`;
  return Number(rows[0]?.n ?? 0);
}
