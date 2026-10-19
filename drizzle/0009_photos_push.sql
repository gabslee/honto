-- v1 photos and push (W2a): object-storage photos, photo exports, push devices.
-- Applied lazily by ensurePhotosSchema() in api/v1/photos-schema.ts; this file is the reviewable record.
-- Idempotent. Needs couples / users (0008) and the couple_photos base table of api/couple.ts.
--
-- v1 photos live in a private S3-compatible bucket (storage = 's3'; Railway Storage Buckets today):
-- url/pathname stay NULL, reads use presigned GETs of object_key / thumb_key. The bucket has no lifecycle
-- rules, so every deletion (unpaired photos, exports, stale pending uploads) is done by GET /api/cron/retention.
-- Legacy Blob rows keep storage = 'blob' and their public url.
CREATE TABLE IF NOT EXISTS couple_photos (id text PRIMARY KEY, couple_id text NOT NULL, room_id text, role text NOT NULL, author_name text NOT NULL, url text NOT NULL, pathname text NOT NULL, phrase_key text, phrase text NOT NULL, content_type text NOT NULL, size_bytes integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_couple_photos_couple ON couple_photos(couple_id, created_at DESC);

ALTER TABLE couple_photos ALTER COLUMN url DROP NOT NULL;
ALTER TABLE couple_photos ALTER COLUMN pathname DROP NOT NULL;
-- v1 phrases are optional (PhotoCreateRequest.phraseKey / phrase).
ALTER TABLE couple_photos ALTER COLUMN phrase DROP NOT NULL;
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
  expires_at timestamptz                                  -- ready_at + 7 days (object deleted by the retention cron)
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
  revoked_at timestamptz                                  -- logout, DELETE, or APNs 410 / BadDeviceToken / FCM UNREGISTERED
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_devices_token ON push_devices(kind, token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_devices_install ON push_devices(user_id, installation_id, kind) WHERE revoked_at IS NULL;
