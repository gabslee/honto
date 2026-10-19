-- Feedback r1: coarse weather per person and "Thinking of you" nudges. Builds on 0012_couple_lifecycle.sql.
-- Applied lazily by ensureWeatherSchema() (api/v1/weather.ts) and ensureNudgesSchema() (api/v1/nudges.ts);
-- this file is the reviewable record. Idempotent. Only adds tables and indexes.

-- Last weather summary a person reported from their device. Privacy: no coordinates, no place name.
-- Rows older than 12 h are ignored by GET /api/v1/today; DELETE /api/v1/me/weather removes the row.
CREATE TABLE IF NOT EXISTS user_weather (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  condition text NOT NULL CHECK (condition IN ('clear', 'partly_cloudy', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'thunderstorm')),
  temperature_c integer NOT NULL,
  is_day boolean NOT NULL,
  observed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- "Thinking of you" (Free), as planned in drizzle/proposed/0008-0011_mvp_v1.sql (W2b). No content, only the
-- event. Rate limit (1 / 60 s, 30 / 24 h) reads the sender's recent rows. Unpair deletes the couple's rows.
CREATE TABLE IF NOT EXISTS couple_nudges (
  id text PRIMARY KEY,
  couple_id text NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  from_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('widget', 'app')),
  client_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_couple_nudges_from ON couple_nudges(from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_couple_nudges_to ON couple_nudges(to_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_couple_nudges_client ON couple_nudges(from_user_id, client_id) WHERE client_id IS NOT NULL;
