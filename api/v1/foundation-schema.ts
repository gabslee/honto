import type { NeonQueryFunction } from "@neondatabase/serverless";
import { ensureIdentitySchema } from "../../app/server-auth";

type Sql = NeonQueryFunction<false, false>;
let ready: Promise<void> | null = null;

/**
 * Idempotent v1 foundation schema (mirrors drizzle/0008_v1_foundation.sql): user time zones, v1 couple
 * columns, couple_members (two accounts per couple) and couple_invites. Legacy couples (host_user_id +
 * partner_key) are left untouched and are never copied into couple_members.
 */
export function ensureFoundationSchema(sql: Sql) {
  if (!ready) ready = (async () => {
    await ensureIdentitySchema();
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS time_zone text`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS time_zone_updated_at timestamptz`;
    // Same base shape as api/couple.ts, so the v1 code does not depend on the game tables existing first.
    await sql`CREATE TABLE IF NOT EXISTS couples (id text PRIMARY KEY, host_user_id text, partner_key text, reunion_date text, adult_confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
    // Every pre-v1 row (and every row the frozen /api/mobile and web game keep inserting) is legacy; v1 inserts legacy = false.
    await sql`ALTER TABLE couples ADD COLUMN IF NOT EXISTS legacy boolean NOT NULL DEFAULT true`;
    await sql`ALTER TABLE couples ADD COLUMN IF NOT EXISTS paired_at timestamptz`;
    await sql`ALTER TABLE couples ADD COLUMN IF NOT EXISTS unpaired_at timestamptz`;
    await sql`ALTER TABLE couples ADD COLUMN IF NOT EXISTS started_on date`;
    await sql`ALTER TABLE couples ADD COLUMN IF NOT EXISTS reunion_at timestamptz`;
    await sql`ALTER TABLE couples ADD COLUMN IF NOT EXISTS reunion_city text`;
    await sql`ALTER TABLE couples ADD COLUMN IF NOT EXISTS reunion_time_zone text`;
    // role 'a' = invite creator, 'b' = joiner; left_at is set on unpair (row kept for the 30-day photo grace).
    await sql`CREATE TABLE IF NOT EXISTS couple_members (couple_id text NOT NULL REFERENCES couples(id) ON DELETE CASCADE, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, role text NOT NULL CHECK (role IN ('a', 'b')), joined_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz, PRIMARY KEY (couple_id, user_id))`;
    // One active couple per user; at most one active member per role.
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_couple_members_active_user ON couple_members(user_id) WHERE left_at IS NULL`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_couple_members_active_role ON couple_members(couple_id, role) WHERE left_at IS NULL`;
    // 6-char Crockford base32 codes, 24h, single use; couple_id is the couple created by the join.
    await sql`CREATE TABLE IF NOT EXISTS couple_invites (code text PRIMARY KEY, created_by text NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, used_by text REFERENCES users(id) ON DELETE SET NULL, used_at timestamptz, couple_id text REFERENCES couples(id) ON DELETE SET NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE INDEX IF NOT EXISTS idx_couple_invites_creator ON couple_invites(created_by, created_at DESC)`;
  })().catch((error) => { ready = null; throw error; });
  return ready;
}
