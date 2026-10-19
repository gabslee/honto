-- Couple lifecycle (W1b): one open pairing code per user, email magic-link tokens, app refresh tokens, v1 rate limits, photo
-- exports and the object-storage deletion queue. Builds on drizzle/0008_v1_foundation.sql (W1a).
-- Applied lazily by ensureLifecycleSchema() in api/v1/lifecycle.ts; this file is the reviewable record.
-- Idempotent. Only adds tables and indexes; legacy couples and the frozen /api/mobile tables are untouched.

-- One open pairing code per user: a new code revokes the previous one. Older duplicates are revoked first.
UPDATE couple_invites i SET revoked_at = now()
  WHERE i.used_at IS NULL AND i.revoked_at IS NULL
    AND EXISTS (SELECT 1 FROM couple_invites n WHERE n.created_by = i.created_by AND n.used_at IS NULL AND n.revoked_at IS NULL AND (n.created_at, n.code) > (i.created_at, i.code));
CREATE UNIQUE INDEX IF NOT EXISTS idx_couple_invites_open ON couple_invites(created_by) WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS email_login_tokens (
  token_hash text PRIMARY KEY,                            -- salted SHA-256 of the link token (ml_…)
  email text NOT NULL,                                    -- lowercased
  code_hash text NOT NULL,                                -- salted SHA-256 of email + 6-digit code
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  attempts integer NOT NULL DEFAULT 0,                    -- wrong code attempts; unusable after 5
  expires_at timestamptz NOT NULL,                        -- created_at + 15 min
  used_at timestamptz,                                    -- single use
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_login_tokens_email ON email_login_tokens(email, created_at DESC);

-- Rotating refresh tokens for the apps (POST /api/v1/auth/refresh). Single use; a family is one sign-in and
-- all its rotations, revoked together when a used token comes back (possible theft).
CREATE TABLE IF NOT EXISTS v1_refresh_tokens (
  token_hash text PRIMARY KEY,                            -- salted SHA-256 of hm_r_…
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,                        -- created_at + 365 days
  used_at timestamptz,                                    -- rotated
  revoked_at timestamptz
);
-- Hash of the hm_u_ access token issued with each refresh token, so POST /api/v1/auth/logout ends that chain.
ALTER TABLE v1_refresh_tokens ADD COLUMN IF NOT EXISTS access_hash text;
CREATE INDEX IF NOT EXISTS idx_v1_refresh_tokens_family ON v1_refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_v1_refresh_tokens_access ON v1_refresh_tokens(access_hash) WHERE access_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_v1_refresh_tokens_user ON v1_refresh_tokens(user_id);

-- Fixed-window counters (join attempts, invites, email start/verify per IP hash, exports). Purged after 2 days.
CREATE TABLE IF NOT EXISTS v1_rate_limits (
  scope text NOT NULL,
  subject text NOT NULL,                                  -- user id or salted hash, never a raw IP or email
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, subject, window_start)
);

-- Same definition as the W2a section of drizzle/proposed/0008-0011_mvp_v1.sql, so whichever runs first creates it.
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

-- Object keys whose rows are already deleted. GET /api/cron/retention drains it with deleteObjects (the bucket
-- has no lifecycle rules). Keys are queued in the same statement that deletes their rows.
CREATE TABLE IF NOT EXISTS storage_deletions (
  object_key text PRIMARY KEY,
  reason text NOT NULL,                                   -- 'photo' | 'export'
  queued_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);
