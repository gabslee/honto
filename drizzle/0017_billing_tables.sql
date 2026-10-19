-- RevenueCat entitlements and the webhook event log as a real migration. Until now they only existed in
-- drizzle/0010_calendar_entitlements.sql (record) and were created lazily by ensureEntitlementsSchema()
-- (app/entitlements.ts) on the first webhook that passed authorization, so production never had them.
-- The app now also creates them through ensureLifecycleSchema() on the first /api/v1 request.
-- Idempotent and identical to the lazy definition: safe to run whether or not the app created the tables first.
-- Needs users (app/server-auth.ts).

-- Premium of the couple = any active member with an active row here, or legacy Stripe users.plan = 'premium'.
CREATE TABLE IF NOT EXISTS entitlements (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('revenuecat', 'stripe', 'admin')),
  entitlement text NOT NULL DEFAULT 'premium',
  product_id text,
  period_type text CHECK (period_type IN ('trial', 'intro', 'normal')),
  store text,
  environment text,
  expires_at timestamptz,
  will_renew boolean,
  had_trial boolean NOT NULL DEFAULT false,
  last_event_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source, entitlement)
);
CREATE INDEX IF NOT EXISTS idx_entitlements_expiry ON entitlements(expires_at);

-- One row per RevenueCat webhook event id (idempotency) with the raw payload.
CREATE TABLE IF NOT EXISTS revenuecat_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  app_user_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL
);
