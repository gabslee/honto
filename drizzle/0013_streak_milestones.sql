-- Couple streak and milestones (MVP Layer B, Free). Builds on drizzle/0012_couple_lifecycle.sql (W1b).
-- Applied lazily by ensureMilestonesSchema() in api/v1/milestones.ts; this file is the reviewable record.
-- Idempotent. Only adds tables and indexes. The streak itself is computed from couple_photos (W2a) on read;
-- deleting a couple (retention cron, 30 days after unpairing) cascades to everything here.

-- Best streak ever, so it survives deleted photos. The current streak is never stored.
CREATE TABLE IF NOT EXISTS couple_streaks (
  couple_id text PRIMARY KEY REFERENCES couples(id) ON DELETE CASCADE,
  best integer NOT NULL DEFAULT 0,
  best_ended_on date,                                     -- last day of the best run
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per milestone per couple (first photo, 100 days together, each anniversary, each reunion day,
-- streaks of 7 / 30 / 100). dedupe_key: 'first', '100', years, the reunion day, or the streak length.
CREATE TABLE IF NOT EXISTS couple_milestones (
  id text PRIMARY KEY,                                    -- ms_...
  couple_id text NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('first_photo', 'days_together', 'anniversary', 'reunion', 'streak')),
  dedupe_key text NOT NULL,
  value integer,                                          -- 100, years, or streak length; null otherwise
  local_day date NOT NULL,                                -- day it belongs to in Memories
  achieved_at timestamptz NOT NULL DEFAULT now(),         -- when the server recorded it
  UNIQUE (couple_id, type, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_couple_milestones_day ON couple_milestones(couple_id, local_day);

-- Per-user "seen" (the CelebrationSheet is shown once per user).
CREATE TABLE IF NOT EXISTS couple_milestone_seen (
  milestone_id text NOT NULL REFERENCES couple_milestones(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (milestone_id, user_id)
);
