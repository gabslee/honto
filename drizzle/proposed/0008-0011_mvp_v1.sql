-- =====================================================================================================
-- Honto MVP /api/v1: schema migration PLAN (W0). NOT APPLIED. Do not run against Neon from this file.
--
-- Follows the repo pattern: idempotent raw SQL (CREATE ... IF NOT EXISTS / ALTER ... ADD COLUMN IF NOT
-- EXISTS) that each backend workstream copies into
--   1. its lazy ensure*Schema() function (the code path that really migrates, as in api/couple.ts), and
--   2. drizzle/00NN_<name>.sql as the reviewable record (drizzle-kit is not wired to these files).
-- Reserved numbers / owners (PLANO_TECNICO.md section 3):
--   0008_couples_v1.sql             W1  (api/v1/couple-schema.ts)
--   0009_photos_push.sql            W2a (api/v1/photos-schema.ts)
--   0010_calendar_entitlements.sql  W3  (api/v1/calendar-schema.ts)
--   0011_trips_nudges.sql           W2b (api/v1/trips-schema.ts)
-- Existing tables touched: users (W1 only), couples, couple_photos. Legacy couples (host_user_id +
-- partner_key) keep working for /api/mobile and are never migrated into couple_members in the MVP.
-- Verified only in-memory with PGlite by tests/contracts-sql.test.mjs (applied twice: idempotent).
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- 0008_couples_v1 (W1): two accounts paired by code, time zones, email magic link
-- -----------------------------------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS time_zone text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS time_zone_updated_at timestamptz;

-- true for every pre-v1 couple (game rooms / account-free partner); v1 inserts legacy = false.
ALTER TABLE couples ADD COLUMN IF NOT EXISTS legacy boolean NOT NULL DEFAULT true;
ALTER TABLE couples ADD COLUMN IF NOT EXISTS paired_at timestamptz;
ALTER TABLE couples ADD COLUMN IF NOT EXISTS unpaired_at timestamptz;
ALTER TABLE couples ADD COLUMN IF NOT EXISTS started_on date;
ALTER TABLE couples ADD COLUMN IF NOT EXISTS reunion_at timestamptz;
ALTER TABLE couples ADD COLUMN IF NOT EXISTS reunion_city text;
ALTER TABLE couples ADD COLUMN IF NOT EXISTS reunion_time_zone text;

CREATE TABLE IF NOT EXISTS couple_members (
  couple_id text NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('a', 'b')),          -- 'a' = invite creator, 'b' = joiner
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,                                    -- set on unpair; row kept for the 30-day photo grace
  PRIMARY KEY (couple_id, user_id)
);
-- One active couple per user; at most one active member per role.
CREATE UNIQUE INDEX IF NOT EXISTS idx_couple_members_active_user ON couple_members(user_id) WHERE left_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_couple_members_active_role ON couple_members(couple_id, role) WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS couple_invites (
  code text PRIMARY KEY,                                  -- 6 chars Crockford base32, uppercase
  created_by text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,                        -- created_at + 24h
  used_by text REFERENCES users(id) ON DELETE SET NULL,
  used_at timestamptz,
  couple_id text REFERENCES couples(id) ON DELETE SET NULL,  -- couple created by the join
  revoked_at timestamptz,                                 -- replaced by a newer invite
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_couple_invites_creator ON couple_invites(created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS email_login_tokens (
  token_hash text PRIMARY KEY,                            -- SHA-256 (salted like user_sessions) of the link token
  email text NOT NULL,
  code_hash text NOT NULL,                                -- SHA-256 of the 6-digit fallback code
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  attempts integer NOT NULL DEFAULT 0,                    -- wrong code attempts; invalid after 5
  expires_at timestamptz NOT NULL,                        -- created_at + 15 min
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_login_tokens_email ON email_login_tokens(email, created_at DESC);

-- -----------------------------------------------------------------------------------------------------
-- 0009_photos_push (W2a): object-storage photos, exports, push devices
-- -----------------------------------------------------------------------------------------------------
-- v1 photos live in a private S3-compatible bucket (storage = 's3'; Railway Storage Buckets today):
-- url/pathname stay NULL, reads use presigned GETs of object_key / thumb_key. The bucket has no lifecycle
-- rules, so every deletion (unpaired photos, exports) is done by GET /api/cron/retention. Legacy Blob rows keep storage = 'blob' and their public url.
ALTER TABLE couple_photos ALTER COLUMN url DROP NOT NULL;
ALTER TABLE couple_photos ALTER COLUMN pathname DROP NOT NULL;
ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS storage text NOT NULL DEFAULT 'blob';
ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS author_user_id text REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS client_id text;                 -- idempotency key from the device
ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS local_day date;                 -- photographer's local day
ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS time_zone text;                 -- photographer's zone at capture
ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS is_daily boolean NOT NULL DEFAULT false;
ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready';  -- 'pending' | 'ready'
ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS object_key text;                -- couples/<couple>/photos/<id>/full.<ext>
ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS thumb_key text;
ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS thumb_content_type text;
ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS thumb_size_bytes integer;
ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS width integer;
ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS height integer;
ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS ready_at timestamptz;
ALTER TABLE couple_photos ADD COLUMN IF NOT EXISTS delete_after timestamptz;       -- unpaired_at + 30 days
-- The daily photo = first READY photo of each author per local day.
CREATE UNIQUE INDEX IF NOT EXISTS idx_couple_photos_daily ON couple_photos(couple_id, author_user_id, local_day) WHERE is_daily;
CREATE UNIQUE INDEX IF NOT EXISTS idx_couple_photos_client ON couple_photos(author_user_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_couple_photos_day ON couple_photos(couple_id, local_day) WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS idx_couple_photos_author ON couple_photos(author_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_couple_photos_delete_after ON couple_photos(delete_after) WHERE delete_after IS NOT NULL;

CREATE TABLE IF NOT EXISTS photo_exports (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  object_key text,                                        -- exports/<user>/<id>.zip
  photo_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  expires_at timestamptz                                  -- ready_at + 7 days (object deleted by the retention cron; no lifecycle rules)
);
CREATE INDEX IF NOT EXISTS idx_photo_exports_user ON photo_exports(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS push_devices (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  kind text NOT NULL CHECK (kind IN ('fcm', 'apns_alert', 'apns_widget')),
  token text NOT NULL,
  env text CHECK (env IN ('sandbox', 'production')),      -- APNs only
  app_version text,
  os_version text,
  locale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz                                  -- logout, DELETE, or APNs 410 / FCM UNREGISTERED
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_devices_token ON push_devices(kind, token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_devices_install ON push_devices(user_id, installation_id, kind) WHERE revoked_at IS NULL;

-- -----------------------------------------------------------------------------------------------------
-- 0010_calendar_entitlements (W3): busy/free mirror, title opt-in, RevenueCat entitlements
-- -----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_busy (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  title text CHECK (title IS NULL OR char_length(title) <= 80),  -- only Premium + opted-in calendar
  calendar_ref text,                                      -- opaque device hash, never the local id
  synced_at timestamptz NOT NULL DEFAULT now()
);
-- Replaced atomically per upload window: DELETE overlapping the window, INSERT the new blocks.
-- All-day events are never stored. Rows outside [now - 1 day, now + 14 days] are purged daily.
CREATE INDEX IF NOT EXISTS idx_calendar_busy_user ON calendar_busy(user_id, starts_at);

CREATE TABLE IF NOT EXISTS calendar_sync (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  window_from timestamptz NOT NULL,
  window_to timestamptz NOT NULL,
  time_zone text,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendar_shares (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calendar_ref text NOT NULL,
  display_name text,
  share_titles boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, calendar_ref)
);

-- Premium of the couple = any active member with an active row here, or legacy users.plan = 'premium'.
CREATE TABLE IF NOT EXISTS entitlements (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('revenuecat', 'stripe', 'admin')),
  entitlement text NOT NULL DEFAULT 'premium',
  product_id text,
  period_type text CHECK (period_type IN ('trial', 'intro', 'normal')),
  store text,                                             -- APP_STORE | PLAY_STORE
  environment text,                                       -- SANDBOX | PRODUCTION
  expires_at timestamptz,                                 -- NULL = lifetime / unknown
  will_renew boolean,
  had_trial boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source, entitlement)
);
CREATE INDEX IF NOT EXISTS idx_entitlements_expiry ON entitlements(expires_at);

CREATE TABLE IF NOT EXISTS revenuecat_events (
  id text PRIMARY KEY,                                    -- event.id (idempotency)
  type text NOT NULL,
  app_user_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL
);

-- -----------------------------------------------------------------------------------------------------
-- 0011_trips_nudges (W2b): reunion trips (Live Activity / Live Update), LA tokens, "Thinking of you"
-- -----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trips (
  id text PRIMARY KEY,
  couple_id text NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  traveler_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  departs_at timestamptz NOT NULL,
  arrives_at timestamptz NOT NULL CHECK (arrives_at > departs_at AND arrives_at <= departs_at + interval '48 hours'),
  from_city text,
  to_city text,
  la_starts_at timestamptz NOT NULL,                      -- greatest(departs_at, arrives_at - 8h)
  la_ends_at timestamptz NOT NULL,                        -- arrives_at + 1h
  la_started_at timestamptz,
  la_ended_at timestamptz,
  last_phase text CHECK (last_phase IN ('before', 'inTransit', 'landed')),
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trips_couple ON trips(couple_id, departs_at);
-- Cron scan: trips whose activity should start, update or end.
CREATE INDEX IF NOT EXISTS idx_trips_cron ON trips(la_starts_at) WHERE la_ended_at IS NULL AND canceled_at IS NULL;

CREATE TABLE IF NOT EXISTS live_activity_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('push_to_start', 'update')),
  token text NOT NULL,
  env text NOT NULL CHECK (env IN ('sandbox', 'production')),
  activity_id text,                                       -- update tokens only
  trip_id text REFERENCES trips(id) ON DELETE CASCADE,    -- update tokens only
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_activity_tokens_token ON live_activity_tokens(token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_activity_tokens_pts ON live_activity_tokens(user_id, installation_id) WHERE kind = 'push_to_start' AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_live_activity_tokens_trip ON live_activity_tokens(trip_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS couple_nudges (
  id text PRIMARY KEY,
  couple_id text NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  from_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('widget', 'app')),
  client_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Rate limit (1 / 60 s, 30 / day) reads the sender's recent rows.
CREATE INDEX IF NOT EXISTS idx_couple_nudges_from ON couple_nudges(from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_couple_nudges_to ON couple_nudges(to_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_couple_nudges_client ON couple_nudges(from_user_id, client_id) WHERE client_id IS NOT NULL;

-- -----------------------------------------------------------------------------------------------------
-- Unpair (DELETE /api/v1/couple), for reference (W1), in one transaction:
--   UPDATE couples SET unpaired_at = now() WHERE id = $c;
--   UPDATE couple_members SET left_at = now() WHERE couple_id = $c AND left_at IS NULL;
--   DELETE FROM trips WHERE couple_id = $c;                      -- shared history goes away now
--   DELETE FROM couple_nudges WHERE couple_id = $c;
--   DELETE FROM calendar_busy WHERE user_id IN (<both members>);
--   UPDATE couple_photos SET delete_after = now() + interval '30 days' WHERE couple_id = $c;
-- Photos stay readable/exportable only by their author (author_user_id) until delete_after;
-- GET /api/cron/retention deletes the storage objects and rows afterwards.
-- -----------------------------------------------------------------------------------------------------
