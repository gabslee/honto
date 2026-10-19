-- Build 8 Profile tab: one profile photo per user. Builds on 0012_couple_lifecycle.sql (storage_deletions).
-- Applied lazily by ensureAvatarSchema() (api/v1/profile.ts); this file is the reviewable record.
-- Idempotent. Only adds a table and indexes.

-- Objects live in the private bucket under avatars/<userId>/<avatarId>/{full,thumb}.{jpg,webp}; the app
-- gets 24 h presigned GETs. A row is 'pending' between POST /api/v1/me/avatar/upload and .../complete.
-- At most one 'ready' row per user: completing a new one deletes the previous row and queues its keys in
-- storage_deletions. Pending rows older than a day are purged by the retention cron.
CREATE TABLE IF NOT EXISTS user_avatars (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  object_key text NOT NULL,
  thumb_key text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  thumb_content_type text NOT NULL,
  thumb_size_bytes integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_avatars_ready ON user_avatars(user_id) WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS idx_user_avatars_user ON user_avatars(user_id, created_at DESC);
