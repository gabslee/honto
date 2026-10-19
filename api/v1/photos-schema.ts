import type { NeonQueryFunction } from "@neondatabase/serverless";
import { ensureFoundationSchema } from "./foundation-schema";

type Sql = NeonQueryFunction<false, false>;
let ready: Promise<void> | null = null;

/**
 * Idempotent v1 photos + push schema (mirrors drizzle/0009_photos_push.sql): object-storage columns on
 * couple_photos (legacy Blob rows keep storage = 'blob' and their url), photo_exports and push_devices.
 */
export function ensurePhotosSchema(sql: Sql) {
  if (!ready) ready = (async () => {
    await ensureFoundationSchema(sql);
    // Same base shape as api/couple.ts, so the v1 code does not depend on the game tables existing first.
    await sql`CREATE TABLE IF NOT EXISTS couple_photos (id text PRIMARY KEY, couple_id text NOT NULL, room_id text, role text NOT NULL, author_name text NOT NULL, url text NOT NULL, pathname text NOT NULL, phrase_key text, phrase text NOT NULL, content_type text NOT NULL, size_bytes integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE INDEX IF NOT EXISTS idx_couple_photos_couple ON couple_photos(couple_id, created_at DESC)`;
    await sql`ALTER TABLE couple_photos ALTER COLUMN url DROP NOT NULL`;
    await sql`ALTER TABLE couple_photos ALTER COLUMN pathname DROP NOT NULL`;
    // v1 phrases are optional (PhotoCreateRequest.phraseKey / phrase).
    await sql`ALTER TABLE couple_photos ALTER COLUMN phrase DROP NOT NULL`;
    await sql`ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS storage text NOT NULL DEFAULT 'blob'`;
    await sql`ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS author_user_id text REFERENCES users(id) ON DELETE CASCADE`;
    await sql`ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS client_id text`;
    await sql`ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS local_day date`;
    await sql`ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS time_zone text`;
    await sql`ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS is_daily boolean NOT NULL DEFAULT false`;
    await sql`ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready'`;
    await sql`ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS object_key text`;
    await sql`ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS thumb_key text`;
    await sql`ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS thumb_content_type text`;
    await sql`ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS thumb_size_bytes integer`;
    await sql`ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS width integer`;
    await sql`ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS height integer`;
    await sql`ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS ready_at timestamptz`;
    await sql`ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS delete_after timestamptz`;
    // The daily photo = first READY photo of each author per local day.
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_couple_photos_daily ON couple_photos(couple_id, author_user_id, local_day) WHERE is_daily`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_couple_photos_client ON couple_photos(author_user_id, client_id) WHERE client_id IS NOT NULL`;
    await sql`CREATE INDEX IF NOT EXISTS idx_couple_photos_day ON couple_photos(couple_id, local_day) WHERE status = 'ready'`;
    await sql`CREATE INDEX IF NOT EXISTS idx_couple_photos_author ON couple_photos(author_user_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_couple_photos_delete_after ON couple_photos(delete_after) WHERE delete_after IS NOT NULL`;
    await sql`CREATE TABLE IF NOT EXISTS photo_exports (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')), object_key text, photo_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), ready_at timestamptz, expires_at timestamptz)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_photo_exports_user ON photo_exports(user_id, created_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS push_devices (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, installation_id text NOT NULL, platform text NOT NULL CHECK (platform IN ('ios', 'android')), kind text NOT NULL CHECK (kind IN ('fcm', 'apns_alert', 'apns_widget')), token text NOT NULL, env text CHECK (env IN ('sandbox', 'production')), app_version text, os_version text, locale text, created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_push_devices_token ON push_devices(kind, token)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_push_devices_install ON push_devices(user_id, installation_id, kind) WHERE revoked_at IS NULL`;
  })().catch((error) => { ready = null; throw error; });
  return ready;
}
