-- v1 foundation (W1a): user time zones, v1 couple columns, two-account couples and invite codes.
-- Applied lazily by ensureFoundationSchema() in api/v1/foundation-schema.ts; this file is the reviewable record.
-- Idempotent. Legacy couples (host_user_id + partner_key) are not migrated into couple_members.
ALTER TABLE users ADD COLUMN IF NOT EXISTS time_zone text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS time_zone_updated_at timestamptz;

-- true for every pre-v1 couple (and those the frozen /api/mobile and web game still create); v1 inserts legacy = false.
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
  role text NOT NULL CHECK (role IN ('a', 'b')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  PRIMARY KEY (couple_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_couple_members_active_user ON couple_members(user_id) WHERE left_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_couple_members_active_role ON couple_members(couple_id, role) WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS couple_invites (
  code text PRIMARY KEY,
  created_by text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_by text REFERENCES users(id) ON DELETE SET NULL,
  used_at timestamptz,
  couple_id text REFERENCES couples(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_couple_invites_creator ON couple_invites(created_by, created_at DESC);
