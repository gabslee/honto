-- W3: calendar busy/free mirror and RevenueCat entitlements.
-- Applied lazily by ensureCalendarSchema() in api/v1/calendar-schema.ts and ensureEntitlementsSchema() in
-- app/entitlements.ts; this file is the reviewable record. Idempotent. Needs 0008_v1_foundation (couples).

-- Busy blocks of a member, scoped to the couple they were uploaded in. PUT /api/v1/calendar/busy replaces
-- the rows overlapping its window in one transaction. All-day events and titles are never stored here
-- (the per-calendar title opt-in adds its columns later). pruneCalendar() deletes rows that ended more
-- than a day ago and rows of members who left the couple.
CREATE TABLE IF NOT EXISTS calendar_busy (
  id bigserial PRIMARY KEY,
  couple_id text NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calendar_busy_user ON calendar_busy(user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_calendar_busy_couple ON calendar_busy(couple_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_calendar_busy_ends ON calendar_busy(ends_at);

-- Last upload per user: window, device zone and time ("never synced" vs "synced, nothing busy").
-- The upload upserts this row first, so concurrent uploads of the same user queue on its lock.
CREATE TABLE IF NOT EXISTS calendar_sync (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  couple_id text NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  window_from timestamptz NOT NULL,
  window_to timestamptz NOT NULL,
  time_zone text,
  synced_at timestamptz NOT NULL DEFAULT now()
);

-- Premium of the couple = any active member with an active row here, or legacy Stripe users.plan = 'premium'.
CREATE TABLE IF NOT EXISTS entitlements (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('revenuecat', 'stripe', 'admin')),
  entitlement text NOT NULL DEFAULT 'premium',
  product_id text,
  period_type text CHECK (period_type IN ('trial', 'intro', 'normal')),
  store text,                                             -- APP_STORE | PLAY_STORE
  environment text,                                       -- SANDBOX | PRODUCTION
  expires_at timestamptz,                                 -- NULL = no expiry
  will_renew boolean,
  had_trial boolean NOT NULL DEFAULT false,
  last_event_at timestamptz,                              -- newest applied RevenueCat event_timestamp_ms (out-of-order guard)
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source, entitlement)
);
CREATE INDEX IF NOT EXISTS idx_entitlements_expiry ON entitlements(expires_at);

-- Every webhook event received (idempotency by event.id, plus the raw payload).
CREATE TABLE IF NOT EXISTS revenuecat_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  app_user_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL
);
